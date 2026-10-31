import * as THREE from 'three';
import type { MapDocument } from '../core/types';
import { sampleHeight } from '../core/terrain';
export function buildResizeOverlay(
  doc: MapDocument,
  heights: Float32Array,
  width: number,
  depth: number,
) {
  const group = new THREE.Group(),
    halfW = doc.settings.width / 2,
    halfD = doc.settings.depth / 2;
  const cutW = Math.min(width / 2, halfW),
    cutD = Math.min(depth / 2, halfD);
  for (const [left, right, top, bottom] of [
    [-halfW, -cutW, -halfD, halfD],
    [cutW, halfW, -halfD, halfD],
    [-cutW, cutW, -halfD, -cutD],
    [-cutW, cutW, cutD, halfD],
  ]) {
    if (right <= left || bottom <= top) continue;
    const geo = new THREE.PlaneGeometry(
      right - left,
      bottom - top,
      Math.ceil((right - left) / 32),
      Math.ceil((bottom - top) / 32),
    );
    geo.rotateX(-Math.PI / 2);
    geo.translate((left + right) / 2, 0, (top + bottom) / 2);
    const positions = geo.getAttribute('position');
    for (let i = 0; i < positions.count; i++)
      positions.setY(i, sampleHeight(doc, heights, positions.getX(i), positions.getZ(i)) + 1);
    group.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xd16868,
          fog: false,
          transparent: true,
          opacity: 0.27,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
    );
  }
  const corners = [
    [-width / 2, -depth / 2],
    [width / 2, -depth / 2],
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
  ];
  const points: THREE.Vector3[] = [];
  corners.forEach(([x, z], index) => {
    const [nx, nz] = corners[(index + 1) % 4],
      count = Math.ceil(Math.hypot(nx - x, nz - z) / 16);
    for (let i = 0; i < count; i++) {
      const px = x + ((nx - x) * i) / count,
        pz = z + ((nz - z) * i) / count;
      points.push(new THREE.Vector3(px, sampleHeight(doc, heights, px, pz) + 2, pz));
    }
  });
  group.add(
    new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0x80c8fc, fog: false, depthTest: false }),
    ),
  );
  group.renderOrder = 15;
  return group;
}
