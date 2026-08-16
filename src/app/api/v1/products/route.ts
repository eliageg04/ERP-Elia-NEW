import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { getStockMap } from "@/server/services/inventory";
import { nextNumber } from "@/server/numbering";

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);

  const products = await db.product.findMany({
    where: q
      ? { OR: [{ name: { contains: q } }, { sku: { contains: q } }, { ean: { contains: q } }] }
      : {},
    include: { baseUnit: true },
    orderBy: { name: "asc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const stockMap = await getStockMap(products.map((p) => p.id));

  return NextResponse.json({
    page,
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      setName: p.setName,
      language: p.language,
      ean: p.ean,
      productType: p.productType,
      baseUnit: p.baseUnit.code,
      listPriceCents: p.listPriceCents,
      active: p.active,
      stock: stockMap.get(p.id) ?? { onHand: 0, reserved: 0, available: 0 },
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1),
  baseUnitCode: z.string().min(1),
  sku: z.string().optional(),
  setName: z.string().optional(),
  language: z.string().optional(),
  ean: z.string().optional(),
  productType: z.string().optional(),
  manufacturer: z.string().optional(),
  listPriceCents: z.number().int().nonnegative().optional(),
});

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  if (user.role === "READONLY") {
    return NextResponse.json({ error: "Keine Berechtigung" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe", details: parsed.error.flatten() }, { status: 400 });
  }
  const unit = await db.unit.findUnique({ where: { code: parsed.data.baseUnitCode } });
  if (!unit) {
    return NextResponse.json({ error: `Unbekannte Einheit: ${parsed.data.baseUnitCode}` }, { status: 400 });
  }
  const product = await db.product.create({
    data: {
      sku: parsed.data.sku ?? (await nextNumber("PRD")),
      name: parsed.data.name,
      setName: parsed.data.setName ?? null,
      language: parsed.data.language ?? "EN",
      ean: parsed.data.ean ?? null,
      productType: parsed.data.productType ?? null,
      manufacturer: parsed.data.manufacturer ?? null,
      baseUnitId: unit.id,
      listPriceCents: parsed.data.listPriceCents ?? null,
    },
  });
  return NextResponse.json({ product }, { status: 201 });
}
