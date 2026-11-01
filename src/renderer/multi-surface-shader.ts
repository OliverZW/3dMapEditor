/** 每层颜色与法线打包到同一纹理，八层仍仅占用十个采样器。 */
export function multiSurfaceShader(simple: boolean) {
  const sample = (i: number, normal = false) =>
    `surfaceSample(uSurfacePacked${i},surfaceP/uSurfaceLayerMeters${i},surfaceN,${normal ? '1.' : '0.'})`;
  return {
    declarations: `varying vec3 vSurfaceWorldPosition; varying vec3 vSurfaceWorldNormal;
uniform sampler2D uSurfaceWeights; uniform sampler2D uSurfaceWeightsExtra;
uniform vec2 uSurfaceSize; uniform float uSurfaceSamples; uniform float uSurfaceScale; uniform float uSurfaceDetail; uniform float uSurfaceSlope; uniform float uSurfaceRock;
${Array.from({ length: 8 }, (_, i) => `uniform sampler2DArray uSurfacePacked${i}; uniform float uSurfaceLayerMeters${i}; uniform float uSurfaceLayerDetail${i}; uniform vec4 uSurfaceTint${i};`).join('\n')}
vec3 surfaceTile(sampler2DArray image, vec2 uv, float kind) {
  return textureGrad(image,vec3(uv,kind),dFdx(uv),dFdy(uv)).rgb;
}
vec3 surfaceSample(sampler2DArray image, vec3 p, vec3 n, float kind) {
  ${simple ? 'return surfaceTile(image,p.xz,kind);' : 'vec3 b=pow(abs(n),vec3(4.)); b/=max(dot(b,vec3(1.)),.0001); return surfaceTile(image,p.zy,kind)*b.x+surfaceTile(image,p.xz,kind)*b.y+surfaceTile(image,p.xy,kind)*b.z;'}
}
vec3 surfaceLinear(vec3 c) { return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c)); }
`,
    color: `vec3 surfaceN=normalize(vSurfaceWorldNormal); vec3 surfaceP=vSurfaceWorldPosition/uSurfaceScale;
vec2 surfaceUv=(vSurfaceWorldPosition.xz/uSurfaceSize+.5)*(uSurfaceSamples-1.)/uSurfaceSamples+.5/uSurfaceSamples;
vec4 w0=texture2D(uSurfaceWeights,surfaceUv), w1=texture2D(uSurfaceWeightsExtra,surfaceUv);
float total=max(dot(w0+w1,vec4(1.)),.0001); w0/=total; w1/=total;
float rock=smoothstep(.22,.95,length(surfaceN.xz)/max(abs(surfaceN.y),.0001))*.88*uSurfaceSlope;
w0*=1.-rock; w1*=1.-rock;
${Array.from({ length: 8 }, (_, i) => `if(abs(uSurfaceRock-${i}.)<.1) ${i < 4 ? 'w0' : 'w1'}.${'xyzw'[i % 4]}+=rock;`).join('\n')}
vec3 surfaceAlbedo=vec3(0.);
${Array.from({ length: 8 }, (_, i) => `surfaceAlbedo+=surfaceLinear(${sample(i)})*${i < 4 ? 'w0' : 'w1'}.${'xyzw'[i % 4]};`).join('\n')}
vec3 tint=vec3(0.);
${Array.from({ length: 8 }, (_, i) => `tint+=uSurfaceTint${i}.rgb*${i < 4 ? 'w0' : 'w1'}.${'xyzw'[i % 4]};`).join('\n')}
diffuseColor.rgb=surfaceAlbedo*tint;
`,
    normal: simple
      ? ''
      : `vec3 offset=vec3(0.);
${Array.from({ length: 8 }, (_, i) => `offset+=(${sample(i, true)}*2.-1.-vec3(0.,0.,1.))*${i < 4 ? 'w0' : 'w1'}.${'xyzw'[i % 4]}*uSurfaceLayerDetail${i};`).join('\n')}
normal=normalize(normal+mat3(viewMatrix)*vec3(offset.x,0.,offset.y)*uSurfaceDetail*(1.-smoothstep(90.,450.,length(vViewPosition))));`,
  };
}
