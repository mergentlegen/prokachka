import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { serverEnv } from "@/backend/config/env";

export function getSupabaseAdmin() {
  if (!serverEnv.supabaseUrl || !serverEnv.supabaseServiceRoleKey) return null;
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
  });
}
