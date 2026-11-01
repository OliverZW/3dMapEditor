const originalDeclarations = /* glsl */ `
varying vec3 vSurfaceWorldPosition;
varying vec3 vSurfaceWorldNormal;
uniform sampler2D uSurfaceWeights;
uniform sampler2D uSurfaceColor0;
uniform sampler2D uSurfaceColor1;
uniform sampler2D uSurfaceColor2;
uniform sampler2D uSurfaceColor3;
uniform sampler2D uSurfaceNormal0;
uniform sampler2D uSurfaceNormal1;
uniform sampler2D uSurfaceNormal2;
uniform sampler2D uSurfaceNormal3;
uniform vec2 uSurfaceSize;
uniform float uSurfaceSamples;
uniform vec4 uSurfaceMeters;
uniform float uSurfaceScale;
uniform float uSurfaceDetail;
uniform vec4 uSurfaceDetails;
uniform float uSurfaceSlope;
float surfaceNoise(vec2 p) {
  vec2 cell=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  vec4 a=fract(sin(vec4(dot(cell,vec2(127.1,311.7)),dot(cell+vec2(1,0),vec2(127.1,311.7)),
    dot(cell+vec2(0,1),vec2(127.1,311.7)),dot(cell+vec2(1,1),vec2(127.1,311.7))))*43758.5453);
  return mix(mix(a.x,a.y,f.x),mix(a.z,a.w,f.x),f.y);
}
vec3 surfaceColor(sampler2D image, vec3 p, vec3 n, vec3 blend) {
  vec3 signs=step(vec3(0),n)*2.-1.;
  return texture2D(image,vec2(-p.z*signs.x,p.y)).rgb*blend.x+
    texture2D(image,vec2(p.x,-p.z*signs.y)).rgb*blend.y+
    texture2D(image,vec2(p.x*signs.z,p.y)).rgb*blend.z;
}
vec3 surfaceNormalOffset(sampler2D image, vec3 p, vec3 n, vec3 blend) {
  vec3 signs=step(vec3(0),n)*2.-1.;
  vec2 nx=texture2D(image,vec2(-p.z*signs.x,p.y)).xy*2.-1.;
  vec2 ny=texture2D(image,vec2(p.x,-p.z*signs.y)).xy*2.-1.;
  vec2 nz=texture2D(image,vec2(p.x*signs.z,p.y)).xy*2.-1.;
  return vec3(0,nx.y,-nx.x*signs.x)*blend.x+
    vec3(ny.x,0,-ny.y*signs.y)*blend.y+vec3(nz.x*signs.z,nz.y,0)*blend.z;
}
`;
const originalColor = /* glsl */ `
vec3 surfaceN=normalize(vSurfaceWorldNormal);
vec3 surfaceBlend=pow(abs(surfaceN),vec3(4.));
surfaceBlend/=max(dot(surfaceBlend,vec3(1.)),.0001);
// 首末权重点位于首末高度采样点，采样落在对应纹素中心。
vec2 surfaceUv=(vSurfaceWorldPosition.xz/uSurfaceSize+.5)*(uSurfaceSamples-1.)/uSurfaceSamples+.5/uSurfaceSamples;
vec4 surfaceW=texture2D(uSurfaceWeights,surfaceUv);
surfaceW/=max(dot(surfaceW,vec4(1.)),.0001);
float slope=length(surfaceN.xz)/max(abs(surfaceN.y),.0001);
float slopeNoise=(surfaceNoise(vSurfaceWorldPosition.xz/37.)-.5)*.16;
float rock=smoothstep(.22,.95,slope+slopeNoise)*.88*uSurfaceSlope;
surfaceW*=1.-rock; surfaceW.z+=rock;
vec3 surfaceP=vSurfaceWorldPosition/uSurfaceScale;
// 连续的小幅域扰动只改变采样位置，减轻规则重复而不增加贴图采样次数。
surfaceP.xz+=(vec2(surfaceNoise(vSurfaceWorldPosition.xz/71.),
  surfaceNoise(vSurfaceWorldPosition.xz/113.+vec2(17.3,8.1)))-.5)*2.4;
vec3 surfaceAlbedo=surfaceColor(uSurfaceColor0,surfaceP/uSurfaceMeters.x,surfaceN,surfaceBlend)*surfaceW.x+
  surfaceColor(uSurfaceColor1,surfaceP/uSurfaceMeters.y,surfaceN,surfaceBlend)*surfaceW.y+
  surfaceColor(uSurfaceColor2,surfaceP/uSurfaceMeters.z,surfaceN,surfaceBlend)*surfaceW.z+
  surfaceColor(uSurfaceColor3,surfaceP/uSurfaceMeters.w,surfaceN,surfaceBlend)*surfaceW.w;
// 压低强环境光下的灰黄感；各层仍由原始权重连续混合。
vec3 surfaceTint=surfaceW.x*vec3(.63,.78,.55)+surfaceW.y*vec3(.70,.57,.43)+
  surfaceW.z*vec3(.64,.69,.68)+surfaceW.w*vec3(.90,.82,.65);
surfaceAlbedo*=surfaceTint;
float surfaceBroad=surfaceNoise(vSurfaceWorldPosition.xz/127.);
float surfaceMacro=.82+.25*surfaceBroad+.09*surfaceNoise(vSurfaceWorldPosition.xz/43.);
diffuseColor.rgb=surfaceAlbedo*surfaceMacro;
`;
const originalNormal = /* glsl */ `
float surfaceFade=1.-smoothstep(90.,450.,length(vViewPosition));
vec3 surfaceOffset=vec3(0);
if(surfaceFade*uSurfaceDetail>0.) {
  surfaceOffset=surfaceNormalOffset(uSurfaceNormal0,surfaceP/uSurfaceMeters.x,surfaceN,surfaceBlend)*surfaceW.x*uSurfaceDetails.x+
    surfaceNormalOffset(uSurfaceNormal1,surfaceP/uSurfaceMeters.y,surfaceN,surfaceBlend)*surfaceW.y*uSurfaceDetails.y+
    surfaceNormalOffset(uSurfaceNormal2,surfaceP/uSurfaceMeters.z,surfaceN,surfaceBlend)*surfaceW.z*uSurfaceDetails.z+
    surfaceNormalOffset(uSurfaceNormal3,surfaceP/uSurfaceMeters.w,surfaceN,surfaceBlend)*surfaceW.w*uSurfaceDetails.w;
  surfaceOffset*=dot(surfaceW,vec4(.55,.70,.85,.40));
}
// 投射平面的切线扰动叠加几何法线，平法线贴图不会改变原始坡面方向。
normal=normalize(mat3(viewMatrix)*normalize(surfaceN+surfaceOffset*uSurfaceDetail*surfaceFade));
`;

