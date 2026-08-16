"use client";

import { ActionForm, Field, Input, MoneyInput, Select, SubmitButton, type FormAction } from "@/components/form";

type ProductData = {
  id?: string;
  name?: string;
  sku?: string;
  productType?: string | null;
  setName?: string | null;
  language?: string | null;
  edition?: string | null;
  ean?: string | null;
  manufacturer?: string | null;
  baseUnitId?: string;
  listPriceCents?: number | null;
};

const PRODUCT_TYPES = [
  "Booster Box",
  "Booster Display",
  "Elite Trainer Box",
  "Booster Bundle",
  "Tin",
  "Collection Box",
  "Einzelkarte",
  "Zubehör",
  "Sonstiges",
];

export function ProductForm({
  action,
  units,
  product,
}: {
  action: FormAction;
  units: Array<{ id: string; name: string; code: string }>;
  product?: ProductData;
}) {
  const isEdit = Boolean(product?.id);
  return (
    <ActionForm action={action} className="flex max-w-2xl flex-col gap-4">
      {product?.id && <input type="hidden" name="id" value={product.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Produktname" required className="sm:col-span-2">
          <Input name="name" defaultValue={product?.name} required placeholder="z.B. Pokémon Scarlet & Violet 151 Booster Display" />
        </Field>
        <Field label="Produktart">
          <Select name="productType" defaultValue={product?.productType ?? ""}>
            <option value="">– wählen –</option>
            {PRODUCT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Set">
          <Input name="setName" defaultValue={product?.setName ?? ""} placeholder="z.B. Scarlet & Violet 151" />
        </Field>
        <Field label="Sprache">
          <Select name="language" defaultValue={product?.language ?? "EN"}>
            {["EN", "DE", "JP", "FR", "IT", "ES", "KR", "CN"].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </Select>
        </Field>
        <Field label="Edition">
          <Input name="edition" defaultValue={product?.edition ?? ""} placeholder="z.B. 1st Edition" />
        </Field>
        <Field label="EAN">
          <Input name="ean" defaultValue={product?.ean ?? ""} inputMode="numeric" />
        </Field>
        <Field label="Hersteller">
          <Input name="manufacturer" defaultValue={product?.manufacturer ?? ""} placeholder="z.B. The Pokémon Company" />
        </Field>
        <Field label="Interne SKU" hint={isEdit ? undefined : "Leer lassen für automatische Vergabe (PRD-XXXX)"}>
          <Input name="sku" defaultValue={product?.sku ?? ""} />
        </Field>
        {!isEdit && (
          <Field label="Basiseinheit" required hint="Kleinste Einheit, in der der Bestand geführt wird">
            <Select name="baseUnitId" required defaultValue={product?.baseUnitId ?? ""}>
              <option value="">– wählen –</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Ziel-Verkaufspreis (pro Basiseinheit)">
          <MoneyInput name="listPriceCents" defaultCents={product?.listPriceCents} />
        </Field>
      </div>
      <div>
        <SubmitButton>{isEdit ? "Änderungen speichern" : "Produkt anlegen"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
