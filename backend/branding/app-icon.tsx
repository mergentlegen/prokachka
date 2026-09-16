import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Reuse the existing brand mark, with enough margin for rounded/masked icons.
export async function appIcon(size: number) {
  const source = await readFile(join(process.cwd(), "public/brand/icon.svg"), "utf8");
  const centered = source.replace('viewBox="0 0 512 512"', 'viewBox="90 38 370 370"');
  const src = `data:image/svg+xml;base64,${Buffer.from(centered).toString("base64")}`;
  return new ImageResponse(
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#101d35" }}>
      <img src={src} width={size} height={size} alt="" />
    </div>,
    { width: size, height: size },
  );
}
