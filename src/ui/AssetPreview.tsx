import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ModelAsset } from '../core/types';
import { ModelLibrary } from '../renderer/models';
export function AssetPreview({
  asset,
  showGround = false,
}: {
  asset: ModelAsset;
  showGround?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [previewError, setPreviewError] = useState('');
  useEffect(() => {
    const element = ref.current!;
    setPreviewError('');
    let alive = true,
      frame = 0;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (error) {
      element.dataset.error = String(error);
      setPreviewError(`模型预览不可用：${String(error)}`);
      return;
    }
    delete element.dataset.error;
    const library = new ModelLibrary();
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
        if (showGround) {
          const extent = Math.max(
            size.x,
            size.z,
            size.y,
            Math.abs(box.min.y),
            Math.abs(box.max.y),
            0.1,
          );
          const grid = new THREE.GridHelper(extent * 3, 12, 0x6ca9ca, 0x394e5a);
          grid.position.set(center.x, 0, center.z);
          scene.add(grid);
          camera.position.set(center.x + extent * 2, extent * 1.6, center.z + extent * 2);
          camera.lookAt(center.x, (box.max.y + Math.min(0, box.min.y)) / 2, center.z);
        } else {
          group.position.sub(center);
          const distance = Math.max(size.x, size.y, size.z) * 2.2;
          camera.position.set(distance * 0.7, distance * 0.55, distance * 0.8);
          camera.lookAt(0, 0, 0);
        }
        const animate = () => {
          frame = requestAnimationFrame(animate);
          if (!showGround) group.rotation.y += 0.003;
          renderer.render(scene, camera);
        };
        animate();
      })
      .catch((e) => {
        if (alive) {
          element.dataset.error = String(e);
          setPreviewError(`模型预览失败：${String(e)}`);
        }
      });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      library.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.GridHelper) {
          object.geometry.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            material.dispose();
        }
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [asset.id, asset.hash, asset.kind, asset.scale, asset.yaw, asset.offset, showGround]);
  return (
    <div ref={ref} className="model-preview" aria-label="模型三维预览">
      {previewError && (
        <p className="error-text" role="alert">
          {previewError}
        </p>
      )}
    </div>
  );
}
