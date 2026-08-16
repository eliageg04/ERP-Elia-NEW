import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/form";
import { updateSupplierAction, archiveSupplierAction } from "@/server/actions/suppliers";
import { SupplierForm } from "../../supplier-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Großhändler bearbeiten" };

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supplier = await db.supplier.findUnique({ where: { id } });
  if (!supplier) notFound();

  return (
    <div>
      <PageHeader
        title={`${supplier.name} bearbeiten`}
        backHref={`/suppliers/${id}`}
        backLabel="Großhändler-Seite"
        actions={
          <ActionButton
            action={archiveSupplierAction}
            variant={supplier.active ? "danger" : "secondary"}
            hiddenFields={{ id }}
            confirmMessage={
              supplier.active
                ? "Großhändler archivieren? Er bleibt in allen historischen Daten erhalten."
                : "Großhändler reaktivieren?"
            }
          >
            {supplier.active ? "Archivieren" : "Reaktivieren"}
          </ActionButton>
        }
      />
      <SupplierForm action={updateSupplierAction} supplier={supplier} />
    </div>
  );
}
