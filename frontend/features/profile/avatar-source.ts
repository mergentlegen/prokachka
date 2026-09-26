// Inspect actual bytes: phone pickers sometimes omit or change the MIME type.
export type AvatarSourceFormat = "jpeg" | "png" | "webp" | "heif";
const text = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
export function avatarSourceFormat(bytes: Uint8Array): AvatarSourceFormat | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "png";
  if (text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 12) === "WEBP") return "webp";
  if (text(bytes, 4, 8) !== "ftyp" || bytes.length < 16) return null;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const brands = [text(bytes, 8, 12)];
  for (let offset = 16; offset + 4 <= Math.min(size, bytes.length); offset += 4) brands.push(text(bytes, offset, offset + 4));
  if (brands.some((brand) => ["avif", "avis"].includes(brand))) return null;
  return brands.some((brand) => ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) ? "heif" : null;
}

// Guard HEIF dimensions before invoking the software codec. Walk only declared
// ISO-BMFF property containers, not arbitrary "ispe" byte matches in image data.
export function heifMaxPixels(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let maxPixels = 0, boxes = 0;
  function walk(start: number, end: number, depth: number) {
    if (depth > 6) return;
    for (let offset = start; offset + 8 <= end && boxes++ < 4096;) {
      let size = view.getUint32(offset), header = 8;
      const type = text(bytes, offset + 4, offset + 8);
      if (size === 1) {
        if (offset + 16 > end) return;
        size = Number(view.getBigUint64(offset + 8)); header = 16;
      } else if (size === 0) size = end - offset;
      if (!Number.isSafeInteger(size) || size < header || offset + size > end) return;
      const payload = offset + header, next = offset + size;
      if (type === "ispe" && payload + 12 <= next) {
        maxPixels = Math.max(maxPixels, view.getUint32(payload + 4) * view.getUint32(payload + 8));
      } else if (type === "meta" && payload + 4 <= next) walk(payload + 4, next, depth + 1);
      else if (type === "iprp" || type === "ipco") walk(payload, next, depth + 1);
      offset = next;
    }
  }
  walk(0, bytes.length, 0);
  return maxPixels;
}
