import * as THREE from 'three';
import type { MapDocument, SurfaceImage, SurfaceMaterialPack } from '../core/types';
import { surfaceImageBytes } from '../io/surface-resources';
import { multiSurfaceShader } from './multi-surface-shader';
import { surfaceShader } from './surface-shader';
import { simpleSurfaceShader } from './simple-surface-shader';
import { acquireSurfaceMacro } from './surface-macro';
import { SurfaceRegions } from './surface-regions';
import type { SurfacePageCache } from './surface-page-cache';
import type { RenderBounds } from '../application/render-invalidation';

interface TextureLease {
  promise: Promise<THREE.Texture>;
  release: () => void;
}
class SurfaceTexturePool {
  constructor(private anisotropy: number) {}
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
        texture.anisotropy = this.anisotropy;
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
  readonly material: THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  readonly regions = new SurfaceRegions();
  private pool: SurfaceTexturePool;
  private packedFallback = new THREE.DataArrayTexture(
    new Uint8Array([113, 131, 90, 255, 128, 128, 255, 255]),
    1,
    1,
    2,
  );
  private dynamic = false;
  private atlases: THREE.Texture[] = [];
  private extraWeight = new THREE.DataTexture(new Uint8Array(4), 1, 1);
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
  private macro?: ReturnType<typeof acquireSurfaceMacro>;
  readonly uniforms: Record<
    string,
    { value: THREE.Texture | THREE.Vector2 | THREE.Vector4 | number }
  >;
  constructor(
    private report: (error: string) => void,
    readonly original = false,
    sharedGradients = false,
    private display: { anisotropy: number; normalDetail: boolean; simplifiedSurface?: boolean } = {
      anisotropy: 4,
      normalDetail: true,
    },
    private changed: () => void = () => {},
  ) {
    this.material = display.simplifiedSurface
      ? new THREE.MeshLambertMaterial()
      : new THREE.MeshStandardMaterial({ roughness: 0.96 });
    this.pool = new SurfaceTexturePool(display.anisotropy);
    this.weight.magFilter = this.weight.minFilter = THREE.LinearFilter;
    this.weight.generateMipmaps = false;
    this.weight.flipY = false;
    this.uniforms = {
      uSurfaceWeights: { value: this.weight },
      uSurfaceWeightsExtra: { value: this.extraWeight },
      uSurfaceRock: { value: 2 },
      uSurfaceRegions: { value: this.regions.texture },
      uSurfaceRegionSize: { value: 1 },
      uSurfaceSize: { value: new THREE.Vector2(2048, 2048) },
      uSurfaceSamples: { value: 513 },
      uSurfaceMeters: { value: new THREE.Vector4(16, 16, 32, 24) },
      uSurfaceScale: { value: 1 },
      uSurfaceDetail: { value: 0.25 },
      uSurfaceDetails: { value: new THREE.Vector4(1, 1, 1, 1) },
      uSurfaceSlope: { value: 1 },
    };
    if (display.simplifiedSurface) {
      this.macro = acquireSurfaceMacro();
      this.uniforms.uSurfaceMacro = { value: this.macro.texture };
    }
    const colors = [
      [113, 131, 90],
      [149, 131, 96],
      [136, 145, 138],
      [194, 177, 130],
    ];
    for (let i = 0; i < 8; i++) {
      for (const kind of ['Color', 'Normal']) {
        const pixel = kind === 'Color' ? colors[i % 4] : [128, 128, 255];
        const texture = new THREE.DataTexture(new Uint8Array([...pixel, 255]), 1, 1);
        texture.colorSpace = kind === 'Color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.needsUpdate = true;
        this.fallback.push(texture);
        this.uniforms[`uSurface${kind}${i}`] = { value: texture };
      }
    }
    const legacy = display.simplifiedSurface
      ? simpleSurfaceShader
      : surfaceShader(!original, sharedGradients);
    this.packedFallback.needsUpdate = true;
    for (let i = 0; i < 8; i++) {
      this.uniforms[`uSurfacePacked${i}`] = { value: this.packedFallback };
      this.uniforms[`uSurfaceLayerMeters${i}`] = { value: 16 };
      this.uniforms[`uSurfaceLayerDetail${i}`] = { value: 1 };
      this.uniforms[`uSurfaceTint${i}`] = { value: new THREE.Vector4(1, 1, 1, 1) };
    }
    this.material.onBeforeCompile = (shader) => {
      const { declarations, color, normal } = this.dynamic
        ? multiSurfaceShader(!!display.simplifiedSurface)
        : legacy;
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
      if (!this.dynamic) this.cache?.install(shader);
    };
    this.material.customProgramCacheKey = () =>
      this.dynamic
        ? 'surface-multi-v1-' + !!display.simplifiedSurface
        : display.simplifiedSurface
          ? 'surface-simple-xz-v1'
          : original
            ? 'surface-original-v2'
            : sharedGradients
              ? 'surface-shared-gradients-v1'
              : 'surface-exact-v3';
  }
  useCache(cache: SurfacePageCache) {
    this.cache = cache;
    this.material.customProgramCacheKey = () => 'surface-page-cache-v2-' + this.dynamic;
    this.material.needsUpdate = true;
  }
  private updateMode(doc: MapDocument) {
    const dynamic =
      doc.surfaceMaterial.layers.length !== 4 ||
      doc.surfaceMaterial.layers.some(
        (layer, i) => layer.id !== ['grass', 'soil', 'rock', 'sand'][i],
      ) ||
      !!doc.surfaceMaterial.slopeLayerId;
    if (dynamic !== this.dynamic) {
      this.dynamic = dynamic;
      this.material.needsUpdate = true;
    }
  }
  update(doc: MapDocument, bounds?: RenderBounds) {
    this.updateMode(doc);
    if (!this.display.simplifiedSurface && !this.dynamic) this.regions.update(doc, bounds);
    this.uniforms.uSurfaceRegions.value = this.regions.texture;
    this.uniforms.uSurfaceRegionSize.value = this.regions.size;
    const n = doc.settings.samples;
    const count = doc.surfaceMaterial.layers.length;
    const first = count === 4 ? doc.surface : new Uint8Array(n * n * 4);
    const extra = new Uint8Array(n * n * 4);
    if (count !== 4)
      for (let i = 0; i < n * n; i++)
        for (let c = 0; c < count; c++)
          (c < 4 ? first : extra)[i * 4 + (c % 4)] = doc.surface[i * count + c];
    this.extraWeight.dispose();
    this.extraWeight = new THREE.DataTexture(extra, n, n);
    this.extraWeight.magFilter = this.extraWeight.minFilter = THREE.LinearFilter;
    this.extraWeight.generateMipmaps = false;
    this.extraWeight.flipY = false;
    this.extraWeight.needsUpdate = true;
    this.uniforms.uSurfaceWeightsExtra.value = this.extraWeight;
    if (this.weight.image.width !== n) {
      this.weight.dispose();
      this.weight = new THREE.DataTexture(first, n, n);
      this.weight.magFilter = this.weight.minFilter = THREE.LinearFilter;
      this.weight.generateMipmaps = false;
      this.weight.flipY = false;
      this.uniforms.uSurfaceWeights.value = this.weight;
    } else this.weight.image.data = first;
    this.weight.needsUpdate = true;
    (this.uniforms.uSurfaceSize.value as THREE.Vector2).set(doc.settings.width, doc.settings.depth);
    this.uniforms.uSurfaceSamples.value = n;
    (this.uniforms.uSurfaceMeters.value as THREE.Vector4).fromArray(
      doc.surfaceMaterial.layers.map((layer) => layer.meters),
    );
    this.updateResources(doc);
  }
  updateResources(doc: MapDocument) {
    this.updateMode(doc);

    (this.uniforms.uSurfaceMeters.value as THREE.Vector4).fromArray(
      doc.surfaceMaterial.layers.map((layer) => layer.meters),
    );
    this.uniforms.uSurfaceRock.value = Math.max(
      0,
      doc.surfaceMaterial.layers.findIndex(
        (layer) => layer.id === (doc.surfaceMaterial.slopeLayerId ?? 'rock'),
      ),
    );
    for (let i = 0; i < 8; i++)
      this.uniforms[`uSurfaceLayerMeters${i}`].value = doc.surfaceMaterial.layers[i]?.meters ?? 16;
    const tints: Record<string, number[]> = {
      grass: [0.63, 0.78, 0.55],
      soil: [0.7, 0.57, 0.43],
      rock: [0.64, 0.69, 0.68],
      sand: [0.9, 0.82, 0.65],
    };
    for (let i = 0; i < 8; i++)
      (this.uniforms[`uSurfaceTint${i}`].value as THREE.Vector4).fromArray([
        ...(tints[doc.surfaceMaterial.layers[i]?.id] ?? [1, 1, 1]),
        1,
      ]);
    this.updateSettings(doc.surfaceMaterial);
    const key =
      String(this.dynamic) +
      doc.surfaceMaterial.layers
        .map(
          (layer) =>
            layer.color.hash +
            (this.display.simplifiedSurface && !this.dynamic ? '' : layer.normal.hash),
        )
        .join(':');
    if (this.key !== key) {
      this.key = key;
      const generation = ++this.generation;
      this.ready = false;
      this.pending.forEach((lease) => lease.release());
      const requests = doc.surfaceMaterial.layers.flatMap((layer, index) => {
        const color = {
          uniform: `uSurfaceColor${index}`,
          lease: this.pool.acquire(layer.color, true),
        };
        return this.display.simplifiedSurface && !this.dynamic
          ? [color]
          : [
              color,
              { uniform: `uSurfaceNormal${index}`, lease: this.pool.acquire(layer.normal, false) },
            ];
      });
      const leases = requests.map((request) => request.lease);
      this.pending = leases;
      void Promise.all(leases.map((lease) => lease.promise))
        .then((textures) => {
          if (this.disposed || this.generation !== generation) {
            leases.forEach((lease) => lease.release());
            return;
          }
          if (this.dynamic) {
            this.atlases.forEach((texture) => texture.dispose());
            this.atlases = [];
            for (let i = 0; i < doc.surfaceMaterial.layers.length; i++) {
              const color = textures[i * 2].image as ImageBitmap,
                normal = textures[i * 2 + 1].image as ImageBitmap;
              const canvas = document.createElement('canvas');
              canvas.width = color.width;
              canvas.height = color.height * 2;
              const context = canvas.getContext('2d');
              if (!context) throw new Error('无法创建地表贴图');
              context.drawImage(color, 0, 0);
              context.drawImage(normal, 0, color.height);
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
              const atlas = new THREE.DataArrayTexture(
                new Uint8Array(pixels.buffer),
                color.width,
                color.height,
                2,
              );
              atlas.wrapS = atlas.wrapT = THREE.RepeatWrapping;
              atlas.generateMipmaps = true;
              atlas.minFilter = THREE.LinearMipmapLinearFilter;
              atlas.magFilter = THREE.LinearFilter;
              atlas.needsUpdate = true;
              atlas.colorSpace = THREE.NoColorSpace;
              atlas.flipY = false;
              atlas.anisotropy = this.display.anisotropy;
              this.atlases.push(atlas);
              this.uniforms[`uSurfacePacked${i}`].value = atlas;
            }
            for (let i = doc.surfaceMaterial.layers.length; i < 8; i++)
              this.uniforms[`uSurfacePacked${i}`].value = this.atlases[0];
          }
          if (!this.dynamic)
            textures.forEach((texture, i) => {
              this.uniforms[requests[i].uniform].value = texture;
            });
          this.ready = true;
          this.changed();
          this.resourceVersion++;
          this.leases.forEach((lease) => lease.release());
          if (this.dynamic) {
            leases.forEach((lease) => lease.release());
            this.leases = [];
          } else this.leases = leases;
          this.pending = [];
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
  updateSettings(
    settings: Pick<SurfaceMaterialPack, 'scale' | 'detail' | 'slopeRock'> &
      Partial<Pick<SurfaceMaterialPack, 'layers'>>,
  ) {
    this.uniforms.uSurfaceScale.value = settings.scale;
    const layers = settings.layers;
    const detail = Math.max(
      settings.detail,
      ...(layers ?? []).map((layer) => layer.detail ?? settings.detail),
    );
    this.uniforms.uSurfaceDetail.value = this.display.normalDetail ? detail : 0;
    if (layers) {
      const meters = layers.map(
        (layer) => (layer.meters * (layer.scale ?? settings.scale)) / settings.scale,
      );
      (this.uniforms.uSurfaceMeters.value as THREE.Vector4).fromArray(
        Array.from({ length: 4 }, (_, i) => meters[i] ?? 16),
      );
      const details = layers.map(
        (layer) => (layer.detail ?? settings.detail) / Math.max(detail, 0.00001),
      );
      (this.uniforms.uSurfaceDetails.value as THREE.Vector4).fromArray(
        Array.from({ length: 4 }, (_, i) => details[i] ?? 0),
      );
      for (let i = 0; i < 8; i++) {
        this.uniforms[`uSurfaceLayerMeters${i}`].value = meters[i] ?? 16;
        this.uniforms[`uSurfaceLayerDetail${i}`].value = details[i] ?? 0;
      }
    }
    this.uniforms.uSurfaceSlope.value = settings.slopeRock ? 1 : 0;
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    [...this.leases, ...this.pending].forEach((lease) => lease.release());
    this.leases = [];
    this.pending = [];
    this.weight.dispose();
    this.extraWeight.dispose();
    this.packedFallback.dispose();
    this.atlases.forEach((texture) => texture.dispose());
    this.regions.dispose();
    this.macro?.release();
    this.fallback.forEach((texture) => texture.dispose());
    this.material.dispose();
  }
}
