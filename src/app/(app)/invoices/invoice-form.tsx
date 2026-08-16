"use client";

import { useState } from "react";
import { ActionForm, Field, Input, MoneyInput, Select, SubmitButton, type FormAction } from "@/components/form";

type Option = { id: string; label: string };

export function InvoiceForm({
  action,
  suppliers,
  customers,
  purchaseOrders,
  customerOrders,
  defaults,
}: {
  action: FormAction;
  suppliers: Option[];
  customers: Option[];
  purchaseOrders: Option[];
  customerOrders: Option[];
  defaults?: { type?: string; purchaseOrderId?: string; customerOrderId?: string; supplierId?: string; customerId?: string };
}) {
  const [type, setType] = useState(defaults?.type ?? "SUPPLIER");
  const [currency, setCurrency] = useState("EUR");

  return (
    <ActionForm action={action} className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rechnungstyp" required>
          <Select name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="SUPPLIER">Eingangsrechnung (von Lieferant)</option>
            <option value="CUSTOMER">Ausgangsrechnung (an Kunde)</option>
          </Select>
        </Field>
        {type === "SUPPLIER" ? (
          <Field label="Lieferant" required>
            <Select name="supplierId" required defaultValue={defaults?.supplierId ?? ""}>
              <option value="">– wählen –</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Kunde" required>
            <Select name="customerId" required defaultValue={defaults?.customerId ?? ""}>
              <option value="">– wählen –</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </Field>
        )}
        {type === "SUPPLIER" ? (
          <Field label="Einkaufsbestellung (optional)">
            <Select name="purchaseOrderId" defaultValue={defaults?.purchaseOrderId ?? ""}>
              <option value="">– keine –</option>
              {purchaseOrders.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Kundenbestellung (optional)">
            <Select name="customerOrderId" defaultValue={defaults?.customerOrderId ?? ""}>
              <option value="">– keine –</option>
              {customerOrders.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Externe Rechnungsnummer" hint="Nummer des Lieferanten – wird zur Duplikaterkennung genutzt">
          <Input name="externalNumber" placeholder="z.B. RE-2026-1234" />
        </Field>
        <Field label="Rechnungsdatum">
          <Input type="date" name="issuedAt" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Fällig am">
          <Input type="date" name="dueAt" />
        </Field>
        <Field label="Währung">
          <Select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {["EUR", "USD", "GBP"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        {currency !== "EUR" && (
          <Field label={`Wechselkurs (EUR pro 1 ${currency})`} required>
            <Input type="text" inputMode="decimal" name="fxRate" placeholder="z.B. 0,92" required />
          </Field>
        )}
        <Field label="Netto">
          <MoneyInput name="netCents" />
        </Field>
        <Field label="Steuer">
          <MoneyInput name="taxCents" />
        </Field>
        <Field label="Brutto gesamt" required>
          <MoneyInput name="totalCents" required />
        </Field>
      </div>
      <div>
        <SubmitButton>Rechnung erfassen</SubmitButton>
      </div>
    </ActionForm>
  );
}
