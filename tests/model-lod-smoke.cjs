const { setup, launch } = require('./model-fixture.cjs');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const browser = await launch(),
    report = { checks: [], errors: [] };
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 800 },
      deviceScaleFactor: 1,
    });
    page.on('pageerror', (e) => report.errors.push(String(e)));
    page.setDefaultTimeout(120000);
    await setup(page, { demo: false });
    const check = async (name, fn) => {
      const value = await fn();
      report.checks.push({ name, value });
      console.log(name, JSON.stringify(value));
    };
    await page.evaluate(() => {
      const { session: s } = window.modelFixture;
      s.change('模型测试', (d) => {
        for (let i = 0; i < 5; i++)
          d.trees.push({
            id: d.nextId++,
            assetId: d.assets.filter((a) => a.kind === 'tree')[i].id,
            x: (i - 2) * 30,
            z: 0,
            yaw: 0,
            scale: 1,
          });
      });
    });
    const idle = () =>
      page.waitForFunction(
        () => {
          const { viewport: v, session: s } = window.modelFixture;
          return (
            v.seenRevision === s.revision &&
            !v.instancesDirty &&
            !v.instanceBuilds &&
            !v.instanceTimer
          );
        },
        {},
        { timeout: 120000 },
      );
    await idle();
    await check('相机平移只改变显示缓冲，不重建树木和据点', async () => {
      const before = await page.evaluate(() => {
        const { viewport: v } = window.modelFixture;
        window.before = {
          trees: v.treeModels.diagnostics.rebuilds,
          sites: v.siteModels.diagnostics.rebuilds,
        };
        v.camera.position.x += 50;
        v.navigation.rig.target.x += 50;
        return window.before;
      });
      await page.waitForTimeout(1000);
      const after = await page.evaluate(() => {
        const v = window.modelFixture.viewport;
        return {
          trees: v.treeModels.diagnostics.rebuilds,
          sites: v.siteModels.diagnostics.rebuilds,
        };
      });
      assert.deepEqual(after, before);
      return after;
    });
    await check('场外投影物保留，静态与纯相机移动不重复画阴影', async () => {
      await page.evaluate(() => {
        const v = window.modelFixture.viewport;
        window.shadowCalls = 0;
        v.treeModels.group.traverse((o) => {
          if (o.name === 'TreeBatchShadow') {
            const previous = o.onBeforeShadow;
            o.onBeforeShadow = (...args) => {
              window.shadowCalls++;
              previous(...args);
            };
          }
        });
        v.renderer.shadowMap.needsUpdate = true;
      });
      await page.waitForTimeout(700);
      const first = await page.evaluate(() => window.shadowCalls);
      assert(first > 0);
      await page.evaluate(() => {
        window.modelFixture.viewport.camera.position.x += 20;
      });
      await page.waitForTimeout(700);
      const second = await page.evaluate(() => window.shadowCalls);
      assert.equal(second, first);
      return { first, second };
    });
    await check('原模型近景、正交分档与真实鼠标树木拾取', async () => {
      await page.evaluate(() => {
        const { viewport: v, session: s } = window.modelFixture;
        s.setTool('trees');
        s.setVegetationMode('select');
        v.navigation.rig.toggleProjection();
        v.camera.position.set(0, 500, 0);
        v.camera.up.set(0, 0, -1);
        v.camera.lookAt(0, 32, 0);
        v.camera.zoom = 9;
        v.camera.updateProjectionMatrix();
        v.camera.updateMatrixWorld(true);
        v.navigation.rig.target.set(0, 32, 0);
      });
      await page.waitForTimeout(900);
      const point = await page.evaluate(() => {
        const { viewport: v, THREE, session: s } = window.modelFixture;
        const t = s.doc.trees[2];
        const p = new THREE.Vector3(t.x, 37, t.z).project(v.camera);
        const r = v.renderer.domElement.getBoundingClientRect();
        return {
          x: r.left + ((p.x + 1) * r.width) / 2,
          y: r.top + ((1 - p.y) * r.height) / 2,
          id: t.id,
        };
      });
      await page.mouse.click(point.x, point.y);
      await page.waitForTimeout(400);
      const selected = await page.evaluate(() => {
        const { viewport: v, session: s } = window.modelFixture;
        return {
          id: s.selectedTree,
          original: v.treeModels.group.children
            .filter((o) => o.userData.modelLevel === 0)
            .flatMap((o) => o.userData.treeIds),
        };
      });
      assert.equal(selected.id, point.id);
      assert(selected.original.includes(point.id));
      return selected;
    });
    await check('替换、撤销重做和地形改变后稳定身份与贴地', async () => {
      const id = await page.evaluate(() => {
        const { session: s } = window.modelFixture;
        const id = s.selectedTree;
        s.replaceModel('tree-maple');
        return id;
      });
      await idle();
      assert.equal(
        await page.evaluate(
          (id) => window.modelFixture.session.doc.trees.find((t) => t.id === id).assetId,
          id,
        ),
        'tree-maple',
      );
      await page.evaluate(() => window.modelFixture.session.undo());
      await idle();
      await page.evaluate(() => window.modelFixture.session.redo());
      await idle();
      await page.evaluate(() => {
        const { session: s } = window.modelFixture;
        s.change('抬高地形', (d) => d.heights.fill(50));
      });
      await idle();
      const positions = await page.evaluate(() => {
        const v = window.modelFixture.viewport;
        return v.treeModels.assets.flatMap((a) =>
          a.instances.map((i) => ({ id: i.id, y: i.matrix.elements[13] })),
        );
      });
      assert(positions.every((p) => Math.abs(p.y - 50) < 0.01));
      return positions;
    });
    await check('据点真实拾取、移动、撤销及图层显隐保持稳定身份', async () => {
      await page.evaluate(() => {
        const { session: s } = window.modelFixture;
        s.setTool('sites');
        s.beginSite('city');
        s.hoverAt({ x: 0, z: -75 });
        s.pointerDown({ x: 0, z: -75 }, false);
        s.commitSite();
        s.selectedSite = null;
        s.notify();
      });
      await idle();
      const point = await page.evaluate(async () => {
        const { session: s, viewport: v, THREE } = window.modelFixture;
        const { hexWorld } = await import('/src/core/hex.ts');
        const site = s.doc.sites[0],
          world = hexWorld(s.doc.grid, site.center);
        const p = new THREE.Vector3(world.x, 55, world.z).project(v.camera),
          r = v.renderer.domElement.getBoundingClientRect();
        return {
          id: site.id,
          x: r.left + ((p.x + 1) * r.width) / 2,
          y: r.top + ((1 - p.y) * r.height) / 2,
          center: site.center,
        };
      });
      await page.mouse.click(point.x, point.y);
      assert.equal(await page.evaluate(() => window.modelFixture.session.selectedSite), point.id);
      await page.evaluate(() => {
        const s = window.modelFixture.session;
        s.beginMoveSite();
        s.hoverAt({ x: 65, z: -75 });
        s.pointerDown({ x: 65, z: -75 }, false);
        s.commitSite();
      });
      await idle();
      const moved = await page.evaluate(() => window.modelFixture.session.doc.sites[0]);
      assert.equal(moved.id, point.id);
      assert.notDeepEqual(moved.center, point.center);
      await page.evaluate(() => window.modelFixture.session.undo());
      await idle();
      assert.deepEqual(
        await page.evaluate(() => window.modelFixture.session.doc.sites[0].center),
        point.center,
      );
      const visibility = await page.evaluate(() => {
        const { session: s, viewport: v } = window.modelFixture;
        const count = s.doc.trees.length;
        s.setViewLayer('trees', false);
        s.setViewLayer('sites', false);
        const hidden = !v.treeModels.group.visible && !v.sites.visible;
        s.setViewLayer('trees', true);
        s.setViewLayer('sites', true);
        return { hidden, count, after: s.doc.trees.length };
      });
      assert(visibility.hidden);
      assert.equal(visibility.count, visibility.after);
      return { id: point.id, moved: moved.center, visibility };
    });
    await check('草密度命令不重建树木与据点，即使当前不是草工具', async () => {
      const before = await page.evaluate(() => {
        const { viewport: v, session: s } = window.modelFixture;
        const result = [v.treeModels.diagnostics.rebuilds, v.siteModels.diagnostics.rebuilds];
        s.change('添加草层', (d) => {
          d.grass.push({
            id: d.nextId++,
            assetId: 'grass-reed',
            density: new Float32Array(d.heights.length),
            seed: 1,
            version: 1,
            minScale: 1,
            maxScale: 1,
            maxSlope: 30,
            wind: 1,
          });
        });
        return result;
      });
      await idle();
      const after = await page.evaluate(() => {
        const v = window.modelFixture.viewport;
        return [v.treeModels.diagnostics.rebuilds, v.siteModels.diagnostics.rebuilds];
      });
      assert.deepEqual(after, before);
      return after;
    });
    await check('保存重开与快速工程替换拒绝旧模型，释放独占实例缓冲', async () => {
      const result = await page.evaluate(async () => {
        const { session: s, viewport: v, createDocument } = window.modelFixture;
        const { encodeProject, decodeProject } = await import('/src/io/project.ts');
        const before = s.doc.trees.map((t) => ({ ...t }));
        s.replace(decodeProject(encodeProject(s.doc)));
        const same = JSON.stringify(before) === JSON.stringify(s.doc.trees);
        s.replace(createDocument(513, 128, 128));
        s.replace(createDocument(513, 256, 256));
        return { same };
      });
      assert(result.same);
      await idle();
      const remaining = await page.evaluate(() => {
        const v = window.modelFixture.viewport;
        return {
          trees: v.treeModels.group.children.length,
          sites: v.siteModels.group.children.length,
        };
      });
      assert.deepEqual(remaining, { trees: 0, sites: 0 });
      await page.evaluate(() => window.modelFixture.release());
      return remaining;
    });
    assert.deepEqual(report.errors, []);
  } finally {
    fs.writeFileSync('test-results/model-lod-smoke.json', JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
