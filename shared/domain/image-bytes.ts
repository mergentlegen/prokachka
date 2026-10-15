// What a stored photo really is, judged by its first bytes, not by its name or the type the browser claims.
// The server opens only these three formats; everything else (SVG, HTML, AVIF…) never reaches the image library.
export type RasterFormat = "jpeg" | "png" | "webp";

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));

export function rasterFormat(bytes: Uint8Array): RasterFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  return null;
}
