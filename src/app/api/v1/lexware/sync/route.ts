import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { getLexwareConfig, syncLexwarePurchaseInvoices } from "@/server/services/lexware";
import { toUserMessage } from "@/server/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lexware-Sync – wird vom Vercel-Cron (täglich) oder manuell aufgerufen.
 * Zugriff: Vercel-Cron (CRON_SECRET bzw. Cron-User-Agent) oder angemeldeter Benutzer.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const userAgent = request.headers.get("user-agent") ?? "";
  const isCron = secret ? authHeader === `Bearer ${secret}` : userAgent.startsWith("vercel-cron");

  if (!isCron) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  if (!(await getLexwareConfig())) {
    return NextResponse.json({ skipped: true, reason: "Lexware nicht konfiguriert" });
  }
  try {
    const result = await syncLexwarePurchaseInvoices(null);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: toUserMessage(err) }, { status: 500 });
  }
}
