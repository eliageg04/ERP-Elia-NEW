"use client";

import { ActionForm, Field, Input, MoneyInput, Select, SubmitButton, type FormAction } from "@/components/form";
import { toDateInputValue } from "@/lib/format";

type CoHeaderData = {
  id: string;
  customerId: string;
  orderedAt: string | null;
  shippingFeeCents: number;
};

/** Kopf-Formular für Kundenbestellungen (Anlegen + Bearbeiten). */
export function CoForm({
  action,
  customers,
  co,
}: {
  action: FormAction;
  customers: Array<{ id: string; name: string }>;
  co?: CoHeaderData;
}) {
  const isEdit = Boolean(co);
  return (
    <ActionForm action={action} className="flex max-w-2xl flex-col gap-4">
      {co && <input type="hidden" name="id" value={co.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kunde" required className="sm:col-span-2">
          <Select name="customerId" required defaultValue={co?.customerId ?? ""}>
            <option value="">– wählen –</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Bestellt am">
          <Input
            type="date"
            name="orderedAt"
            defaultValue={co ? toDateInputValue(co.orderedAt) : toDateInputValue(new Date())}
          />
        </Field>
        <Field label="Versandkosten (dem Kunden berechnet)" hint="Optional – fließt in den Warenwert ein">
          <MoneyInput name="shippingFeeCents" defaultCents={co?.shippingFeeCents} />
        </Field>
      </div>
      <div>
        <SubmitButton>{isEdit ? "Kopfdaten speichern" : "Bestellung anlegen"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
