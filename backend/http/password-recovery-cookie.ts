const name = "prokachka_password_recovery";
export function passwordRecoveryCookie(token = "", maxAge = 600) {
  return `${name}=${token}; Path=/api/auth/password; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function readPasswordRecoveryCookie(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)prokachka_password_recovery=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
  return token || null;
}
