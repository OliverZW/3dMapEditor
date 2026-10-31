import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { CameraNavigation } from '../renderer/camera-navigation';
import type { AxisView } from '../renderer/camera-rig';
const AXES: { axis: AxisView; name: string; color: string; vector: THREE.Vector3 }[] = [
  { axis: '+x', name: '右视图 +X', color: '#ee7773', vector: new THREE.Vector3(1, 0, 0) },
  { axis: '+y', name: '俯视图 +Y', color: '#93c785', vector: new THREE.Vector3(0, 1, 0) },
  { axis: '+z', name: '前视图 +Z', color: '#83b9ed', vector: new THREE.Vector3(0, 0, 1) },
];
function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
export function OrientationGizmo({ navigation }: { navigation: CameraNavigation }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = svg('svg', {
      viewBox: '0 0 128 128',
      role: 'group',
      'aria-label': '场景方向坐标系',
    });
    const arms = svg('g'),
      cube = svg('g', {
        role: 'button',
        tabindex: '0',
        'aria-label': '切换坐标系投影',
        class: 'gizmo-cube',
      });
    root.append(arms, cube);
    element.current!.append(root);
    const targets = AXES.map((axis) => {
      const node = svg('g', {
        role: 'button',
        tabindex: '0',
        'aria-label': axis.name,
        class: 'gizmo-axis',
      });
      const title = svg('title');
      title.textContent = axis.name + '：沿此轴观察';
      const line = svg('line', {
        stroke: axis.color,
        'stroke-width': '1.5',
        'pointer-events': 'none',
      });
      const hit = svg('rect', { fill: 'transparent', width: '32', height: '32' });
      const cone = svg('polygon', { fill: axis.color, stroke: axis.color, 'stroke-width': '1' });
      const label = svg('text', {
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: axis.color,
        'font-size': '11',
        'font-weight': '600',
        stroke: '#18232b',
        'stroke-opacity': '.65',
        'stroke-width': '2',
        'paint-order': 'stroke',
      });
      label.textContent = axis.axis.slice(1).toUpperCase();
      node.append(title, hit, cone, label);
      arms.append(line, node);
      const act = () => navigation.snap(axis.axis);
      node.addEventListener('click', act);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          act();
        }
      });
      return { node, line, cone, label, hit, axis };
    });
    const vertices = [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const faces = [
      { ids: [1, 5, 6, 2], normal: new THREE.Vector3(1, 0, 0) },
      { ids: [0, 3, 7, 4], normal: new THREE.Vector3(-1, 0, 0) },
      { ids: [3, 2, 6, 7], normal: new THREE.Vector3(0, 1, 0) },
      { ids: [0, 4, 5, 1], normal: new THREE.Vector3(0, -1, 0) },
      { ids: [4, 7, 6, 5], normal: new THREE.Vector3(0, 0, 1) },
      { ids: [0, 1, 2, 3], normal: new THREE.Vector3(0, 0, -1) },
    ].map((face) => {
      const node = svg('polygon', { stroke: '#bacbd0', 'stroke-width': '1', fill: '#577179' });
      cube.append(node);
      return { ...face, node };
    });
    const title = svg('title');
    cube.append(title);
    const act = (shift: boolean) =>
      shift ? navigation.resetPerspective() : navigation.toggleProjection();
    cube.addEventListener('click', (event) => act(event.shiftKey));
    cube.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        act(event.shiftKey);
      }
    });
    root.addEventListener('contextmenu', (event) => event.preventDefault());
    const update = () => {
      const inverse = navigation.rig.camera.quaternion.clone().invert();
      const ordered = targets
        .map((target) => {
          const projected = target.axis.vector.clone().applyQuaternion(inverse),
            length = Math.hypot(projected.x, projected.y);
          let x = 64 + projected.x * 47,
            y = 64 - projected.y * 47;
          // 轴对齐时前后轴接近重叠，在屏幕上留出点击空间。
          if (length < 0.42) {
            const angle = -Math.PI / 2;
            x = 64 + Math.cos(angle) * 29;
            y = 64 + Math.sin(angle) * 29;
          }
          target.hit.setAttribute('x', String(x - 16));
          target.hit.setAttribute('y', String(y - 16));
          target.line.setAttribute('x1', '64');
          target.line.setAttribute('y1', '64');
          target.line.setAttribute('x2', String(x));
          target.line.setAttribute('y2', String(y));
          const dx = x - 64,
            dy = y - 64,
            size = Math.hypot(dx, dy) || 1;
          const ux = dx / size,
            uy = dy / size,
            bx = x - ux * 13,
            by = y - uy * 13;
          target.cone.setAttribute(
            'points',
            x +
              ',' +
              y +
              ' ' +
              (bx - uy * 6) +
              ',' +
              (by + ux * 6) +
              ' ' +
              (bx + uy * 6) +
              ',' +
              (by - ux * 6),
          );
          target.label.setAttribute('x', String(x + ux * 10));
          target.label.setAttribute('y', String(y + uy * 10));
          target.node.setAttribute('opacity', projected.z < -0.05 ? '0.58' : '1');
          target.node.setAttribute(
            'aria-pressed',
            String(navigation.getSnapshot().orientation === target.axis.axis),
          );
          return { target, depth: projected.z };
        })
        .sort((a, b) => a.depth - b.depth);
      ordered.forEach(({ target }) => arms.append(target.line, target.node));
      const points = vertices.map((vertex) => vertex.clone().applyQuaternion(inverse));
      for (const face of faces) {
        const normal = face.normal.clone().applyQuaternion(inverse);
        face.node.setAttribute('visibility', normal.z > 0 ? 'visible' : 'hidden');
        face.node.setAttribute(
          'points',
          face.ids.map((id) => 64 + points[id].x * 11 + ',' + (64 - points[id].y * 11)).join(' '),
        );
      }
      const projection = navigation.getSnapshot().projection;
      root.dataset.projection = projection;
      root.dataset.orientation = navigation.getSnapshot().orientation;
      title.textContent =
        (projection === 'perspective' ? '当前透视' : '当前正交') +
        '；点击切换投影，Shift+点击恢复斜向透视';
    };
    const unsubscribe = navigation.subscribePose(update);
    const unsubscribeState = navigation.subscribe(update);
    return () => {
      unsubscribe();
      unsubscribeState();
      root.remove();
    };
  }, [navigation]);
  return <div className="orientation-gizmo" ref={element} />;
}
