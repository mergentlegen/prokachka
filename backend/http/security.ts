import { NextResponse } from "next/server";
import { failure } from "@/backend/http/api-response";

const buckets = new Map<string, { count: number; resetAt: number }>();
const mutationMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);

type SecurityOptions = { max?: number; windowMs?: number; maxBodyBytes?: number; skipOrigin?: boolean };

function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    if (buckets.size > 2000) {
      for (const [entryKey, entry] of buckets) if (entry.resetAt <= now) buckets.delete(entryKey);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }
  if (current.count >= max) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return NextResponse.json({ ok: false, message: "Слишком много запросов. Попробуйте чуть позже." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
  current.count += 1;
  return null;
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const requestOrigin = new URL(request.url).origin;
    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin : "";
    return origin === requestOrigin || Boolean(configuredOrigin && origin === configuredOrigin);
  } catch {
    return false;
  }
}

export function enforceRequestSecurity(request: Request, bucket: string, options: SecurityOptions = {}) {
  const { max = 120, windowMs = 60_000, maxBodyBytes = 128 * 1024, skipOrigin = false } = options;
  if (mutationMethods.has(request.method)) {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > maxBodyBytes) return failure("Запрос слишком большой.", 413);
    if (!skipOrigin && !sameOrigin(request)) return failure("Недопустимый источник запроса.", 403);
  }
  return rateLimit(`${bucket}:${clientIp(request)}`, max, windowMs);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isProductionConfigSafe() {
  const authSecret = process.env.AUTH_SECRET;
  return process.env.NODE_ENV !== "production" || Boolean(authSecret && authSecret.length >= 32);
}
