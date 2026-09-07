import { enforceRequestSecurity } from "@/backend/http/security";
import { sessionCookie } from "@/backend/http/session-cookie";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "auth-logout", { max: 30, windowMs: 60_000, maxBodyBytes: 1024 });
  if (blocked) return blocked;
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", 0) } });
}