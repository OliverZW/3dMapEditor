import { describe, expect, it } from 'vitest';
import { createDocument } from '../src/core/document';
import { EditorSession } from '../src/application/editor-session';
import type { RenderInvalidation } from '../src/application/render-invalidation';
import { SurfaceRegions } from '../src/renderer/surface-regions';
import { surfaceShader } from '../src/renderer/surface-shader';
import * as THREE from 'three';
import { SurfaceMaterial } from '../src/renderer/surface-material';
import { SurfacePageCache } from '../src/renderer/surface-page-cache';

describe('保守地表占用缓存', () => {
  it('包含区域边界插值邻点，局部改刷和擦除后重新判定，不误删非零图层', () => {
    const doc = createDocument(513, 512, 512),
      regions = new SurfaceRegions();
    doc.surface[(32 * 513 + 32) * 4 + 1] = 1;
    regions.update(doc);
    const read = (x: number, z: number) =>
      (regions.texture.image.data as Uint8Array)[(z * regions.size + x) * 4 + 1];
    expect(read(0, 0)).toBe(255);
    expect(read(1, 1)).toBe(255);
    expect(read(3, 3)).toBe(0);
    doc.surface[(32 * 513 + 32) * 4 + 1] = 0;
    regions.update(doc, { minX: -224, maxX: -224, minZ: -224, maxZ: -224 });
    expect(read(0, 0)).toBe(0);
    expect(read(1, 1)).toBe(0);
    regions.update(createDocument(1025, 768, 384));
    expect(regions.size).toBe(32);
    regions.dispose();
  });
  it('梯度在条件采样前求值，只跳过严格零贡献，保留坡度岩石及原始对照', () => {
    const exact = surfaceShader(true),
      original = surfaceShader(false);
    expect(exact.declarations).toContain('textureGrad(');
    expect(exact.declarations).toContain('if(contribution>0.)');
    expect(exact.color).toContain('surfaceActive.z=max(surfaceActive.z,uSurfaceSlope)');
    expect(exact.color.indexOf('surfaceGrad(surfaceP')).toBeLessThan(
      exact.color.indexOf('vec3 surfaceAlbedo='),
    );
    expect(original.declarations).not.toContain('textureGrad(');
  });
});

describe('显示失效通知', () => {
  it('校验失败的命令回滚文档并使显示缓存失效，不留下旧权重引用', () => {
    const session = new EditorSession(),
      changes: RenderInvalidation[] = [];
    session.subscribeRender((change) => changes.push(change));
    const weight = session.doc.surface[0],
      width = session.doc.settings.width,
      revision = session.revision;
    session.change('无效候选', (doc) => {
      doc.surface[0] = 0;
      doc.settings.width = 0;
    });
    expect(session.doc.surface[0]).toBe(weight);
    expect(session.doc.settings.width).toBe(width);
    expect(session.revision).toBe(revision);
    expect(session.history.canUndo).toBe(false);
    expect(changes.at(-1)?.kind).toBe('all');
  });
  it('普通悬停不使缓存失效，涂刷带世界范围，撤销、取消和工程切换拒绝旧版本', () => {
    const session = new EditorSession(),
      changes: RenderInvalidation[] = [];
    const unsubscribe = session.subscribeRender((change) => changes.push(change));
    session.setTool('surface');
    session.hoverAt({ x: 0, z: 0 });
    expect(changes).toHaveLength(0);
    session.brush.surfaceLayer = 1;
    session.pointerDown({ x: 0, z: 0 }, false);
    expect(changes.at(-1)).toMatchObject({
      kind: 'surface',
      documentVersion: 0,
      bounds: { minX: -40, maxX: 40, minZ: -40, maxZ: 40 },
    });
    session.endStroke();
    session.undo();
    expect(changes.at(-1)?.kind).toBe('all');
    session.previewSurface({ scale: 2 });
    session.cancelSurface();
    expect(changes.at(-1)?.kind).toBe('material');
    session.newMap(513, 512, 512);
    expect(changes.at(-1)).toMatchObject({ kind: 'all', documentVersion: 1 });
    unsubscribe();
    const count = changes.length;
    session.previewSurface({ detail: 1 });
    expect(changes).toHaveLength(count);
  });
  it('无关势力命名不请求地表或实例重建，地表命令和模型变化分类正确', () => {
    const session = new EditorSession(),
      changes: RenderInvalidation[] = [];
    session.subscribeRender((change) => changes.push(change));
    session.change('势力改名', (doc) => {
      doc.factions[0].name = '新名称';
    });
    expect(changes).toHaveLength(0);
    session.change('地表', (doc) => {
      doc.surface[0] = 0;
      doc.surface[1] = 255;
    });
    expect(changes.at(-1)?.kind).toBe('surface');
    session.change('树木', (doc) => {
      doc.trees[0].yaw += 0.1;
    });
    expect(changes.at(-1)?.kind).toBe('instances');
  });
});

