import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { getPoLineStats } from "@/server/services/purchasing";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);

  const orders = await db.purchaseOrder.findMany({
    where: status ? { status } : {},
    include: { supplier: true, lines: { include: { product: true, enteredUnit: true } } },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * 50,
    take: 50,
  });

  const result = [];
  for (const po of orders) {
    const stats = await getPoLineStats(po.id);
    const statsByLine = new Map(stats.map((s) => [s.poLineId, s]));
    result.push({
      id: po.id,
      orderNumber: po.orderNumber,
      supplier: { id: po.supplierId, name: po.supplier.name },
      supplierOrderNumber: po.supplierOrderNumber,
      status: po.status,
      orderedAt: po.orderedAt,
      expectedAt: po.expectedAt,
      currency: po.currency,
      fxRate: po.fxRate,
      lines: po.lines.map((l) => ({
        id: l.id,
        product: { id: l.productId, sku: l.product.sku, name: l.product.name },
        enteredQty: l.enteredQty,
        enteredUnit: l.enteredUnit.code,
        unitFactor: l.unitFactor,
        qtyOrdered: l.qtyOrdered,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        shipped: statsByLine.get(l.id)?.shipped ?? 0,
        arrived: statsByLine.get(l.id)?.arrived ?? 0,
        open: statsByLine.get(l.id)?.open ?? 0,
      })),
    });
  }
  return NextResponse.json({ page, purchaseOrders: result });
}
