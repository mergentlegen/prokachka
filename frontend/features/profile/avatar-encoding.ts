type CanvasPhotoFormat = "image/webp" | "image/jpeg";
let formatPromise: Promise<CanvasPhotoFormat> | undefined;

function encode(canvas: HTMLCanvasElement, type: CanvasPhotoFormat, quality: number) {
  return new Promise<Blob | null>((resolve, reject) => {
    try { canvas.toBlob(resolve, type, quality); } catch (error) { reject(error); }
  });
}

// Decoding WebP does not imply the browser can ENCODE it. Safari can silently
// export PNG instead; detect that using one tiny canvas before processing photos.
async function photoFormat() {
  if (!formatPromise) {
    formatPromise = (async () => {
      const probe = document.createElement("canvas"); probe.width = 1; probe.height = 1;
      try {
        const webp = await encode(probe, "image/webp", 0.8).catch(() => null);
        return webp?.type === "image/webp" ? "image/webp" as const : "image/jpeg" as const;
      } finally { probe.width = 1; probe.height = 1; }
    })().catch((error) => { formatPromise = undefined; throw error; });
  }
  return formatPromise;
}

export async function encodeAvatarCanvas(canvas: HTMLCanvasElement, quality: number, maxBytes = Infinity) {
  const preferred = await photoFormat();
  const formats: CanvasPhotoFormat[] = preferred === "image/webp" ? ["image/webp", "image/jpeg"] : ["image/jpeg"];
  for (const format of formats) {
    for (const currentQuality of [quality, ...[0.76, 0.64, 0.5].filter((value) => value < quality)]) {
      const blob = await encode(canvas, format, currentQuality).catch(() => null);
      if (!blob || blob.type !== format || !blob.size) break;
      if (blob.size <= maxBytes) return blob;
    }
  }
  throw new Error("Не удалось подготовить фотографию для загрузки. Попробуйте выбрать фото ещё раз.");
}
