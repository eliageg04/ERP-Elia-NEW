"use client";

import { useState } from "react";
import { ActionForm, Field, Input, MoneyInput, Select, SubmitButton } from "@/components/form";
import { addOpeningStockAction } from "@/server/actions/products";

/**
 * Bestand direkt erfassen: Produkt (bestehend oder per Namen neu),
 * Menge und EK je Einheit – für Ware, die schon im Lager liegt.
 */
export function OpeningStockForm({ products }: { products: Array<{ id: string; name: string }> }) {
  const [createNew, setCreateNew] = useState(true);
  return (
    <details className="mb-6 rounded-xl border border-border bg-surface">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium hover:bg-canvas/60">
        + Bestand erfassen (Produkt, Menge, EK)
      </summary>
      <div className="border-t border-border px-4 py-4">
        <ActionForm action={addOpeningStockAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={createNew ? "Neues Produkt (Name)" : "Produkt"} required className="sm:col-span-2 lg:col-span-3">
            {createNew ? (
              <Input name="newProductName" required placeholder="z.B. 2025 Topps Bowman Draft Baseball Hobby Case" />
            ) : (
              <Select name="productId" required defaultValue="">
                <option value="">– wählen –</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            )}
            <button
              type="button"
              onClick={() => setCreateNew(!createNew)}
              className="mt-1 text-xs font-medium text-accent hover:underline"
            >
              {createNew ? "← bestehendes Produkt wählen" : "+ Neues Produkt direkt anlegen"}
            </button>
          </Field>
          <Field label="Menge im Lager" required>
            <Input type="number" name="qty" min={1} required placeholder="z.B. 3" />
          </Field>
          <Field label="EK je Einheit (netto)" required hint="Bestimmt den Lagerwert">
            <MoneyInput name="unitCostCents" required placeholder="z.B. 3992,00" />
          </Field>
          <div className="flex items-end lg:col-span-5">
            <SubmitButton size="md">In den Bestand buchen</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </details>
  );
}
