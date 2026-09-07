import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function failure(message: string, status = 500) {
  return NextResponse.json({ ok: false, message }, { status });
}
