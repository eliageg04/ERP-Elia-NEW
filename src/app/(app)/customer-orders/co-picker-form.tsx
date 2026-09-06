"use client";

import { useState } from "react";
import { ActionForm, Field, Input, Select, SubmitButton, MoneyInput } from "@/components/form";
import { Badge } from "@/components/ui";
import { createCustomerOrderWithLinesAction } from "@/server/actions/customer-orders";
import { toDateInputValue } from "@/lib/format";

export type PickerProduct = {
  id: string;
  name: string;
  sku: string;
  available: number;
  inTransit: number;
  listPriceCents: number | null;
};

/**
 * Kundenbestellung in einem Schritt: Kunde wählen, Produkte aus Lager und
 * Vorbestellungen anhaken (Menge + VK), fertig. Gefilterte Zeilen bleiben
 * im Formular erhalten (nur ausgeblendet), damit Eingaben nicht verloren gehen.
 */
export function CoPickerForm({
  customers,
  products,
}: {
  customers: Array<{ id: string; name: string }>;
  products: PickerProduct[];
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const matches = (p: PickerProduct) =>
    !needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle);
  const visibleCount = products.filter(matches).length;

  return (
    <ActionForm action={createCustomerOrderWithLinesAction} className="flex flex-col gap-4">
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label="Kunde" required>
          <Select name="customerId" required defaultValue="">
            <option value="">– wählen –</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Bestellt am">
          <Input type="date" name="orderedAt" defaultValue={toDateInputValue(new Date())} />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-secondary">
            Produkte auswählen ({visibleCount} von {products.length})
          </h2>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Produkt suchen…"
            className="w-64 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
          />
        </div>
        <div className="max-h-[520px] overflow-y-auto rounded-xl border border-border bg-surface">
          {products.length === 0 && (
            <p className="px-4 py-6 text-sm text-ink-tertiary">
              Noch keine Produkte im System – zuerst Vorbestellungen oder Anfangsbestand erfassen.
            </p>
          )}
          {products.map((p) => (
            <div
              key={p.id}
              className={
                "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border/60 px-4 py-2.5 last:border-0 " +
                (matches(p) ? "" : "hidden")
              }
            >
              <div className="min-w-[220px] flex-1">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="ml-2 align-middle">
                  {p.available > 0 ? (
                    <Badge tone="green">{p.available} verfügbar</Badge>
                  ) : (
                    <Badge tone="neutral">0 verfügbar</Badge>
                  )}
                  {p.inTransit > 0 && (
                    <Badge tone="violet" className="ml-1">{p.inTransit} vorbestellt/unterwegs</Badge>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-ink-tertiary">
                  Menge
                  <Input
                    type="number"
                    name={`qty_${p.id}`}
                    min={0}
                    placeholder="0"
                    className="w-20"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-ink-tertiary">
                  VK je Einheit
                  <span className="w-28">
                    <MoneyInput name={`price_${p.id}`} defaultCents={p.listPriceCents} placeholder="0,00" />
                  </span>
                </label>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-tertiary">
          Verfügbarer Bestand wird sofort für den Kunden reserviert. Mengen, die erst per Vorbestellung
          unterwegs sind, bleiben als Rückstand in der Bestellung stehen und können nach dem Wareneingang
          reserviert und versendet werden.
        </p>
      </div>

      <div>
        <SubmitButton>Bestellung anlegen</SubmitButton>
      </div>
    </ActionForm>
  );
}
