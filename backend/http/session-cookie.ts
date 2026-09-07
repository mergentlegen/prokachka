const maxAgeSeconds = 60 * 60 * 24 * 14;

function secureSuffix() {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function sessionCookie(value: string, maxAge = maxAgeSeconds) {
  return `incruises_session=${value}; Path=/; HttpOnly; SameSite=Lax${secureSuffix()}; Max-Age=${maxAge}`;
}