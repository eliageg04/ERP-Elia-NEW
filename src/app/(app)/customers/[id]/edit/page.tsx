import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/form";
import { updateCustomerAction, archiveCustomerAction } from "@/server/actions/customers";
import { CustomerForm } from "../../customer-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kunde bearbeiten" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await db.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  return (
    <div>
      <PageHeader
        title={`${customer.name} bearbeiten`}
        backHref={`/customers/${id}`}
        backLabel="Kundenseite"
        actions={
          <ActionButton
            action={archiveCustomerAction}
            variant={customer.active ? "danger" : "secondary"}
            hiddenFields={{ id }}
            confirmMessage={
              customer.active
                ? "Kunde archivieren? Er bleibt in allen historischen Daten erhalten."
                : "Kunde reaktivieren?"
            }
          >
            {customer.active ? "Archivieren" : "Reaktivieren"}
          </ActionButton>
        }
      />
      <CustomerForm action={updateCustomerAction} customer={customer} />
    </div>
  );
}
