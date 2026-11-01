import * as THREE from 'three';
import type { LogicMaterials } from './logic-materials';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { MapDocument, Point, ViewSettings } from '../core/types';
import { hexIndex, hexWorld, hexCorners, indexHex, worldHex } from '../core/hex';
import { clipSegment, clipPolygon } from '../core/map-bounds';
import { sampleHeight } from '../core/terrain';

const GRID_COLOR = 0x36575e;
const SELECTED_COLOR = 0x6cbafa;
/** 格线独立于地面网格：去重共享边并沿高度场细分，线宽采用屏幕像素。 */
export function buildLogicOverlay(
  doc: MapDocument,
  heights: Float32Array,
  view: ViewSettings,
  selectedId: number | null,
  part: 'all' | 'grid' | 'ranges' = 'all',
  materials?: LogicMaterials,
) {
  const group = new THREE.Group();
  const showGrid = view.hex && part !== 'ranges';
  const showRanges = part !== 'grid';
  const fills: number[] = [],
    colors: number[] = [],
    gridLines: number[] = [],
    boundaryLines: number[] = [];
  const sites = new Map(doc.sites.map((site) => [site.id, site]));
  const factions = new Map(doc.factions.map((faction) => [faction.id, faction]));
  const edges = new Set<string>();
  const spacing = Math.min(doc.settings.width, doc.settings.depth) / (doc.settings.samples - 1) / 2;
  const height = (p: Point) => sampleHeight(doc, heights, p.x, p.z) + 0.65;
  function line(target: number[], a: Point, b: Point) {
    const clipped = clipSegment(doc.settings, a, b);
    if (!clipped) return;
    [a, b] = clipped;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing - 1e-9));
    for (let j = 0; j < steps; j++) {
      const p = { x: a.x + ((b.x - a.x) * j) / steps, z: a.z + ((b.z - a.z) * j) / steps };
      const q = {
        x: a.x + ((b.x - a.x) * (j + 1)) / steps,
        z: a.z + ((b.z - a.z) * (j + 1)) / steps,
      };
      target.push(p.x, height(p), p.z, q.x, height(q), q.z);
    }
  }
  for (let i = 0; i < doc.owners.length; i++) {
    const p = hexWorld(doc.grid, indexHex(doc.grid, i));
    const site = sites.get(doc.owners[i]),
      selected = !!site && site.id === selectedId;
    const faction = site ? factions.get(site.factionId ?? -1) : undefined;
    const fill =
      showRanges && !!site && ((view.factions && !!faction) || (view.territories && selected));
    if (!fill && !showGrid && !(showRanges && view.territories && selected)) continue;
    const corners = hexCorners(doc.grid, indexHex(doc.grid, i));
    if (fill) {
      const color = new THREE.Color(faction?.color ?? '#abb5b6');
      for (let k = 0; k < 6; k++) {
        const a = corners[k],
          b = corners[(k + 1) % 6];
        const polygon = clipPolygon(doc.settings, [p, a, b]);
        for (let j = 1; j + 1 < polygon.length; j++) {
          for (const vertex of [polygon[0], polygon[j], polygon[j + 1]]) {
            fills.push(vertex.x, height(vertex), vertex.z);
            colors.push(color.r, color.g, color.b);
          }
        }
      }
    }
    for (let k = 0; k < 6; k++) {
      const a = corners[k],
        b = corners[(k + 1) % 6];
      if (showGrid) {
        const names = [a, b]
          .map((v) => Math.round(v.x * 10000) + ',' + Math.round(v.z * 10000))
          .sort();
        const key = names.join('/');
        if (!edges.has(key)) {
          edges.add(key);
          line(gridLines, a, b);
        }
      }
      if (showRanges && selected && view.territories) {
        const outside = {
          x: p.x + ((a.x + b.x) / 2 - p.x) * 1.01,
          z: p.z + ((a.z + b.z) / 2 - p.z) * 1.01,
        };
        const neighbor = hexIndex(doc.grid, worldHex(doc.grid, outside));
        if (neighbor < 0 || doc.owners[neighbor] !== selectedId) line(boundaryLines, a, b);
      }
    }
  }
  if (fills.length) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(fills, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mesh = new THREE.Mesh(
      geometry,
      materials?.fill ??
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.21,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        }),
    );
    mesh.userData.sharedMaterial = !!materials;
    mesh.renderOrder = 2;
    group.add(mesh);
  }
  function addLines(positions: number[], color: number, width: number, opacity: number) {
    if (!positions.length) return;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material =
      (color === GRID_COLOR ? materials?.grid : materials?.boundary) ??
      new LineMaterial({
        color,
        linewidth: width,
        worldUnits: false,
        transparent: true,
        opacity,
        depthWrite: false,
      });
    const mesh = new LineSegments2(geometry, material);
    mesh.userData.sharedMaterial = !!materials;
    mesh.renderOrder = 3;
    group.add(mesh);
  }
  addLines(gridLines, GRID_COLOR, 1.25, 0.72);
  addLines(boundaryLines, SELECTED_COLOR, 2, 0.95);
  return group;
}
