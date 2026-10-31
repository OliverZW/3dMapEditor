import type { SurfaceAsset, SurfaceImage } from '../core/types';
import { imageHash, validateSurfacePng } from './image-validation';
import { resourcePath } from './project-resources';

async function imageFromCanvas(canvas: HTMLCanvasElement): Promise<SurfaceImage> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.size > 16 * 1024 * 1024) throw new Error('转换后的 PNG 超过 16 MiB 或无法生成');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const hash = imageHash(bytes);
  validateSurfacePng(bytes, hash, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    hash,
    bytes,
    resource: { origin: 'project', path: resourcePath(hash, false) },
  };
}

async function readImage(file: File): Promise<SurfaceImage> {
  if (file.size > 32 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type))
    throw new Error('请选择不超过 32 MiB 的 PNG 或 JPG 图片');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('图片无法解码，请选择有效的 PNG 或 JPG');
  }
  try {
    if (bitmap.width < 2 || bitmap.height < 2 || bitmap.width > 4096 || bitmap.height > 4096)
      throw new Error('图片每边须为 2～4096 像素');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片转换画布');
    context.drawImage(bitmap, 0, 0);
    return await imageFromCanvas(canvas);
  } finally {
    bitmap.close();
  }
}

export async function importSurfaceAsset(
  colorFile: File,
  normalFile: File | null,
  name: string,
  meters: number,
): Promise<SurfaceAsset> {
  if (!name.trim() || name.trim().length > 128) throw new Error('材质名称须为 1～128 字符');
  if (!Number.isFinite(meters) || meters < 1 || meters > 512)
    throw new Error('平铺尺度须为 1～512 米');
  const color = await readImage(colorFile);
  let normal: SurfaceImage;
  if (normalFile) {
    normal = await readImage(normalFile);
    if (normal.width !== color.width || normal.height !== color.height)
      throw new Error('颜色与法线贴图尺寸必须一致');
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = color.width;
    canvas.height = color.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建平面法线');
    context.fillStyle = 'rgb(128,128,255)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    normal = await imageFromCanvas(canvas);
  }
  return { id: `surface-${crypto.randomUUID()}`, name: name.trim(), meters, color, normal };
}
