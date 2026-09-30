import { encodeAvatarCanvas } from "@/frontend/features/profile/avatar-encoding";
import { loadAvatarImage } from "@/frontend/features/profile/avatar-image";

// Keep the original aspect ratio, remove EXIF/location data, and send a bounded
// high-resolution image. The server decodes and normalizes it again.
export async function prepareAnnouncementPhoto(file: File): Promise<File> {
  const loaded = await loadAvatarImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = loaded.width; canvas.height = loaded.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Не удалось подготовить фотографию.");
    context.drawImage(loaded.image, 0, 0);
    const blob = await encodeAvatarCanvas(canvas, 0.88, 3 * 1024 * 1024);
    return new File([blob], `${crypto.randomUUID()}.${blob.type === "image/webp" ? "webp" : "jpg"}`, { type: blob.type });
  } finally {
    canvas.width = 1; canvas.height = 1;
    loaded.image.src = "";
    URL.revokeObjectURL(loaded.url);
  }
}
