import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function failure(message: string, status = 500) {
  // A server fault must leave a trace: nginx keeps only the status, the journal gets the reason.
  if (status >= 500) console.error("API failure", { status, message });
  return NextResponse.json({ ok: false, message }, { status });
}

/**
 * Postgres refuses a value of the wrong kind or size (SQLSTATE class 22, e.g. a date it cannot read
 * or a number out of range). That is a problem with what was sent, not a server fault.
 */
export function databaseFailure(error: unknown, message: string) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return code.startsWith("22") ? failure("Проверьте введённые данные: некоторые значения не подходят.", 400) : failure(message);
}