describe('材质页面缓存资源与回退', () => {
  it('每帧最多生成一个页面，LRU 有界，保留渲染器状态并回收资源', () => {
    let renders = 0;
    let renderTarget: THREE.WebGLRenderTarget | null = null;
    const renderer = {
      extensions: { has: () => true },
      shadowMap: { needsUpdate: true },
      getRenderTarget: () => renderTarget,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      getViewport: (v: THREE.Vector4) => v.set(3, 4, 500, 400),
      getScissor: (v: THREE.Vector4) => v.set(3, 4, 500, 400),
      getScissorTest: () => true,
      setScissorTest: () => {},
      setViewport: () => {},
      setScissor: () => {},
      clear: () => {},
      setRenderTarget: (target: THREE.WebGLRenderTarget | null) => {
        renderTarget = target;
      },
      render: () => {
        renders++;
      },
      getContext: () => ({
        FRAMEBUFFER: 1,
        FRAMEBUFFER_COMPLETE: 2,
        checkFramebufferStatus: () => 2,
      }),
    } as unknown as THREE.WebGLRenderer;
    const material = new SurfaceMaterial(() => {});
    material.ready = true;
    const cache = new SurfacePageCache(renderer, material, 40 * 1024 * 1024);
    const doc = createDocument(513, 2048, 2048),
      geometry = new THREE.BufferGeometry();
    const values = new Float32Array(513 * 513 * 3);
    geometry.setAttribute('normal', new THREE.BufferAttribute(values, 3));
    geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
    cache.setTerrain(doc, geometry);
    const camera = new THREE.PerspectiveCamera(43, 1, 0.5, 12000);
    camera.position.set(0, 800, 800);
    for (let i = 0; i < 160; i++) {
      renders = 0;
      cache.update(camera, new THREE.Vector3((i % 8) * 100, 0, 0), 800);
      expect(renders).toBeLessThanOrEqual(2); // 同一页面的颜色和法线两个输出。
      expect(cache.diagnostics.bytes).toBeLessThanOrEqual(40 * 1024 * 1024);
      expect(renderTarget).toBe(null);
      expect(renderer.shadowMap.needsUpdate).toBe(true);
    }
    const generation = cache.diagnostics.generation;
    cache.invalidate({ kind: 'surface', documentVersion: 0, revision: 1 });
    expect(cache.diagnostics.pages).toBe(0);
    expect(cache.diagnostics.generation).toBeGreaterThan(generation);
    cache.dispose();
    expect(cache.diagnostics.bytes).toBe(0);
    geometry.dispose();
    material.dispose();
  });
  it('设备能力不足时不生成浮点缓存，保持原始材质回退', () => {
    const material = new SurfaceMaterial(() => {});
    const renderer = { extensions: { has: () => false } } as unknown as THREE.WebGLRenderer;
    const cache = new SurfacePageCache(renderer, material);
    cache.update(new THREE.PerspectiveCamera(), new THREE.Vector3(), 800);
    expect(cache.diagnostics).toMatchObject({ disabled: true, capacity: 0, pages: 0 });
    cache.dispose();
    material.dispose();
  });
});
