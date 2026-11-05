import { BROKEN_TEXT_MESSAGE, hasBrokenText, readLimitedBytes, RequestBodyError } from "@/backend/http/request-body";

export class FormDataLimitError extends RequestBodyError {}

// Bound multipart bodies even when the client omits Content-Length.
export async function readLimitedFormData(request: Request, maxBytes: number) {
  let bytes: Buffer;
  try {
    bytes = await readLimitedBytes(request, maxBytes, 60_000);
  } catch (error) {
    if (error instanceof RequestBodyError && error.status === 413) throw new FormDataLimitError(error.message, 413);
    throw error;
  }
  const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("Content-Type") || "" } }).formData();
  // Text fields and file names reach the database too (see readLimitedJson).
  for (const [key, value] of form.entries()) {
    if (hasBrokenText(key) || hasBrokenText(typeof value === "string" ? value : value.name)) throw new RequestBodyError(BROKEN_TEXT_MESSAGE);
  }
  return form;
}
