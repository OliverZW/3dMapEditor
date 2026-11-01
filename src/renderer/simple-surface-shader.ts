/** 流畅档：四层颜色、单次宏观纹理、几何坡度；不采样法线或三平面。 */
export const simpleSurfaceShader = {
  declarations: /* glsl */ `
varying vec3 vSurfaceWorldPosition;
varying vec3 vSurfaceWorldNormal;
uniform sampler2D uSurfaceWeights;
uniform sampler2D uSurfaceColor0;
uniform sampler2D uSurfaceColor1;
uniform sampler2D uSurfaceColor2;
uniform sampler2D uSurfaceColor3;
uniform sampler2D uSurfaceMacro;
uniform vec2 uSurfaceSize;
uniform float uSurfaceSamples;
uniform vec4 uSurfaceMeters;
uniform float uSurfaceScale;
uniform float uSurfaceSlope;
`,
  color: /* glsl */ `
vec3 surfaceN=normalize(vSurfaceWorldNormal);
vec2 surfaceUv=(vSurfaceWorldPosition.xz/uSurfaceSize+.5)*(uSurfaceSamples-1.)/uSurfaceSamples+.5/uSurfaceSamples;
vec4 surfaceW=texture2D(uSurfaceWeights,surfaceUv);
surfaceW/=max(dot(surfaceW,vec4(1.)),.0001);
vec2 surfaceMacro=texture2D(uSurfaceMacro,vSurfaceWorldPosition.xz/512.).rg;
float slope=length(surfaceN.xz)/max(abs(surfaceN.y),.0001);
float rock=smoothstep(.22,.95,slope+(surfaceMacro.g-.5)*.16)*.88*uSurfaceSlope;
surfaceW*=1.-rock; surfaceW.z+=rock;
vec2 surfaceP=vec2(vSurfaceWorldPosition.x,-vSurfaceWorldPosition.z)/uSurfaceScale;
vec3 surfaceAlbedo=texture2D(uSurfaceColor0,surfaceP/uSurfaceMeters.x).rgb*surfaceW.x+
  texture2D(uSurfaceColor1,surfaceP/uSurfaceMeters.y).rgb*surfaceW.y+
  texture2D(uSurfaceColor2,surfaceP/uSurfaceMeters.z).rgb*surfaceW.z+
  texture2D(uSurfaceColor3,surfaceP/uSurfaceMeters.w).rgb*surfaceW.w;
vec3 surfaceTint=surfaceW.x*vec3(.63,.78,.55)+surfaceW.y*vec3(.70,.57,.43)+
  surfaceW.z*vec3(.64,.69,.68)+surfaceW.w*vec3(.90,.82,.65);
diffuseColor.rgb=surfaceAlbedo*surfaceTint*(.82+.25*surfaceMacro.r+.09*surfaceMacro.g);
`,
  normal: '',
};
