import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/backend/infrastructure/supabase/admin-client";
import { getSupabaseAuthClient } from "@/backend/infrastructure/supabase/auth-client";

type RecoveryError = { error: string; status: number; retryAfter?: number };
const unavailable = (): RecoveryError => ({ error: "Восстановление пароля временно недоступно. Попробуйте позже.", status: 503 });
const expired = (): RecoveryError => ({ error: "Время восстановления истекло. Запросите новый код.", status: 410 });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
type ProviderSession = { access_token: string; refresh_token: string };

function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Recovery encryption is not configured");
  return createHash("sha256").update("prokachka:password-recovery:" + secret).digest();
}
export function sealRecoverySession(session: ProviderSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function openRecoverySession(sealed: string): ProviderSession {
  const bytes = Buffer.from(sealed, "base64url");
  if (bytes.length < 29 || bytes.length > 16384) throw new Error("Invalid recovery session");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const session = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
  if (typeof session.access_token !== "string" || typeof session.refresh_token !== "string") throw new Error("Invalid recovery session");
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}

async function limit(email: string, action: "send" | "verify"): Promise<RecoveryError | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return unavailable();
  const result = await admin.rpc("app_password_recovery_limit", { p_email_hash: hash(email), p_action: action });
  if (result.error) return unavailable();
  if (!result.data?.allowed) return { error: "Слишком много попыток. Попробуйте чуть позже.", status: 429, retryAfter: result.data?.retryAfter || 60 };
  return null;
}

async function accountForEmail(email: string) {
  const admin = getSupabaseAdmin();
  if (!admin) return { error: true };
  const fields = "id,email,login,role,auth_user_id";
  const [byEmail, byLogin] = await Promise.all([
    admin.from("users").select(fields).eq("email", email).maybeSingle(),
    admin.from("users").select(fields).eq("login", email).maybeSingle(),
  ]);
  if (byEmail.error || byLogin.error || (byEmail.data && byLogin.data && byEmail.data.id !== byLogin.data.id)) return { error: true };
  const account = byEmail.data || byLogin.data;
  return { account: account?.role === "ceo" ? null : account };
}
function providerFailure(error: { status?: number; code?: string }, verifying = false): RecoveryError {
  if (error.status === 429) return { error: "Слишком много попыток. Подождите минуту и попробуйте ещё раз.", status: 429, retryAfter: 60 };
  if (verifying && (error.status || 0) < 500) return { error: "Код неверный или срок его действия истёк. Запросите новый код.", status: 400 };
  return unavailable();
}

export async function requestPasswordRecovery(email: string) {
  const admin = getSupabaseAdmin(); const client = getSupabaseAuthClient();
  if (!admin || !client) return unavailable();
  encryptionKey();
  const blocked = await limit(email, "send");
  if (blocked) return blocked;
  const found = await accountForEmail(email);
  if (found.error) return unavailable();
  // Identical response for unknown addresses: no registration or account discovery.
  const pending = { recoveryRequested: true as const, email, resendAfter: 60 };
  if (!found.account) return pending;
  if (!found.account.auth_user_id) {
    // Materialize an Auth identity for legacy recovery without sending a link
    // or attaching it to the application account before email ownership is proved.
    const prepared = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (prepared.error || !prepared.data.user) return unavailable();
  }
  const result = await client.auth.resetPasswordForEmail(email);
  return result.error ? providerFailure(result.error) : pending;
}

export async function verifyPasswordRecovery(email: string, code: string) {
  const admin = getSupabaseAdmin(); const client = getSupabaseAuthClient();
  if (!admin || !client) return unavailable();
  const blocked = await limit(email, "verify");
  if (blocked) return blocked;
  const found = await accountForEmail(email);
  if (found.error) return unavailable();
  if (!found.account) return providerFailure({ status: 400 }, true);
  const result = await client.auth.verifyOtp({ email, token: code, type: "recovery" });
  if (result.error) return providerFailure(result.error, true);
  const { user, session } = result.data;
  if (!user?.email_confirmed_at || user.email?.toLowerCase() !== email || !session?.access_token || !session.refresh_token
    || (found.account.auth_user_id && found.account.auth_user_id !== user.id)) return providerFailure({ status: 400 }, true);
  const token = randomBytes(32).toString("base64url");
  const saved = await admin.rpc("app_issue_password_recovery", {
    p_account_id: found.account.id, p_auth_user_id: user.id, p_token_hash: hash(token),
    p_encrypted_session: sealRecoverySession({ access_token: session.access_token, refresh_token: session.refresh_token }),
  });
  if (saved.error) return unavailable();
  return { token, expiresIn: 600 };
}

export async function resetRecoveredPassword(token: string, password: string) {
  const admin = getSupabaseAdmin(); const client = getSupabaseAuthClient();
  if (!admin || !client) return unavailable();
  const args = { p_token_hash: hash(token), p_claim_id: randomUUID() };
  const claimed = await admin.rpc("app_claim_password_recovery", args);
  if (claimed.error) return unavailable();
  if (claimed.data?.status === "busy") return { error: "Пароль уже сохраняется. Подождите несколько секунд.", status: 409 };
  if (claimed.data?.status !== "ok") return expired();
  let finished = false;
  try {
    const restored = await client.auth.setSession(openRecoverySession(claimed.data.encryptedSession));
    if (restored.error || restored.data.user?.id !== claimed.data.authUserId) return expired();
    const changed = await client.auth.updateUser({ password });
    // A retried request may follow a successful Auth update and a temporary DB
    // failure. The verified grant still authorizes completing that same reset.
    if (changed.error && changed.error.code !== "same_password") {
      if (changed.error.code === "weak_password" || changed.error.code === "validation_failed") {
        return { error: "Этот пароль слишком простой. Выберите другой пароль.", status: 400 };
      }
      return providerFailure(changed.error);
    }
    const completed = await admin.rpc("app_finish_password_recovery", args);
    if (completed.error) return unavailable();
    finished = true;
    // Application cookies are revoked by session_version; also revoke the
    // temporary provider session and other Supabase sessions where available.
    await client.auth.signOut({ scope: "global" }).catch(() => undefined);
    return { passwordReset: true as const };
  } finally {
    if (!finished) await Promise.resolve(admin.rpc("app_release_password_recovery", args)).catch(() => undefined);
  }
}
