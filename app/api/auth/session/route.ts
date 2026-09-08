import { session } from "@/backend/controllers/auth.controller";
import { serverEnv } from "@/backend/config/env";
import { sessionCookie } from "@/backend/http/session-cookie";
import { enforceRequestSecurity } from "@/backend/http/security";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const response = await session(request);
  const body = await response.clone().json().catch(() => ({}));
  if (serverEnv.authDevMode) response.headers.append("Set-Cookie", sessionCookie("", 0));
  else if (body.session) response.headers.append("Set-Cookie", sessionCookie(body.session));
  if (!serverEnv.authDevMode) delete body.session;
  return NextResponse.json(body, { status: response.status, headers: response.headers });
}
