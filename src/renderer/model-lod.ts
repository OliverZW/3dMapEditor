import * as THREE from 'three';
import type { ModelLevel } from '../io/model-lods';

export function modelPixelDiameter(sphere: THREE.Sphere, camera: THREE.Camera, height: number) {
  if (camera instanceof THREE.OrthographicCamera)
    return (sphere.radius * 2 * height * camera.zoom) / (camera.top - camera.bottom);
  const center = sphere.center.clone().applyMatrix4(camera.matrixWorldInverse);
  if (center.z + sphere.radius >= 0) return Infinity;
  return (sphere.radius * height * camera.projectionMatrix.elements[5]) / -center.z;
}

export function modelLevel(pixels: number, previous?: ModelLevel): ModelLevel {
  if (previous === undefined) return pixels >= 96 ? 0 : pixels >= 24 ? 1 : 2;
  if (previous === 0 && pixels >= 96 * 0.85) return 0;
  if (previous === 2 && pixels < 24 * 1.15) return 2;
  if (pixels >= 96 * 1.15) return 0;
  if (pixels < 24 * 0.85) return 2;
  return 1;
}
