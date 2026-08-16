import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const status = request.nextUrl.searchParams.get("status");
  const type = request.nextUrl.searchParams.get("type");
  const invoices = await db.invoice.findMany({
    where: { ...(status ? { status } : {}), ...(type ? { type } : {}) },
    include: { supplier: true, customer: true, payments: true },
    orderBy: { issuedAt: "desc" },
    take: 200,
  });
  return NextResponse.json({
    invoices: invoices.map((inv) => {
      const paidEurCents = inv.payments.reduce((a, p) => a + p.amountEurCents, 0);
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        externalNumber: inv.externalNumber,
        type: inv.type,
        party: inv.supplier?.name ?? inv.customer?.name ?? null,
        issuedAt: inv.issuedAt,
        dueAt: inv.dueAt,
        currency: inv.currency,
        totalCents: inv.totalCents,
        totalEurCents: inv.totalEurCents,
        paidEurCents,
        openEurCents: inv.status === "CANCELLED" ? 0 : inv.totalEurCents - paidEurCents,
        status: inv.status,
      };
    }),
  });
}
