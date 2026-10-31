import * as THREE from 'three';
import type { MapDocument, SurfaceImage, SurfaceMaterialPack } from '../core/types';
import { surfaceImageBytes } from '../io/surface-resources';
import { surfaceShader } from './surface-shader';
import { SurfaceRegions } from './surface-regions';
import type { SurfacePageCache } from './surface-page-cache';
import type { RenderBounds } from '../application/render-invalidation';

interface TextureLease {
  promise: Promise<THREE.Texture>;
  release: () => void;
}
class SurfaceTexturePool {
  private entries = new Map<
    string,
    { refs: number; promise: Promise<THREE.Texture>; texture?: THREE.Texture }
  >();
  acquire(image: SurfaceImage, color: boolean): TextureLease {
    const key = image.hash + (color ? ':color' : ':normal');
    let entry = this.entries.get(key);
    if (!entry) {
      const promise = createImageBitmap(
        new Blob([surfaceImageBytes(image).slice().buffer], { type: 'image/png' }),
        { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' },
      ).then((bitmap) => {
        const texture = new THREE.Texture(bitmap);
        texture.flipY = false;
        texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        created.texture = texture;
        return texture;
      });
      const created: { refs: number; promise: Promise<THREE.Texture>; texture?: THREE.Texture } = {
        refs: 0,
        promise,
      };
      entry = created;
      this.entries.set(key, entry);
    }
    entry.refs++;
    const owned = entry;
    let released = false;
    return {
      promise: owned.promise,
      release: () => {
        if (released) return;
        released = true;
        if (--owned.refs === 0) {
          this.entries.delete(key);
          const disposeTexture = (texture: THREE.Texture) => {
            texture.dispose();
            (texture.image as ImageBitmap).close();
          };
          // 已上传的纹理必须在 renderer.dispose 清理监听之前同步释放。
          if (owned.texture) disposeTexture(owned.texture);
          else
            void owned.promise.then(disposeTexture, () => {
              /* 解码失败已由材质加载入口报告；此处只回收引用。 */
            });
        }
      },
    };
  }
}

/** 地表网格不持有材质真相；只消费文档权重与不可变材质资源。 */
export class SurfaceMaterial {
  readonly material = new THREE.MeshStandardMaterial({ roughness: 0.96 });
  readonly regions = new SurfaceRegions();
  private pool = new SurfaceTexturePool();
  private weight = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1);
  private fallback: THREE.DataTexture[] = [];
  private leases: TextureLease[] = [];
  private pending: TextureLease[] = [];
  private key = '';
  private generation = 0;
  private disposed = false;
  ready = false;
  resourceVersion = 0;
  private cache?: SurfacePageCache;
  readonly uniforms: Record<
    string,
    { value: THREE.Texture | THREE.Vector2 | THREE.Vector4 | number }
  >;
  constructor(
    private report: (error: string) => void,
    readonly original = false,
    sharedGradients = false,
  ) {
    this.weight.magFilter = this.weight.minFilter = THREE.LinearFilter;
    this.weight.generateMipmaps = false;
    this.weight.flipY = false;
    this.uniforms = {
      uSurfaceWeights: { value: this.weight },
      uSurfaceRegions: { value: this.regions.texture },
      uSurfaceRegionSize: { value: 1 },
      uSurfaceSize: { value: new THREE.Vector2(2048, 2048) },
      uSurfaceSamples: { value: 513 },
      uSurfaceMeters: { value: new THREE.Vector4(16, 16, 32, 24) },
      uSurfaceScale: { value: 1 },
      uSurfaceDetail: { value: 0.25 },
      uSurfaceSlope: { value: 1 },
    };
    const colors = [
      [113, 131, 90],
      [149, 131, 96],
      [136, 145, 138],
      [194, 177, 130],
    ];
    for (let i = 0; i < 4; i++) {
      for (const kind of ['Color', 'Normal']) {
        const pixel = kind === 'Color' ? colors[i] : [128, 128, 255];
        const texture = new THREE.DataTexture(new Uint8Array([...pixel, 255]), 1, 1);
        texture.colorSpace = kind === 'Color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.needsUpdate = true;
        this.fallback.push(texture);
        this.uniforms[`uSurface${kind}${i}`] = { value: texture };
      }
    }
    const { declarations, color, normal } = surfaceShader(!original, sharedGradients);
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vSurfaceWorldPosition;\nvarying vec3 vSurfaceWorldNormal;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvSurfaceWorldPosition=(modelMatrix*vec4(position,1.)).xyz;\nvSurfaceWorldNormal=normalize(mat3(modelMatrix)*normal);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + declarations)
        .replace('#include <color_fragment>', color)
        .replace('#include <normal_fragment_maps>', normal);
      this.cache?.install(shader);
    };
    this.material.customProgramCacheKey = () =>
      original
        ? 'surface-original-v2'
        : sharedGradients
          ? 'surface-shared-gradients-v1'
          : 'surface-exact-v3';
  }
  useCache(cache: SurfacePageCache) {
    this.cache = cache;
    this.material.customProgramCacheKey = () => 'surface-page-cache-v2';
    this.material.needsUpdate = true;
  }
  update(doc: MapDocument, bounds?: RenderBounds) {
    this.regions.update(doc, bounds);
    this.uniforms.uSurfaceRegions.value = this.regions.texture;
    this.uniforms.uSurfaceRegionSize.value = this.regions.size;
    const n = doc.settings.samples;
    if (this.weight.image.width !== n) {
      this.weight.dispose();
      this.weight = new THREE.DataTexture(doc.surface, n, n);
      this.weight.magFilter = this.weight.minFilter = THREE.LinearFilter;
      this.weight.generateMipmaps = false;
      this.weight.flipY = false;
      this.uniforms.uSurfaceWeights.value = this.weight;
    } else this.weight.image.data = doc.surface;
    this.weight.needsUpdate = true;
    (this.uniforms.uSurfaceSize.value as THREE.Vector2).set(doc.settings.width, doc.settings.depth);
    this.uniforms.uSurfaceSamples.value = n;
    (this.uniforms.uSurfaceMeters.value as THREE.Vector4).fromArray(
      doc.surfaceMaterial.layers.map((layer) => layer.meters),
    );
    this.updateResources(doc);
  }
  updateResources(doc: MapDocument) {
    (this.uniforms.uSurfaceMeters.value as THREE.Vector4).fromArray(
      doc.surfaceMaterial.layers.map((layer) => layer.meters),
    );
    this.updateSettings(doc.surfaceMaterial);
    const key = doc.surfaceMaterial.layers
      .map((layer) => layer.color.hash + layer.normal.hash)
      .join(':');
    if (this.key !== key) {
      this.key = key;
      const generation = ++this.generation;
      this.ready = false;
      this.pending.forEach((lease) => lease.release());
      const leases = doc.surfaceMaterial.layers.flatMap((layer) => [
        this.pool.acquire(layer.color, true),
        this.pool.acquire(layer.normal, false),
      ]);
      this.pending = leases;
      void Promise.all(leases.map((lease) => lease.promise))
        .then((textures) => {
          if (this.disposed || this.generation !== generation) {
            leases.forEach((lease) => lease.release());
            return;
          }
          textures.forEach((texture, i) => {
            this.uniforms[`uSurface${i % 2 ? 'Normal' : 'Color'}${Math.floor(i / 2)}`].value =
              texture;
          });
          this.ready = true;
          this.resourceVersion++;
          this.leases.forEach((lease) => lease.release());
          this.leases = leases;
          this.pending = [];
          this.fallback.forEach((texture) => texture.dispose());
          this.fallback = [];
        })
        .catch((error: unknown) => {
          leases.forEach((lease) => lease.release());
          if (!this.disposed && this.generation === generation) {
            this.pending = [];
            this.key = '';
            this.report(`地表贴图解码失败：${String(error)}`);
          }
        });
    }
  }
  updateSettings(settings: Pick<SurfaceMaterialPack, 'scale' | 'detail' | 'slopeRock'>) {
    this.uniforms.uSurfaceScale.value = settings.scale;
    this.uniforms.uSurfaceDetail.value = settings.detail;
    this.uniforms.uSurfaceSlope.value = settings.slopeRock ? 1 : 0;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    [...this.leases, ...this.pending].forEach((lease) => lease.release());
    this.leases = [];
    this.pending = [];
    this.weight.dispose();
    this.regions.dispose();
    this.fallback.forEach((texture) => texture.dispose());
    this.material.dispose();
  }
}
