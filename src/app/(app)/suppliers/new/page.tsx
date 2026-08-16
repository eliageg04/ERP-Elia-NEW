import { PageHeader } from "@/components/ui";
import { createSupplierAction } from "@/server/actions/suppliers";
import { SupplierForm } from "../supplier-form";

export const metadata = { title: "Neuer Großhändler" };

export default function NewSupplierPage() {
  return (
    <div>
      <PageHeader title="Neuer Großhändler" backHref="/suppliers" backLabel="Großhändler" />
      <SupplierForm action={createSupplierAction} />
    </div>
  );
}
