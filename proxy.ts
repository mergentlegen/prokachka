import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const allowedProductionHosts = new Set(["prokachka.kz", "www.prokachka.kz"]);

/** Rejects unknown Host values before they reach pages or API handlers. */
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    const host = request.headers.get("host")?.split(":", 1)[0]?.toLowerCase();
    if (!host || !allowedProductionHosts.has(host)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/(.*)"],
};
