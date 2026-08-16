import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { createPurchaseOrderAction } from "@/server/actions/purchase-orders";
import { PoForm } from "../po-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Neue Bestellung" };

export default async function NewPurchaseOrderPage() {
  const suppliers = await db.supplier.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, currency: true },
  });
  return (
    <div>
      <PageHeader
        title="Neue Bestellung"
        backHref="/purchase-orders"
        backLabel="Vorbestellungen"
        subtitle="Kopf anlegen – die Positionen werden anschließend auf der Detailseite erfasst."
      />
      <PoForm action={createPurchaseOrderAction} suppliers={suppliers} />
    </div>
  );
}
