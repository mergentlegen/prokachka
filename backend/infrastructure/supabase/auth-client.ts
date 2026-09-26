import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { serverEnv } from "@/backend/config/env";

// A new, anonymous-key client per operation. Never sign in on the admin client:
// doing so replaces its service-role authorization with a user's access token.
export function getSupabaseAuthClient() {
  if (!serverEnv.supabaseUrl || !serverEnv.supabaseAnonKey) return null;
  return createClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket as unknown as WebSocketLikeConstructor },
    global: {
      fetch: (input, init) => fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      }),
    },
  });
}
