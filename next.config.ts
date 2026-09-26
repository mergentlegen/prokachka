import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";
const supabaseUrl = (() => {
  try { return process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null; }
  catch { return null; }
})();
const supabaseSources = supabaseUrl ? [supabaseUrl.origin] : [];
if (supabaseUrl) {
  const project = supabaseUrl.hostname.match(/^([^.]+)\.supabase\.co$/)?.[1];
  if (project) supabaseSources.push(`https://${project}.storage.supabase.co`);
}
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https://i.ytimg.com",
  `media-src 'self' blob: ${supabaseSources.join(" ")}`.trim(),
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'" + (isDevelopment ? " 'unsafe-eval'" : ""),
  `connect-src 'self' ws: wss: ${supabaseSources.join(" ")}`.trim(),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];
if (!isDevelopment) securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });

const nextConfig: NextConfig = {
  output: process.env.PROKACHKA_STANDALONE === "1" ? "standalone" : undefined,
  deploymentId: process.env.PROKACHKA_RELEASE_ID,
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["192.168.8.141", "*.trycloudflare.com"],
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
