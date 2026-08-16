import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { getStockMap, getInboundInTransitMap } from "@/server/services/inventory";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const [stockMap, inTransitMap] = await Promise.all([getStockMap(), getInboundInTransitMap()]);
  const productIds = [...new Set([...stockMap.keys(), ...inTransitMap.keys()])];
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true },
  });
  return NextResponse.json({
    inventory: products.map((p) => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      ...(stockMap.get(p.id) ?? { onHand: 0, reserved: 0, available: 0 }),
      inTransit: inTransitMap.get(p.id) ?? 0,
    })),
  });
}
