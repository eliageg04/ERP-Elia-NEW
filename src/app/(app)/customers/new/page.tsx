import { PageHeader } from "@/components/ui";
import { createCustomerAction } from "@/server/actions/customers";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Neuer Kunde" };

export default function NewCustomerPage() {
  return (
    <div>
      <PageHeader title="Neuer Kunde" backHref="/customers" backLabel="Kunden" />
      <CustomerForm action={createCustomerAction} />
    </div>
  );
}
