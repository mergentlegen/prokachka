import { AVATAR_INPUT_MAX_BYTES, AVATAR_INPUT_MAX_PIXELS, AVATAR_MIME_TYPES, AVATAR_SIZE, AVATAR_UPLOAD_MAX_BYTES } from "@/shared/domain/profile";

export type AvatarImage = { url: string; image: HTMLImageElement; width: number; height: number };
export type AvatarCrop = { x: number; y: number; zoom: number };
export const initialCrop: AvatarCrop = { x: 0.5, y: 0.5, zoom: 1 };
export function cropRegion(width: number, height: number, crop: AvatarCrop) {
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  const side = Math.min(width, height) / clamp(crop.zoom, 1, 3);
  return { left: (width - side) * clamp(crop.x, 0, 1), top: (height - side) * clamp(crop.y, 0, 1), side };
}

export async function loadAvatarImage(file: File): Promise<AvatarImage> {
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) throw new Error("Выберите фотографию в формате JPG, PNG или WebP.");
  if (!file.size || file.size > AVATAR_INPUT_MAX_BYTES) throw new Error("Размер фотографии должен быть не больше 5 МБ.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > AVATAR_INPUT_MAX_PIXELS) throw new Error("Выберите фотографию меньшего разрешения — до 24 мегапикселей.");
    return { url, image, width, height };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof Error && error.message.includes("мегапикселей") ? error : new Error("Не удалось открыть фотографию. Выберите другой файл.");
  }
}

export async function prepareAvatar(image: AvatarImage, crop: AvatarCrop): Promise<Blob> {
  const canvas = document.createElement("canvas"); canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Не удалось подготовить фотографию.");
  const region = cropRegion(image.width, image.height, crop);
  context.drawImage(image.image, region.left, region.top, region.side, region.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (!blob || blob.size > AVATAR_UPLOAD_MAX_BYTES) throw new Error("Не удалось уменьшить фотографию. Попробуйте другой файл.");
  return blob;
}
