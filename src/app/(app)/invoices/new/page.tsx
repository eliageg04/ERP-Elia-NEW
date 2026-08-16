import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { createInvoiceAction } from "@/server/actions/finance";
import { InvoiceForm } from "../invoice-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rechnung erfassen" };

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ po?: string; co?: string }>;
}) {
  const params = await searchParams;
  const [suppliers, customers, purchaseOrders, customerOrders, po, co] = await Promise.all([
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.customer.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.purchaseOrder.findMany({
      where: { status: { notIn: ["CANCELLED"] } },
      include: { supplier: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.customerOrder.findMany({
      where: { status: { notIn: ["CANCELLED"] } },
      include: { customer: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    params.po ? db.purchaseOrder.findUnique({ where: { id: params.po } }) : null,
    params.co ? db.customerOrder.findUnique({ where: { id: params.co } }) : null,
  ]);

  return (
    <div>
      <PageHeader title="Rechnung erfassen" backHref="/invoices" backLabel="Rechnungen" />
      <InvoiceForm
        action={createInvoiceAction}
        suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))}
        customers={customers.map((c) => ({ id: c.id, label: c.company ? `${c.name} (${c.company})` : c.name }))}
        purchaseOrders={purchaseOrders.map((p) => ({ id: p.id, label: `${p.orderNumber} · ${p.supplier.name}` }))}
        customerOrders={customerOrders.map((c) => ({ id: c.id, label: `${c.orderNumber} · ${c.customer.name}` }))}
        defaults={{
          type: co ? "CUSTOMER" : "SUPPLIER",
          purchaseOrderId: po?.id,
          customerOrderId: co?.id,
          supplierId: po?.supplierId,
          customerId: co?.customerId,
        }}
      />
    </div>
  );
}
