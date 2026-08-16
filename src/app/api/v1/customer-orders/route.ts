import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { getCoLineStats } from "@/server/services/sales";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const status = request.nextUrl.searchParams.get("status");
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);

  const orders = await db.customerOrder.findMany({
    where: status ? { status } : {},
    include: { customer: true, lines: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * 50,
    take: 50,
  });

  const result = [];
  for (const co of orders) {
    const stats = await getCoLineStats(co.id);
    const statsByLine = new Map(stats.map((s) => [s.lineId, s]));
    result.push({
      id: co.id,
      orderNumber: co.orderNumber,
      customer: { id: co.customerId, name: co.customer.name },
      status: co.status,
      orderedAt: co.orderedAt,
      lines: co.lines.map((l) => ({
        id: l.id,
        product: { id: l.productId, sku: l.product.sku, name: l.product.name },
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: l.lineTotalCents,
        allocated: statsByLine.get(l.id)?.allocated ?? 0,
        shipped: statsByLine.get(l.id)?.shipped ?? 0,
        delivered: statsByLine.get(l.id)?.delivered ?? 0,
      })),
    });
  }
  return NextResponse.json({ page, customerOrders: result });
}
