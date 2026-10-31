import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { ModelAsset } from '../core/types';
import { ModelLibrary } from '../renderer/models';
export function AssetPreview({ asset }: { asset: ModelAsset }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current!;
    let alive = true,
      frame = 0;
    const library = new ModelLibrary(),
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(element.clientWidth, 160);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(35, element.clientWidth / 160, 0.01, 10000);
    scene.add(new THREE.HemisphereLight(0xe3f5ff, 0x595a3e, 3));
    const sun = new THREE.DirectionalLight(0xffebcb, 3);
    sun.position.set(-20, 40, 30);
    scene.add(sun);
    void library
      .get(asset)
      .then((model) => {
        if (!alive) return;
        const group = model.clone(true);
        group.scale.setScalar(asset.scale);
        group.rotation.y = asset.yaw;
        group.position.y = asset.offset;
        scene.add(group);
        const box = new THREE.Box3().setFromObject(group),
          size = box.getSize(new THREE.Vector3()),
          center = box.getCenter(new THREE.Vector3());
        group.position.sub(center);
        const distance = Math.max(size.x, size.y, size.z) * 2.2;
        camera.position.set(distance * 0.7, distance * 0.55, distance * 0.8);
        camera.lookAt(0, 0, 0);
        const animate = () => {
          frame = requestAnimationFrame(animate);
          group.rotation.y += 0.003;
          renderer.render(scene, camera);
        };
        animate();
      })
      .catch((e) => {
        if (alive) element.dataset.error = String(e);
      });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      library.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [asset.id, asset.hash, asset.scale, asset.yaw, asset.offset]);
  return <div ref={ref} className="model-preview" aria-label="模型三维预览" />;
}
