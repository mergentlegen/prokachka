// Liveness/version probe. Does not query Supabase or expose configuration.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", release: process.env.PROKACHKA_RELEASE_ID || "development" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
