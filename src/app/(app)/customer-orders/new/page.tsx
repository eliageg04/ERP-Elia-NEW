import { db } from "@/server/db";
import { getStockMap, getIncomingMap } from "@/server/services/inventory";
import { PageHeader } from "@/components/ui";
import { CoPickerForm, type PickerProduct } from "../co-picker-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Neue Kundenbestellung" };

export default async function NewCustomerOrderPage() {
  const [customers, products, stockMap, inTransitMap] = await Promise.all([
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.product.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, sku: true, listPriceCents: true },
    }),
    getStockMap(),
    getIncomingMap(),
  ]);

  const pickerProducts: PickerProduct[] = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      listPriceCents: p.listPriceCents,
      available: stockMap.get(p.id)?.available ?? 0,
      inTransit: inTransitMap.get(p.id) ?? 0,
    }))
    // Produkte mit Bestand oder unterwegs zuerst, Rest alphabetisch dahinter
    .sort((a, b) => {
      const aActive = a.available > 0 || a.inTransit > 0 ? 0 : 1;
      const bActive = b.available > 0 || b.inTransit > 0 ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.name.localeCompare(b.name, "de");
    });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Neue Kundenbestellung"
        backHref="/customer-orders"
        backLabel="Bestellungen"
        subtitle="Kunde wählen, Produkte anhaken – verfügbarer Bestand wird automatisch reserviert."
      />
      <CoPickerForm customers={customers} products={pickerProducts} />
    </div>
  );
}
