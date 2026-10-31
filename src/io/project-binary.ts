export function floatBytes(values: Float32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4),
    view = new DataView(out.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return out;
}
export function uintBytes(values: Uint32Array): Uint8Array {
  const out = new Uint8Array(values.length * 4),
    view = new DataView(out.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return out;
}
