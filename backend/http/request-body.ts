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

export async function readLimitedJson(request: Request) {
  const bytes = await readLimitedBytes(request, requestLimits.get(request) ?? 128 * 1024);
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not_an_object");
    return value;
  } catch { throw new RequestBodyError("Некорректные данные запроса."); }
}