const exactSampling = /* glsl */ `
uniform sampler2D uSurfaceRegions;
uniform float uSurfaceRegionSize;
struct SurfaceGrad {
  vec2 x; vec2 y; vec2 z;
  vec2 xx; vec2 xy; vec2 yx; vec2 yy; vec2 zx; vec2 zy;
};
SurfaceGrad surfaceGrad(vec3 p, vec3 n) {
  vec3 signs=step(vec3(0),n)*2.-1.;
  SurfaceGrad g;
  g.x=vec2(-p.z*signs.x,p.y); g.y=vec2(p.x,-p.z*signs.y); g.z=vec2(p.x*signs.z,p.y);
  g.xx=dFdx(g.x); g.xy=dFdy(g.x); g.yx=dFdx(g.y); g.yy=dFdy(g.y); g.zx=dFdx(g.z); g.zy=dFdy(g.z);
  return g;
}
vec3 surfaceColor(sampler2D image, SurfaceGrad g, vec3 blend, float contribution) {
  vec3 x=vec3(0), y=vec3(0), z=vec3(0);
  if(contribution>0.) {
    if(blend.x>0.) x=textureGrad(image,g.x,g.xx,g.xy).rgb;
    if(blend.y>0.) y=textureGrad(image,g.y,g.yx,g.yy).rgb;
    if(blend.z>0.) z=textureGrad(image,g.z,g.zx,g.zy).rgb;
  }
  return x*blend.x+y*blend.y+z*blend.z;
}
vec3 surfaceNormalOffset(sampler2D image, SurfaceGrad g, vec3 n, vec3 blend, float contribution) {
  vec3 signs=step(vec3(0),n)*2.-1.;
  vec2 nx=vec2(0), ny=vec2(0), nz=vec2(0);
  if(contribution>0.) {
    if(blend.x>0.) nx=textureGrad(image,g.x,g.xx,g.xy).xy*2.-1.;
    if(blend.y>0.) ny=textureGrad(image,g.y,g.yx,g.yy).xy*2.-1.;
    if(blend.z>0.) nz=textureGrad(image,g.z,g.zx,g.zy).xy*2.-1.;
  }
  return vec3(0,nx.y,-nx.x*signs.x)*blend.x+vec3(ny.x,0,-ny.y*signs.y)*blend.y+vec3(nz.x*signs.z,nz.y,0)*blend.z;
}
`;

