import { failure } from "@/backend/http/api-response";

const requestLimits = new WeakMap<Request, number>();
export class RequestBodyError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function setRequestBodyLimit(request: Request, bytes: number) {
  requestLimits.set(request, bytes);
}

export function requestBodyFailure(error: unknown) {
  return error instanceof RequestBodyError ? failure(error.message, error.status) : null;
}

// Count actual streamed bytes; Content-Length is only an early rejection hint.
export async function readLimitedBytes(request: Request, maxBytes: number, timeoutMs = 30_000) {
  const length = request.headers.get("content-length");
  if (length !== null && !/^\d+$/.test(length)) throw new RequestBodyError("Некорректный размер запроса.");
  if (length !== null && Number(length) > maxBytes) throw new RequestBodyError("Запрос слишком большой.", 413);
  if (!request.body) throw new RequestBodyError("Пустой запрос.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0, timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, timeoutMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (timedOut) throw new RequestBodyError("Время загрузки истекло. Попробуйте ещё раз.", 408);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyError("Запрос слишком большой.", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } finally { clearTimeout(timer); reader.releaseLock(); }
}

// Postgres cannot store a NUL character or half of an emoji (a lone UTF-16 surrogate), and refusing
// them deep in the database turns a typo or a probe into a server error.
const BROKEN_TEXT = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
export const BROKEN_TEXT_MESSAGE = "В тексте есть недопустимые символы. Уберите их и попробуйте ещё раз.";

export function hasBrokenText(value: string) {
  return BROKEN_TEXT.test(value);
}

function containsBrokenText(value: unknown): boolean {
  if (typeof value === "string") return hasBrokenText(value);
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsBrokenText);
  return Object.entries(value).some(([key, item]) => hasBrokenText(key) || containsBrokenText(item));
}

export async function readLimitedJson(request: Request) {
  const bytes = await readLimitedBytes(request, requestLimits.get(request) ?? 128 * 1024);
  // Same loose type as JSON.parse gives: every controller checks the fields it reads.
  let value: ReturnType<typeof JSON.parse>;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not_an_object");
  } catch { throw new RequestBodyError("Некорректные данные запроса."); }
  let broken: boolean;
  try { broken = containsBrokenText(value); } catch { throw new RequestBodyError("Некорректные данные запроса."); }
  if (broken) throw new RequestBodyError(BROKEN_TEXT_MESSAGE);
  return value;
}
