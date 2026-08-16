"use client";

import { ActionForm, ActionButton, Field, Input, MoneyInput, Select, SubmitButton } from "@/components/form";
import { Badge } from "@/components/ui";
import {
  acceptItemAction,
  discardItemAction,
  acceptAllConfidentAction,
  discardBatchAction,
} from "@/server/actions/imports";

export type ProductOption = { id: string; name: string };

export function ConfidenceBadge({ confidence, method }: { confidence: number; method?: string }) {
  const tone = confidence >= 90 ? "green" : confidence >= 60 ? "amber" : "red";
  return (
    <span title={method ? `Erkennung: ${method}` : undefined}>
      <Badge tone={tone}>{confidence} %</Badge>
    </span>
  );
}

/** Prüfzeile: Produkt zuordnen, Menge/Preis korrigieren, übernehmen oder verwerfen. */
export function ItemReviewForm({
  itemId,
  supplierId,
  products,
  candidates,
  matchedProductId,
  defaultQty,
  defaultPriceCents,
}: {
  itemId: string;
  supplierId?: string | null;
  products: ProductOption[];
  candidates: Array<{ productId: string; name: string }>;
  matchedProductId: string | null;
  defaultQty: number | null;
  defaultPriceCents: number | null;
}) {
  const candidateIds = new Set(candidates.map((c) => c.productId));
  return (
    <ActionForm action={acceptItemAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="itemId" value={itemId} />
      {supplierId && <input type="hidden" name="supplierId" value={supplierId} />}
      <Field label="Produkt" className="min-w-[260px] flex-1">
        <Select name="productId" defaultValue={matchedProductId ?? ""}>
          <option value="">– Produkt wählen –</option>
          {candidates.length > 0 && (
            <optgroup label="Vorschläge">
              {candidates.map((c) => (
                <option key={c.productId} value={c.productId}>{c.name}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Alle Produkte">
            {products
              .filter((p) => !candidateIds.has(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
          </optgroup>
        </Select>
      </Field>
      <Field label="Menge" className="w-24">
        <Input type="number" name="qty" min={1} defaultValue={defaultQty ?? ""} required />
      </Field>
      <Field label="Einzelpreis" className="w-32">
        <MoneyInput name="unitPriceCents" defaultCents={defaultPriceCents} required />
      </Field>
      <SubmitButton size="md">Übernehmen</SubmitButton>
      <ActionButton
        action={discardItemAction}
        variant="ghost"
        size="md"
        hiddenFields={{ itemId }}
        confirmMessage="Position wirklich verwerfen?"
      >
        Verwerfen
      </ActionButton>
    </ActionForm>
  );
}

export function BatchActions({ batchId, supplierId }: { batchId: string; supplierId?: string | null }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionForm action={acceptAllConfidentAction} className="inline-block">
        <input type="hidden" name="batchId" value={batchId} />
        {supplierId && <input type="hidden" name="supplierId" value={supplierId} />}
        <SubmitButton variant="primary" size="sm">
          Alle sicheren übernehmen (≥ 90 %)
        </SubmitButton>
      </ActionForm>
      <ActionButton
        action={discardBatchAction}
        variant="danger"
        size="sm"
        hiddenFields={{ batchId }}
        confirmMessage="Alle offenen Positionen dieses Imports verwerfen?"
      >
        Batch verwerfen
      </ActionButton>
    </div>
  );
}