/** 原始路径用于固定画面、GPU 时间和缓存回退的独立对照。 */
export function surfaceShader(optimized: boolean, sharedGradients = false) {
  if (!optimized)
    return { declarations: originalDeclarations, color: originalColor, normal: originalNormal };
  let declarations =
    originalDeclarations.slice(0, originalDeclarations.indexOf('vec3 surfaceColor(')) +
    exactSampling;
  let color = originalColor.replace(
    'vec3 surfaceAlbedo=',
    `
vec2 region=floor(clamp(vSurfaceWorldPosition.xz/uSurfaceSize+.5,0.,1.)*(uSurfaceSamples-1.)/32.);
vec4 surfaceActive=texture2D(uSurfaceRegions,(min(region,vec2(uSurfaceRegionSize-1.))+.5)/uSurfaceRegionSize);
surfaceActive.z=max(surfaceActive.z,uSurfaceSlope);
surfaceActive*=surfaceW;
SurfaceGrad surfaceG0=surfaceGrad(surfaceP/uSurfaceMeters.x,surfaceN);
SurfaceGrad surfaceG1=surfaceGrad(surfaceP/uSurfaceMeters.y,surfaceN);
SurfaceGrad surfaceG2=surfaceGrad(surfaceP/uSurfaceMeters.z,surfaceN);
SurfaceGrad surfaceG3=surfaceGrad(surfaceP/uSurfaceMeters.w,surfaceN);
vec3 surfaceAlbedo=`,
  );
  let normal = originalNormal;
  for (let i = 0; i < 4; i++) {
    const channel = 'xyzw'[i];
    color = color.replace(
      `surfaceP/uSurfaceMeters.${channel},surfaceN,surfaceBlend)`,
      `surfaceG${i},surfaceBlend,surfaceActive.${channel})`,
    );
    normal = normal.replace(
      `surfaceP/uSurfaceMeters.${channel},surfaceN,surfaceBlend)`,
      `surfaceG${i},surfaceN,surfaceBlend,surfaceActive.${channel})`,
    );
  }
  if (sharedGradients) {
    declarations += /* glsl */ `
SurfaceGrad surfaceScaledGrad(SurfaceGrad g, float meters) {
  g.x/=meters; g.y/=meters; g.z/=meters;
  g.xx/=meters; g.xy/=meters; g.yx/=meters; g.yy/=meters; g.zx/=meters; g.zy/=meters;
  return g;
}
`;
    // 导数在任何贡献/距离分支之前计算，包含域扰动和投射方向的变化。
    color = color.replace(
      'SurfaceGrad surfaceG0=',
      'SurfaceGrad surfaceBase=surfaceGrad(surfaceP,surfaceN);\nSurfaceGrad surfaceG0=',
    );
    for (const channel of 'xyzw')
      color = color.replace(
        `surfaceGrad(surfaceP/uSurfaceMeters.${channel},surfaceN)`,
        `surfaceScaledGrad(surfaceBase,uSurfaceMeters.${channel})`,
      );
  }
  return { declarations, color, normal };
}
