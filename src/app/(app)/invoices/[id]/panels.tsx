"use client";

import { Card } from "@/components/ui";
import { ActionForm, Field, Input, MoneyInput, Select, SubmitButton } from "@/components/form";
import { recordPaymentAction } from "@/server/actions/finance";

/** Zahlung zu einer Rechnung erfassen (Vorbelegung: Restbetrag). */
export function PaymentPanel({
  invoiceId,
  openCents,
  currency,
  fxRate,
}: {
  invoiceId: string;
  openCents: number; // offener Betrag in EUR-Cents
  currency: string;
  fxRate: number;
}) {
  // Vorbelegung in Originalwährung (offener EUR-Betrag zurückgerechnet)
  const suggestedCents = currency === "EUR" ? openCents : Math.round(openCents / fxRate);
  return (
    <Card title="Zahlung erfassen">
      <ActionForm action={recordPaymentAction} resetOnSuccess className="flex flex-col gap-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="currency" value={currency} />
        {currency !== "EUR" && <input type="hidden" name="fxRate" value={String(fxRate)} />}
        <Field label={`Betrag (${currency})`} required hint="Vorbelegt mit dem offenen Restbetrag">
          <MoneyInput name="amountCents" defaultCents={suggestedCents} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
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
        </div>
        <Field label="Referenz / Verwendungszweck">
          <Input name="reference" />
        </Field>
        <div>
          <SubmitButton size="sm">Zahlung buchen</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
