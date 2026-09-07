import { login } from "@/backend/controllers/auth.controller";
import { serverEnv } from "@/backend/config/env";
import { enforceRequestSecurity } from "@/backend/http/security";
import { sessionCookie } from "@/backend/http/session-cookie";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const blocked = enforceRequestSecurity(request, "auth-login", { max: 10, windowMs: 60_000, maxBodyBytes: 16 * 1024 });
  if (blocked) return blocked;
  const response = await login(request);
  const body = await response.clone().json().catch(() => ({}));
  if (serverEnv.authDevMode) response.headers.append("Set-Cookie", sessionCookie("", 0));
  else if (body.session) response.headers.append("Set-Cookie", sessionCookie(body.session));
  return NextResponse.json(body, { status: response.status, headers: response.headers });
}