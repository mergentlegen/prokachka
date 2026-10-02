import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/backend/config/env";

/** Server-side jobs (the Telegram worker, the health monitor) prove themselves with the delivery secret. */
export function isInternalRequest(request: Request) {
  const secret = serverEnv.telegramDeliverySecret;
  const supplied = request.headers.get("authorization") || "";
  const expected = "Bearer " + (secret || "");
  return Boolean(secret && secret.length >= 32 && Buffer.byteLength(supplied) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)));
}
