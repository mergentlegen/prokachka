/**
 * Where the browser sends a resumable (TUS) upload, and the public key it may use.
 * Read at runtime: a clean CI build must not bake in a missing or different key.
 * Never returns a service-role/secret key.
 */
export function resumableUploadTarget(): { endpoint: string; apiKey: string } | null {
  const apiKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!apiKey || !base || apiKey.startsWith("sb_secret_")) return null;
  if (!apiKey.startsWith("sb_publishable_")) {
    try { if (JSON.parse(Buffer.from(apiKey.split(".")[1], "base64url").toString()).role !== "anon") return null; }
    catch { return null; }
  }
  try {
    const url = new URL(base);
    const match = url.hostname.match(/^([^.]+)\.supabase\.co$/);
    return { apiKey, endpoint: match ? `https://${match[1]}.storage.supabase.co/storage/v1/upload/resumable` : `${url.origin}/storage/v1/upload/resumable` };
  } catch { return null; }
}
