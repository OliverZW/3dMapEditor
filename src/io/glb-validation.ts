export function validateStaticGlb(bytes: Uint8Array, maxBytes = 32 * 1024 * 1024): void {
  if (bytes.length > maxBytes) throw new Error(`GLB 超过 ${maxBytes / 1024 / 1024} MiB 限制`);
  if (bytes.length < 20) throw new Error('GLB 文件过短');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length
  )
    throw new Error('请选择有效的 GLB 2.0 文件');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.length - 20)
    throw new Error('GLB JSON 块无效');
  const json: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('GLB 描述无效');
  const data = json as Record<string, unknown>;
  for (const key of ['buffers', 'images', 'skins', 'animations'])
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error('GLB 数据结构无效');
  if (
    (data.skins as unknown[] | undefined)?.length ||
    (data.animations as unknown[] | undefined)?.length
  )
    throw new Error('当前只接受静态模型，请移除骨骼与动画');
  for (const item of [
    ...((data.buffers as unknown[]) ?? []),
    ...((data.images as unknown[]) ?? []),
  ]) {
    if (!item || typeof item !== 'object') throw new Error('GLB 资源结构无效');
    const uri = (item as Record<string, unknown>).uri;
    if (uri !== undefined && (typeof uri !== 'string' || !uri.startsWith('data:')))
      throw new Error('GLB 必须内嵌全部模型与纹理');
  }
}
