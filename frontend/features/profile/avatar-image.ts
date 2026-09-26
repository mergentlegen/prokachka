import { AVATAR_INPUT_MAX_BYTES, AVATAR_INPUT_MAX_PIXELS, AVATAR_PREVIEW_MAX_EDGE, AVATAR_SIZE, AVATAR_UPLOAD_MAX_BYTES } from "@/shared/domain/profile";
import { avatarSourceFormat, heifMaxPixels } from "./avatar-source";
import { encodeAvatarCanvas } from "./avatar-encoding";

export type AvatarImage = { url: string; image: HTMLImageElement; width: number; height: number };
export type AvatarCrop = { x: number; y: number; zoom: number };
export const initialCrop: AvatarCrop = { x: 0.5, y: 0.5, zoom: 1 };
export function cropRegion(width: number, height: number, crop: AvatarCrop) {
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const side = Math.min(width, height) / clamp(crop.zoom, 1, 3);
  return { left: (width - side) * clamp(crop.x, 0, 1), top: (height - side) * clamp(crop.y, 0, 1), side };
}

class AvatarImageError extends Error {}
function checkDimensions(width: number, height: number) {
  if (!width || !height || width * height > AVATAR_INPUT_MAX_PIXELS) throw new AvatarImageError("Выберите фотографию до 60 мегапикселей. Обычные снимки телефона на 24 и 48 Мп подходят.");
}
async function browserImage(blob: Blob): Promise<AvatarImage> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    return { url, image, width, height };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

async function smallPreview(source: CanvasImageSource, width: number, height: number) {
  checkDimensions(width, height);
  const ratio = Math.min(1, AVATAR_PREVIEW_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new AvatarImageError("Не удалось подготовить фотографию.");
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return await browserImage(await encodeAvatarCanvas(canvas, 0.92));
  } finally { canvas.width = 1; canvas.height = 1; }
}

export async function loadAvatarImage(file: File): Promise<AvatarImage> {
  if (!file.size || file.size > AVATAR_INPUT_MAX_BYTES) throw new AvatarImageError("Размер исходной фотографии должен быть не больше 25 МБ.");
  const format = avatarSourceFormat(new Uint8Array(await file.slice(0, 256).arrayBuffer()));
  if (!format) throw new AvatarImageError("Выберите фотографию JPG, PNG, WebP, HEIC или HEIF.");
  if (format === "heif") {
    const pixels = heifMaxPixels(new Uint8Array(await file.arrayBuffer()));
    if (pixels > AVATAR_INPUT_MAX_PIXELS) checkDimensions(pixels, 1);
  }
  let native: AvatarImage;
  try { native = await browserImage(file); }
  catch {
    if (format !== "heif") throw new AvatarImageError("Не удалось открыть фотографию. Выберите другой файл.");
    // Safari can decode phone HEIF natively. Other browsers download this codec
    // only when required; the eval-free version decodes in a local Web Worker.
    let bitmap: ImageBitmap | undefined;
    try {
      const { heicTo } = await import("heic-to/csp");
      bitmap = await heicTo({ blob: file, type: "bitmap" });
      return await smallPreview(bitmap, bitmap.width, bitmap.height);
    } catch (error) {
      if (error instanceof AvatarImageError) throw error;
      throw new AvatarImageError("Не удалось прочитать это HEIC/HEIF-фото. Попробуйте другой снимок или сохраните его как JPG.");
    } finally { bitmap?.close(); }
  }
  let retained = false;
  try {
    checkDimensions(native.width, native.height);
    if (Math.max(native.width, native.height) <= AVATAR_PREVIEW_MAX_EDGE) { retained = true; return native; }
    return await smallPreview(native.image, native.width, native.height);
  } catch (error) {
    if (error instanceof AvatarImageError) throw error;
    throw new AvatarImageError("Не удалось уменьшить фотографию. Выберите другой файл.");
  } finally {
    if (!retained) {
      native.image.src = ""; URL.revokeObjectURL(native.url);
    }
  }
}

export async function prepareAvatar(image: AvatarImage, crop: AvatarCrop): Promise<Blob> {
  const canvas = document.createElement("canvas"); canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось подготовить фотографию.");
    const region = cropRegion(image.width, image.height, crop);
    context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image.image, region.left, region.top, region.side, region.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    return await encodeAvatarCanvas(canvas, 0.85, AVATAR_UPLOAD_MAX_BYTES);
  } finally { canvas.width = 1; canvas.height = 1; }
}
