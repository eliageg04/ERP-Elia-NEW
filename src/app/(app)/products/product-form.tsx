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

/**
 * Produktformular – bewusst minimal: nur der Name ist Pflicht
 * (z.B. "2025 Topps Bowman Draft Baseball Hobby Case").
 * Alles Weitere ist optional und eingeklappt.
 */
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
      <Field label="Produktname" required hint="Genau so, wie du es kennst – z.B. „2025 Topps Bowman Draft Baseball Hobby Case“">
        <Input name="name" defaultValue={product?.name} required placeholder="z.B. 2025 Topps Bowman Draft Baseball Hobby Case" />
      </Field>

      <details>
        <summary className="cursor-pointer text-sm font-medium text-ink-secondary hover:text-ink">
          Erweiterte Angaben (optional)
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label="Ziel-Verkaufspreis" hint="Wird im Verkaufs-Formular vorgeschlagen">
            <MoneyInput name="listPriceCents" defaultCents={product?.listPriceCents} />
          </Field>
          <Field label="EAN">
            <Input name="ean" defaultValue={product?.ean ?? ""} inputMode="numeric" />
          </Field>
          <Field label="Set">
            <Input name="setName" defaultValue={product?.setName ?? ""} />
          </Field>
          <Field label="Sprache">
            <Input name="language" defaultValue={product?.language ?? ""} placeholder="z.B. EN" />
          </Field>
          <Field label="Interne SKU" hint="Leer lassen für automatische Vergabe (PRD-XXXX)">
            <Input name="sku" defaultValue={product?.sku ?? ""} />
          </Field>
          {!isEdit && (
            <Field label="Basiseinheit" hint="Leer lassen = Stück (1 Case/Box = 1 Einheit)">
              <Select name="baseUnitId" defaultValue={product?.baseUnitId ?? ""}>
                <option value="">Standard (Stück)</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </details>

      <div>
        <SubmitButton>{isEdit ? "Änderungen speichern" : "Produkt anlegen"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
