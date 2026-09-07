export const serverEnv = {
  ceoPassword: process.env.CEO_PASSWORD || process.env.ADMIN_PASSWORD || "",
  ceoLogin: process.env.CEO_LOGIN || process.env.ADMIN_LOGIN || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminLogin: process.env.ADMIN_LOGIN || "",
  telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  authDevMode: process.env.AUTH_DEV_MODE === "true",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

export function isValidTelegramSecret(value: string | null) {
  if (process.env.NODE_ENV === "production" && !serverEnv.telegramWebhookSecret) return false;
  return Boolean(serverEnv.telegramWebhookSecret) && value === serverEnv.telegramWebhookSecret;
}