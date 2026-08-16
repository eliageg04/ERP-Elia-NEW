import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const customers = await db.customer.findMany({
    where: q ? { OR: [{ name: { contains: q } }, { company: { contains: q } }, { code: { contains: q } }] } : {},
    orderBy: { name: "asc" },
    take: 200,
  });
  return NextResponse.json({
    customers: customers.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      company: c.company,
      email: c.email,
      phone: c.phone,
      active: c.active,
    })),
  });
}
