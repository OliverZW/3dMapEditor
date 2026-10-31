import { expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { createDocument } from '../src/core/document';
import { prepareSurfaceDocument } from '../src/io/surface-resources';
import { resourcePath } from '../src/io/project-resources';
import { imageHash } from '../src/io/image-validation';
import { exportCocos } from '../src/io/cocos-export';

it('引擎导出包含工程选中的地表颜色、法线和平铺尺度', async () => {
  const doc = prepareSurfaceDocument(createDocument());
  const source = doc.surfaceMaterial.layers[1];
  const owned = (image: typeof source.color) => ({
    ...image,
    resource: { origin: 'project' as const, path: resourcePath(image.hash, false) },
  });
  const asset = {
    id: 'surface-export',
    name: '工程贴图',
    meters: 27,
    color: owned(source.color),
    normal: owned(source.normal),
  };
  doc.surfaceMaterial.library = [asset];
  doc.surfaceMaterial.layers[0] = { ...asset, id: 'grass', materialId: asset.id };
  const result = await exportCocos(doc, {
    trees: false,
    grass: false,
    water: false,
    sites: false,
    logic: false,
  });
  const files = unzipSync(result.bytes);
  const surface = JSON.parse(strFromU8(files['materials/surface.json']));
  expect(surface.layers[0].meters).toBe(27);
  expect(imageHash(files[surface.layers[0].color.path])).toBe(asset.color.hash);
  expect(imageHash(files[surface.layers[0].normal.path])).toBe(asset.normal.hash);
}, 60000);
