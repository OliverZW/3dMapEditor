import * as THREE from 'three';
import type { RenderInvalidation } from '../application/render-invalidation';
import type { MapDocument } from '../core/types';
import { surfaceShader } from './surface-shader';
import type { SurfaceMaterial } from './surface-material';

const EDGE = 256;
const BORDER = 8;
const SIZE = EDGE + BORDER * 2;
const PAGE_BYTES = SIZE * SIZE * 8 * 2;
const BUDGET = 256 * 1024 * 1024;
const VISIBLE_PAGES = 16;
interface Page {
  key: string;
  x: number;
  z: number;
  size: number;
  slot: number;
  touched: number;
}

const cacheDeclarations = /* glsl */ `
uniform highp sampler2DArray uSurfaceCacheColor;
uniform highp sampler2DArray uSurfaceCacheNormal;
uniform vec4 uSurfaceCachePages[16];
uniform int uSurfaceCacheCount;
vec3 surfaceCacheLookup(vec2 world, vec2 dx, vec2 dy, out vec2 gx, out vec2 gy) {
  float footprint=min(length(dx),length(dy));
  float anisotropy=max(length(dx),length(dy))/max(footprint,.000001);
  for(int i=0;i<16;i++) {
    if(i>=uSurfaceCacheCount) break;
    vec4 page=uSurfaceCachePages[i];
    vec2 uv=(world-page.xy)/page.z;
    if(all(greaterThanEqual(uv,vec2(0))) && all(lessThanEqual(uv,vec2(1))) &&
       page.z/256.<=footprint*.5 && anisotropy<=4.) {
      gx=dx/page.z*(256./272.); gy=dy/page.z*(256./272.);
      return vec3((uv*256.+8.)/272.,float(i));
    }
  }
  gx=vec2(0); gy=vec2(0); return vec3(0,0,-1);
}
uniform float uSurfaceCacheSlots[16];
`;

