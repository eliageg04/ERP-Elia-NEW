"use client";

import { Card } from "@/components/ui";
import { ActionForm, Field, Input, MoneyInput, Select, SubmitButton } from "@/components/form";
import { addCostAction } from "@/server/actions/finance";

type PoOption = { id: string; label: string };

/** Nebenkosten erfassen – mit Bestellung fließen sie in die Landed Costs ein. */
export function CostForm({ purchaseOrders }: { purchaseOrders: PoOption[] }) {
  return (
    <Card title="Kosten erfassen">
      <ActionForm action={addCostAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Typ" required>
          <Select name="type" defaultValue="SHIPPING">
            <option value="SHIPPING">Versand</option>
            <option value="CUSTOMS">Zoll</option>
            <option value="FEES">Gebühren</option>
            <option value="OTHER">Sonstiges</option>
          </Select>
        </Field>
        <Field label="Betrag (EUR)" required>
          <MoneyInput name="amountCents" required />
        </Field>
        <Field label="Einkaufsbestellung (optional)" hint="Verteilt die Kosten auf die Einstandspreise der Bestellung">
          <Select name="purchaseOrderId" defaultValue="">
            <option value="">– keine –</option>
            {purchaseOrders.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Verteilmethode">
          <Select name="allocationMethod" defaultValue="BY_VALUE">
            <option value="BY_VALUE">Nach Warenwert (Standard)</option>
            <option value="BY_QUANTITY">Nach Menge</option>
          </Select>
        </Field>
        <Field label="Datum">
          <Input type="date" name="incurredAt" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Beschreibung">
          <Input name="description" placeholder="z.B. UPS Fracht, Einfuhrumsatzsteuer…" />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <SubmitButton size="sm">Kosten buchen</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
