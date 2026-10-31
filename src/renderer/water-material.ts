import { defaultWaterMaterial } from '../core/water-material';
import type { WaterMaterialPack } from '../core/types';
import { surfaceImageBytes } from '../io/surface-resources';
import * as THREE from 'three';

/** 同一文档的河流共用纹理；切换资源时由 WaterSurface 释放旧实例。 */
export class WaterMaterial {
  readonly material = new THREE.MeshStandardMaterial({
    ...defaultWaterMaterial().material,
    transparent: true,
    // 同水位几何已去重；写深度以遮住后绘制的水下辖区叠层。
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  readonly time = { value: 0 };
  private ready = { value: 0 };
  private normal = { value: null as THREE.Texture | null };
  private mask = { value: null as THREE.Texture | null };
  private disposed = false;

  constructor(
    onError: (message: string) => void,
    private resources: WaterMaterialPack = defaultWaterMaterial(),
  ) {
    this.material.setValues(resources.material);
    this.material.name = 'RiverWater';
    this.material.customProgramCacheKey = () => 'river-water-v3';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        uWaterTime: this.time,
        uWaterReady: this.ready,
        uWaterNormal: this.normal,
        uWaterMask: this.mask,
        uShallowColor: { value: new THREE.Color(0x65968b) },
        uDeepColor: { value: new THREE.Color(0x315565) },
        uSkyColor: { value: new THREE.Color(0xb2c8cb) },
      });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
        attribute float waterDepth;
        attribute float shoreMeters;
        attribute vec2 waterFlow;
        varying vec3 vWaterWorld;
        varying float vWaterDepth;
        varying float vShoreMeters;
        varying vec2 vWaterFlow;
      `,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
        vWaterWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vWaterDepth = waterDepth;
        vShoreMeters = shoreMeters;
        vWaterFlow = waterFlow;
      `,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
        uniform float uWaterTime;
        uniform float uWaterReady;
        uniform sampler2D uWaterNormal;
        uniform sampler2D uWaterMask;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform vec3 uSkyColor;
        varying vec3 vWaterWorld;
        varying float vWaterDepth;
        varying float vShoreMeters;
        varying vec2 vWaterFlow;

        // 值噪声同时返回解析梯度，提供中远景仍有尺度的起伏，而非颜色条纹。
        float waterHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        vec3 waterNoise(vec2 p) {
          vec2 cell = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
          float a = waterHash(cell), b = waterHash(cell + vec2(1.0, 0.0));
          float c = waterHash(cell + vec2(0.0, 1.0)), d = waterHash(cell + vec2(1.0));
          return vec3(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),
            mix(b-a,d-c,u.y)*du.x, mix(c-a,d-b,u.x)*du.y);
        }
        vec2 waterDirection(vec2 flow) {
          return flow / max(length(flow), 0.0001);
        }
        vec2 waterFlowSpace(vec2 p, vec2 flow) {
          vec2 dir = waterDirection(flow);
          // 顺流拉长、横流压缩，避免各向同性噪声像碎泡沫。
          return vec2(dot(p, vec2(-dir.y, dir.x)) * 1.18, dot(p, dir) * 0.68);
        }
        vec2 waterWaves(vec2 p, vec2 flow, float detailFade, float microFade) {
          vec2 q = waterFlowSpace(p, flow);
          vec2 local = waterNoise(q / 24.0).yz * 0.22;
          local += (texture2D(uWaterNormal, q / 12.0).xy * 2.0 - 1.0) * 0.32;
          local += (texture2D(uWaterNormal, q / 5.5 + vec2(0.31, 0.73)).xy * 2.0 - 1.0) * 0.28 * detailFade;
          local += (texture2D(uWaterNormal, q / 2.4).xy * 2.0 - 1.0) * 0.10 * microFade;
          vec2 dir = waterDirection(flow);
          return vec2(-dir.y, dir.x) * local.x + dir * local.y;
        }
      `,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
        if (uWaterReady > 0.5) {
          if (vWaterDepth < 0.01) discard;
          float depthBlend = 1.0 - exp(-max(vWaterDepth, 0.0) / 3.4);
          diffuseColor.rgb = mix(uShallowColor, uDeepColor, depthBlend) * vec3(0.72, 0.84, 0.90);
          diffuseColor.a = mix(0.34, 0.93, 1.0 - exp(-max(vWaterDepth, 0.0) / 1.8));
          diffuseColor.a *= smoothstep(0.0, 0.18, max(vWaterDepth, 0.0));
          float flowPhase = mod(uWaterTime, 12.0);
          float flowBlend = 1.0 - abs(flowPhase / 6.0 - 1.0);
          vec2 first = vWaterWorld.xz - vWaterFlow * 0.8 * flowPhase;
          vec2 second = vWaterWorld.xz - vWaterFlow * 0.8 * mod(uWaterTime + 6.0, 12.0);
          vec2 firstFlow = waterFlowSpace(first, vWaterFlow);
          vec2 secondFlow = waterFlowSpace(second, vWaterFlow);
          float fragments = mix(texture2D(uWaterMask, secondFlow / 5.5).r,
            texture2D(uWaterMask, firstFlow / 5.5).r, flowBlend);
          float broadFlow = mix(texture2D(uWaterMask, secondFlow / 17.0).r,
            texture2D(uWaterMask, firstFlow / 17.0).r, flowBlend);
          float firstLine = 0.5 + 0.5 * sin(firstFlow.y * 0.70 + sin(firstFlow.x * 0.40) * 1.4);
          float secondLine = 0.5 + 0.5 * sin(secondFlow.y * 0.70 + sin(secondFlow.x * 0.40) * 1.4);
          float flowLine = mix(secondLine, firstLine, flowBlend);
          // 俯视时菲涅尔反光较弱，由连续流线补足动感；斜视仍保持克制。
          float topView = smoothstep(0.55, 0.95, normalize(cameraPosition - vWaterWorld).y);
          float lineStrength = mix(0.25, 0.65, topView);
          diffuseColor.rgb *= 1.0 - lineStrength + 0.10 * smoothstep(0.20, 0.80, broadFlow) +
            0.05 * smoothstep(0.18, 0.82, fragments) + lineStrength * flowLine;
          float shore = (1.0 - smoothstep(0.08, 0.65, vShoreMeters)) * smoothstep(0.08, 0.35, vWaterDepth);
          diffuseColor.rgb += vec3(0.055, 0.065, 0.055) * shore * smoothstep(0.58, 0.88, fragments);
        }
      `,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
        if (uWaterReady > 0.5) {
          float waterRoughness = waterNoise(waterFlowSpace(vWaterWorld.xz, vWaterFlow) / 11.0).x;
          roughnessFactor = clamp(0.24 + (waterRoughness - 0.5) * 0.10, 0.18, 0.34);
        }
      `,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
        if (uWaterReady > 0.5) {
          float distanceToEye = length(vViewPosition);
          float detailFade = 1.0 - smoothstep(600.0, 2400.0, distanceToEye);
          float microFade = 1.0 - smoothstep(160.0, 850.0, distanceToEye);
          // 双相流图平移：隐藏周期重置，避免变向区域随总运行时间不断拉伸。
          float phase = mod(uWaterTime, 12.0), otherPhase = mod(uWaterTime + 6.0, 12.0);
          float blend = 1.0 - abs(phase / 6.0 - 1.0);
          vec2 first = vWaterWorld.xz - vWaterFlow * 0.8 * phase;
          vec2 second = vWaterWorld.xz - vWaterFlow * 0.8 * otherPhase;
          vec2 waves = mix(waterWaves(second, vWaterFlow, detailFade, microFade),
            waterWaves(first, vWaterFlow, detailFade, microFade), blend);
          vec3 worldNormal = normalize(vec3(waves.x, 1.0, -waves.y));
          normal = normalize(mat3(viewMatrix) * worldNormal);
          // 河带三角形绕序朝下；这里已直接定义世界向上法线，不能按面朝向再次翻转。
        }
      `,
        )
        .replace(
          '#include <opaque_fragment>',
          `
        if (uWaterReady > 0.5) {
          float fresnel = 0.025 + 0.52 * pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);
          vec3 eyeWorld = normalize(cameraPosition - vWaterWorld);
          vec3 waveWorld = inverseTransformDirection(normal, viewMatrix);
          vec3 reflected = reflect(-eyeWorld, waveWorld);
          float clouds = waterNoise(reflected.xz * 6.0 + reflected.y * vec2(3.1, -2.7)).x;
          float lightCloud = smoothstep(0.45, 0.83, clouds);
          vec3 sky = uSkyColor * mix(0.72, 1.10, smoothstep(-0.1, 0.9, reflected.y));
          // 近景限制高光能量，远景适度补偿；冷色亮纹不再盖住水色。
          float skyEnergy = mix(4.0, 5.4, smoothstep(500.0, 1100.0, length(vViewPosition)));
          sky += vec3(skyEnergy, skyEnergy * 1.06, skyEnergy * 1.10) * pow(lightCloud, 3.0) /
            (1.0 + fresnel * 4.0);
          outgoingLight = mix(outgoingLight, sky, fresnel * 0.85);
          diffuseColor.a = max(diffuseColor.a, fresnel * 0.7 * smoothstep(0.0, 0.3, vWaterDepth));
        }
        #include <opaque_fragment>
      `,
        );
    };
    void this.load().catch((error: unknown) => {
      if (!this.disposed) onError(`水纹资源加载失败，已保留基础水面：${String(error)}`);
    });
  }

  private async load() {
    const results = await Promise.allSettled(
      [this.resources.normal, this.resources.mask].map(async (image) => {
        const bytes = surfaceImageBytes(image);
        const bitmap = await createImageBitmap(
          new Blob([bytes.slice().buffer], { type: 'image/png' }),
          {
            imageOrientation: 'flipY',
            premultiplyAlpha: 'none',
            colorSpaceConversion: 'none',
          },
        );
        if (this.disposed) {
          bitmap.close();
          throw new Error('视口已关闭');
        }
        const texture = new THREE.Texture(bitmap);
        texture.flipY = false;
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        return texture;
      }),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (this.disposed || failed) {
      for (const r of results) if (r.status === 'fulfilled') this.release(r.value);
      if (failed?.status === 'rejected') throw failed.reason;
      return;
    }
    this.normal.value = (results[0] as PromiseFulfilledResult<THREE.Texture>).value;
    this.mask.value = (results[1] as PromiseFulfilledResult<THREE.Texture>).value;
    this.ready.value = 1;
  }

  private release(texture: THREE.Texture) {
    texture.dispose();
    (texture.image as ImageBitmap).close();
  }

  dispose() {
    this.disposed = true;
    for (const uniform of [this.normal, this.mask]) {
      if (uniform.value) this.release(uniform.value);
      uniform.value = null;
    }
    this.ready.value = 0;
    this.material.dispose();
  }
}
