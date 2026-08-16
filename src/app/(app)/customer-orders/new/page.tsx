import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { createCustomerOrderAction } from "@/server/actions/customer-orders";
import { CoForm } from "../co-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Neue Kundenbestellung" };

export default async function NewCustomerOrderPage() {
  const customers = await db.customer.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return (
    <div>
      <PageHeader
        title="Neue Kundenbestellung"
        backHref="/customer-orders"
        backLabel="Kundenbestellungen"
        subtitle="Kopf anlegen – die Positionen werden anschließend auf der Detailseite erfasst."
      />
      <CoForm action={createCustomerOrderAction} customers={customers} />
    </div>
  );
}