/** 开发验证路径。默认不分配；缓存是否可交付由固定画面和 GPU 基准共同判定。 */
export class SurfacePageCache {
  private color?: THREE.WebGLArrayRenderTarget;
  private normal?: THREE.WebGLArrayRenderTarget;
  private capacity = 0;
  private pages = new Map<string, Page>();
  private tick = 0;
  private generation = 0;
  private terrain = new THREE.DataTexture(
    new Float32Array(4),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private geometry = new THREE.PlaneGeometry(2, 2);
  private bake: THREE.ShaderMaterial;
  private disabled = false;
  private sourceVersion = -1;
  private settingsKey = '';
  private doc?: MapDocument;
  private uniforms = {
    uSurfaceCacheColor: { value: null as THREE.Texture | null },
    uSurfaceCacheNormal: { value: null as THREE.Texture | null },
    uSurfaceCachePages: { value: Array.from({ length: VISIBLE_PAGES }, () => new THREE.Vector4()) },
    uSurfaceCacheSlots: { value: new Float32Array(VISIBLE_PAGES) },
    uSurfaceCacheCount: { value: 0 },
  };
  constructor(
    private renderer: THREE.WebGLRenderer,
    private surface: SurfaceMaterial,
    readonly budgetBytes = BUDGET,
  ) {
    this.disabled = !renderer.extensions.has('EXT_color_buffer_float');
    const shader = surfaceShader(true);
    const declarations = shader.declarations
      .replace('varying vec3 vSurfaceWorldPosition;', 'vec3 vSurfaceWorldPosition;')
      .replace('varying vec3 vSurfaceWorldNormal;', 'vec3 vSurfaceWorldNormal;');
    const normal = shader.normal
      .replace('1.-smoothstep(90.,450.,length(vViewPosition))', '1.')
      .replace('if(surfaceFade*uSurfaceDetail>0.)', 'if(true)')
      .replace(/normal=normalize\(mat3\(viewMatrix\)[\s\S]*?;/, '');
    this.bake = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        ...surface.uniforms,
        uCacheTerrain: { value: this.terrain },
        uCacheBounds: { value: new THREE.Vector4() },
        uCacheOutput: { value: 0 },
      },
      vertexShader:
        'varying vec2 vPageUv; void main(){vPageUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:
        declarations +
        /* glsl */ `
        varying vec2 vPageUv;
        uniform sampler2D uCacheTerrain;
        uniform vec4 uCacheBounds;
        uniform float uCacheOutput;
        void main() {
          vec2 world=uCacheBounds.xy+vPageUv*uCacheBounds.zw;
          vec2 cell=clamp((world/uSurfaceSize+.5)*(uSurfaceSamples-1.),vec2(0),vec2(uSurfaceSamples-1.));
          vec2 base=min(floor(cell),vec2(uSurfaceSamples-2.)), f=cell-base;
          vec4 a=texelFetch(uCacheTerrain,ivec2(base),0), b=texelFetch(uCacheTerrain,ivec2(base)+ivec2(1,0),0);
          vec4 c=texelFetch(uCacheTerrain,ivec2(base)+ivec2(0,1),0), d=texelFetch(uCacheTerrain,ivec2(base)+ivec2(1,1),0);
          vec4 terrain=f.x+f.y<=1. ? a+(b-a)*f.x+(c-a)*f.y : d+(c-d)*(1.-f.x)+(b-d)*(1.-f.y);
          vSurfaceWorldPosition=vec3(world.x,terrain.w,world.y); vSurfaceWorldNormal=terrain.xyz;
          vec4 diffuseColor=vec4(1);
          ${shader.color}
          ${normal}
          gl_FragColor=uCacheOutput<.5 ? vec4(diffuseColor.rgb,1) : vec4(surfaceOffset,1);
        }`,
    });
    const mesh = new THREE.Mesh(this.geometry, this.bake);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  install(shader: Parameters<THREE.Material['onBeforeCompile']>[0]) {
    Object.assign(shader.uniforms, this.uniforms);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\n' + cacheDeclarations,
    );
    const start = shader.fragmentShader.indexOf('vec3 surfaceAlbedo=');
    const endText = 'diffuseColor.rgb=surfaceAlbedo*surfaceMacro;';
    const end = shader.fragmentShader.indexOf(endText, start) + endText.length;
    const original = shader.fragmentShader.slice(start, end);
    shader.fragmentShader =
      shader.fragmentShader.slice(0, start) +
      /* glsl */ `
      vec2 cacheDx=dFdx(vSurfaceWorldPosition.xz), cacheDy=dFdy(vSurfaceWorldPosition.xz), cacheGx, cacheGy;
      vec3 cacheUv=surfaceCacheLookup(vSurfaceWorldPosition.xz,cacheDx,cacheDy,cacheGx,cacheGy);
      bool surfaceCached=cacheUv.z>=0.;
      if(surfaceCached) {
        cacheUv.z=uSurfaceCacheSlots[int(cacheUv.z)];
        diffuseColor.rgb=textureGrad(uSurfaceCacheColor,cacheUv,cacheGx,cacheGy).rgb;
      } else { ${original} }
    ` +
      shader.fragmentShader.slice(end);
    shader.fragmentShader = shader.fragmentShader.replace(
      'surfaceOffset=surfaceNormalOffset(',
      'if(surfaceCached) surfaceOffset=textureGrad(uSurfaceCacheNormal,cacheUv,cacheGx,cacheGy).rgb;\nelse surfaceOffset=surfaceNormalOffset(',
    );
  }
  setTerrain(doc: MapDocument, geometry: THREE.BufferGeometry) {
    if (this.disabled) return;
    this.doc = doc;
    const n = doc.settings.samples,
      values = new Float32Array(n * n * 4);
    const normals = geometry.getAttribute('normal'),
      positions = geometry.getAttribute('position');
    for (let i = 0; i < n * n; i++)
      values.set([normals.getX(i), normals.getY(i), normals.getZ(i), positions.getY(i)], i * 4);
    this.terrain.dispose();
    this.terrain = new THREE.DataTexture(values, n, n, THREE.RGBAFormat, THREE.FloatType);
    this.terrain.needsUpdate = true;
    this.bake.uniforms.uCacheTerrain.value = this.terrain;
  }
  setMaterialDocument(doc: MapDocument) {
    if (!this.doc) return;
    this.doc = doc;
    this.invalidate();
  }
  invalidate(change?: RenderInvalidation) {
    this.generation++;
    if (!change?.bounds || change.kind === 'all' || change.kind === 'material') this.pages.clear();
    else if (change.kind === 'terrain' || change.kind === 'surface') {
      const b = change.bounds;
      // 法线的邻点与过滤边缘也会影响页面，保守扩大一圈地形采样格。
      const margin = this.doc
        ? (Math.max(this.doc.settings.width, this.doc.settings.depth) /
            (this.doc.settings.samples - 1)) *
          2
        : 0;
      for (const [key, p] of this.pages) {
        const extra = margin + (p.size * BORDER) / EDGE;
        if (
          p.x - extra <= b.maxX &&
          p.x + p.size + extra >= b.minX &&
          p.z - extra <= b.maxZ &&
          p.z + p.size + extra >= b.minZ
        )
          this.pages.delete(key);
      }
    }
    this.uniforms.uSurfaceCacheCount.value = 0;
  }
  private allocate(capacity: number) {
    this.color?.dispose();
    this.normal?.dispose();
    this.pages.clear();
    this.uniforms.uSurfaceCacheCount.value = 0;
    const options = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      anisotropy: 4,
    };
    this.color = new THREE.WebGLArrayRenderTarget(SIZE, SIZE, capacity, options);
    this.normal = new THREE.WebGLArrayRenderTarget(SIZE, SIZE, capacity, options);
    this.uniforms.uSurfaceCacheColor.value = this.color.texture;
    this.uniforms.uSurfaceCacheNormal.value = this.normal.texture;
    this.capacity = capacity;
  }
  update(camera: THREE.Camera, target: THREE.Vector3, viewportHeight: number) {
    if (this.disabled || !this.doc) return;
    const settings = this.doc.surfaceMaterial;
    const key = JSON.stringify([
      settings.scale,
      settings.slopeRock,
      settings.layers.map((l) => [l.meters, l.color.hash, l.normal.hash]),
    ]);
    if (key !== this.settingsKey || this.sourceVersion !== this.surface.resourceVersion) {
      this.settingsKey = key;
      this.sourceVersion = this.surface.resourceVersion;
      this.invalidate();
    }
    if (!this.surface.ready) return;
    // 半个屏幕像素的缓存纹素目标；片元路径另做实际足迹和斜率保守检查。
    const span =
      camera instanceof THREE.PerspectiveCamera
        ? camera.position.distanceTo(target) *
          2 *
          Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        : camera instanceof THREE.OrthographicCamera
          ? (camera.top - camera.bottom) / camera.zoom
          : 0;
    const size = Math.max(
      4,
      2 ** Math.floor(Math.log2(Math.max(4, (span / viewportHeight) * EDGE * 0.4))),
    );
    const requested: Omit<Page, 'slot' | 'touched'>[] = [];
    for (const level of [size, size * 2])
      for (const [dx, dz] of [
        [0, 0],
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const x = Math.floor(target.x / level) * level + dx * level,
          z = Math.floor(target.z / level) * level + dz * level;
        if (
          x > this.doc.settings.width / 2 ||
          x + level < -this.doc.settings.width / 2 ||
          z > this.doc.settings.depth / 2 ||
          z + level < -this.doc.settings.depth / 2
        )
          continue;
        requested.push({ key: `${x}:${z}:${level}`, x, z, size: level });
      }
    this.tick++;
    for (const r of requested) {
      const p = this.pages.get(r.key);
      if (p) p.touched = this.tick;
    }
    const missing = requested.find((p) => !this.pages.has(p.key));
    if (missing) {
      const terrainBytes = this.doc.settings.samples ** 2 * 16;
      const limit = Math.max(
        0,
        Math.min(128, Math.floor((Math.min(BUDGET, this.budgetBytes) - terrainBytes) / PAGE_BYTES)),
      );
      if (!limit) {
        this.disabled = true;
        return;
      }
      if (!this.capacity || (this.pages.size === this.capacity && this.capacity < limit))
        this.allocate(Math.min(limit, Math.max(8, this.capacity * 2)));
      let slot = 0;
      if (this.pages.size === this.capacity) {
        const oldest = [...this.pages.values()].sort((a, b) => a.touched - b.touched)[0];
        slot = oldest.slot;
        this.pages.delete(oldest.key);
      } else {
        const used = new Set([...this.pages.values()].map((p) => p.slot));
        while (used.has(slot)) slot++;
      }
      const generation = this.generation;
      const previous = this.renderer.getRenderTarget(),
        face = this.renderer.getActiveCubeFace(),
        mip = this.renderer.getActiveMipmapLevel();
      const viewport = this.renderer.getViewport(new THREE.Vector4()),
        scissor = this.renderer.getScissor(new THREE.Vector4()),
        scissorTest = this.renderer.getScissorTest(),
        shadowUpdate = this.renderer.shadowMap.needsUpdate;
      try {
        const margin = (missing.size * BORDER) / EDGE;
        (this.bake.uniforms.uCacheBounds.value as THREE.Vector4).set(
          missing.x - margin,
          missing.z - margin,
          missing.size + margin * 2,
          missing.size + margin * 2,
        );
        this.renderer.setScissorTest(false);
        for (const [output, rt] of [this.color!, this.normal!].entries()) {
          this.bake.uniforms.uCacheOutput.value = output;
          this.renderer.setRenderTarget(rt, slot);
          this.renderer.clear();
          this.renderer.render(this.scene, this.camera);
          const gl = this.renderer.getContext();
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
            throw new Error('材质缓存浮点目标不可用');
        }
        if (generation === this.generation)
          this.pages.set(missing.key, { ...missing, slot, touched: this.tick });
      } catch (error) {
        console.warn('材质缓存回退到原始着色', error);
        this.disabled = true;
        this.pages.clear();
        this.color?.dispose();
        this.normal?.dispose();
        this.capacity = 0;
        this.uniforms.uSurfaceCacheColor.value = null;
        this.uniforms.uSurfaceCacheNormal.value = null;
      } finally {
        this.renderer.setRenderTarget(previous, face, mip);
        this.renderer.setViewport(viewport);
        this.renderer.setScissor(scissor);
        this.renderer.setScissorTest(scissorTest);
        this.renderer.shadowMap.needsUpdate = shadowUpdate;
      }
    }
    const visible = requested
      .flatMap((r) => {
        const p = this.pages.get(r.key);
        return p ? [p] : [];
      })
      .slice(0, VISIBLE_PAGES);
    visible.forEach((p, i) => {
      this.uniforms.uSurfaceCachePages.value[i].set(p.x, p.z, p.size, 0);
      this.uniforms.uSurfaceCacheSlots.value[i] = p.slot;
    });
    this.uniforms.uSurfaceCacheCount.value = this.disabled ? 0 : visible.length;
  }
  get diagnostics() {
    return {
      pages: this.pages.size,
      capacity: this.capacity,
      bytes: this.capacity * PAGE_BYTES + (this.terrain.image.data?.byteLength ?? 0),
      disabled: this.disabled,
      generation: this.generation,
    };
  }
  dispose() {
    this.pages.clear();
    this.uniforms.uSurfaceCacheCount.value = 0;
    this.capacity = 0;
    this.uniforms.uSurfaceCacheColor.value = null;
    this.uniforms.uSurfaceCacheNormal.value = null;
    this.color?.dispose();
    this.normal?.dispose();
    this.terrain.dispose();
    this.bake.dispose();
    this.geometry.dispose();
    this.terrain.image.data = null;
  }
}
