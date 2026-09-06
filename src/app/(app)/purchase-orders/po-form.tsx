"use client";

import { ActionForm, Field, Input, Select, SubmitButton, type FormAction } from "@/components/form";
import { toDateInputValue } from "@/lib/format";

type PoHeaderData = {
  id: string;
  supplierId: string;
  supplierOrderNumber: string | null;
  orderedAt: string | null;
};

/**
 * Kopf-Formular für Vorbestellungen (Anlegen + Bearbeiten).
 * Bewusst schlank: Einkauf erfolgt ausschließlich in EUR (EU/EWR),
 * daher keine Währungs-/Wechselkursfelder.
 */
export function PoForm({
  action,
  suppliers,
  po,
}: {
  action: FormAction;
  suppliers: Array<{ id: string; name: string; currency: string }>;
  po?: PoHeaderData;
}) {
  const isEdit = Boolean(po);
  return (
    <ActionForm action={action} className="flex max-w-2xl flex-col gap-4">
      {po && <input type="hidden" name="id" value={po.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Lieferant" required className="sm:col-span-2">
          <Select name="supplierId" required defaultValue={po?.supplierId ?? ""}>
            <option value="">– wählen –</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ordernummer" hint="Bestell-/Rechnungsnummer des Großhändlers">
          <Input
            name="supplierOrderNumber"
            defaultValue={po?.supplierOrderNumber ?? ""}
            placeholder="z.B. ORD-2026-1234"
          />
        </Field>
        <Field label="Bestellt am">
          <Input
            type="date"
            name="orderedAt"
            defaultValue={po ? toDateInputValue(po.orderedAt) : toDateInputValue(new Date())}
          />
        </Field>
      </div>
      <div>
        <SubmitButton>{isEdit ? "Kopfdaten speichern" : "Bestellung anlegen"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
