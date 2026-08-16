import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const suppliers = await db.supplier.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : {},
    orderBy: { name: "asc" },
    take: 200,
  });
  return NextResponse.json({
    suppliers: suppliers.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      email: s.email,
      currency: s.currency,
      paymentTerms: s.paymentTerms,
      active: s.active,
    })),
  });
}
