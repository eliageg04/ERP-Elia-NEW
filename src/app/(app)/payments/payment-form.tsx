"use client";

import { Card } from "@/components/ui";
import { ActionForm, Field, Input, MoneyInput, Select, SubmitButton } from "@/components/form";
import { recordPaymentAction } from "@/server/actions/finance";

type InvoiceOption = { id: string; label: string };

/** Freistehende Zahlungserfassung (Rechnung optional zuordenbar). */
export function PaymentForm({ openInvoices }: { openInvoices: InvoiceOption[] }) {
  return (
    <Card title="Zahlung erfassen">
      <ActionForm action={recordPaymentAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Rechnung (optional)" hint="Ordnet die Zahlung zu und aktualisiert den Rechnungsstatus">
          <Select name="invoiceId" defaultValue="">
            <option value="">– keine Rechnung –</option>
            {openInvoices.map((inv) => (
              <option key={inv.id} value={inv.id}>{inv.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Richtung" hint="Wird bei gewählter Rechnung automatisch bestimmt">
          <Select name="direction" defaultValue="OUTGOING">
            <option value="OUTGOING">Ausgehend (an Lieferant)</option>
            <option value="INCOMING">Eingehend (von Kunde)</option>
          </Select>
        </Field>
        <Field label="Betrag (EUR)" required>
          <MoneyInput name="amountCents" required />
        </Field>
        <Field label="Bezahlt am">
          <Input type="date" name="paidAt" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Zahlungsart">
          <Select name="method" defaultValue="Überweisung">
            {["Überweisung", "PayPal", "Bar", "Kreditkarte", "Sonstiges"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Referenz">
          <Input name="reference" />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <SubmitButton size="sm">Zahlung buchen</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
