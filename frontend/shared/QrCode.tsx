"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A QR code drawn as SVG squares from the library's matrix (no generated HTML is inserted). */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const cells = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const count = code.getModuleCount();
    const dark: [number, number][] = [];
    for (let row = 0; row < count; row++) for (let col = 0; col < count; col++) if (code.isDark(row, col)) dark.push([col, row]);
    return { count, dark };
  }, [value]);
  const margin = 4, side = cells.count + margin * 2;
  return <svg width={size} height={size} viewBox={`0 0 ${side} ${side}`} role="img" aria-label={label} shapeRendering="crispEdges">
    <rect width={side} height={side} fill="#fff" />
    <path fill="#101d35" d={cells.dark.map(([x, y]) => `M${x + margin} ${y + margin}h1v1h-1z`).join("")} />
  </svg>;
}
