import { NextResponse } from "next/server";
import { serverEnv } from "@/backend/config/env";
import { sessionCookie } from "@/backend/http/session-cookie";

export async function withAuthCookie(response: Response) {
  const body = await response.clone().json().catch(() => ({}));
  if (body.session) {
    response.headers.append("Set-Cookie", serverEnv.authDevMode ? sessionCookie("", 0) : sessionCookie(body.session));
  }
  if (!serverEnv.authDevMode) delete body.session;
  response.headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { status: response.status, headers: response.headers });
}
