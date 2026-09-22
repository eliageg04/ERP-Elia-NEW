"use client";

import { useState } from "react";
import { Card, buttonClass } from "@/components/ui";
import {
  ActionForm,
  ActionButton,
  Field,
  Input,
  MoneyInput,
  Select,
  SubmitButton,
  Textarea,
} from "@/components/form";
import {
  addPoLineAction,
  updatePoLineAction,
  deletePoLineAction,
  overrideStatusAction,
  clearOverrideAction,
  markConfirmedAction,
  createShipmentAction,
  addPoCostAction,
} from "@/server/actions/purchase-orders";
import {
  PO_STATUSES,
  CARRIERS,
  COST_TYPES,
  COST_ALLOCATION_METHODS,
  label,
} from "@/lib/constants";

// ---------- Position hinzufügen ----------

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  baseUnitId: string;
  baseUnitName: string;
  conversions: Array<{ unitId: string; factor: number }>;
};

/** Neue Bestellzeile – bewusst schlank: Produkt, Menge, EK. (1 Einheit = 1 Case/Box) */
export function AddPoLineForm({
  purchaseOrderId,
  products,
  units,
  currency,
}: {
  purchaseOrderId: string;
  products: ProductOption[];
  units: Array<{ id: string; name: string }>;
  currency: string;
}) {
  void units;
  void currency;
  const [productId, setProductId] = useState("");
  const product = products.find((p) => p.id === productId);

  return (
    <Card title="Position hinzufügen">
      <ActionForm action={addPoLineAction} resetOnSuccess className="flex flex-col gap-3">
        <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />
        {/* Einheit fix: Basiseinheit des Produkts, Faktor 1 (alles wird als Case/Box je 1 geführt) */}
        <input type="hidden" name="enteredUnitId" value={product?.baseUnitId ?? ""} />
        <input type="hidden" name="unitFactor" value="1" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Produkt" required className="sm:col-span-2 lg:col-span-3">
            <Select
              name="productId"
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">– wählen –</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Menge" required>
            <Input type="number" name="enteredQty" min={1} required placeholder="z.B. 3" />
          </Field>
          <Field label="EK je Einheit" required>
            <MoneyInput name="unitPriceCents" required placeholder="z.B. 3992,00" />
          </Field>
          <div className="flex items-end lg:col-span-5">
            <SubmitButton size="md">Position hinzufügen</SubmitButton>
          </div>
        </div>
      </ActionForm>
    </Card>
  );
}

// ---------- Zeile inline bearbeiten / löschen ----------

export function PoLineEditor({
  line,
  canDelete,
}: {
  line: {
    id: string;
    enteredQty: number;
    unitFactor: number;
    unitPriceCents: number;
    discountCents: number;
    unitName: string;
  };
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setEditing(true)}>
          Bearbeiten
        </button>
        {canDelete && (
          <ActionButton
            action={deletePoLineAction}
            variant="ghost"
            hiddenFields={{ lineId: line.id }}
            confirmMessage="Position wirklich löschen?"
          >
            Löschen
          </ActionButton>
        )}
      </div>
    );
  }

  return (
    <ActionForm
      action={updatePoLineAction}
      className="min-w-[260px] rounded-md border border-border bg-canvas/60 p-3 text-left"
    >
      <input type="hidden" name="lineId" value={line.id} />
      <input type="hidden" name="unitFactor" value={line.unitFactor} />
      <input type="hidden" name="discountCents" value={line.discountCents} />
      <div className="grid grid-cols-2 gap-2">
        <Field label={`Menge (${line.unitName})`} required>
          <Input type="number" name="enteredQty" min={1} defaultValue={line.enteredQty} required />
        </Field>
        <Field label="EK je Einheit">
          <MoneyInput name="unitPriceCents" defaultCents={line.unitPriceCents} required />
        </Field>
      </div>
      <Field label="Begründung" required className="mt-2">
        <Textarea name="reason" required placeholder="z.B. Lieferant hat die Menge reduziert" />
      </Field>
      <div className="mt-2 flex items-center gap-2">
        <SubmitButton size="sm">Speichern</SubmitButton>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setEditing(false)}>
          Abbrechen
        </button>
      </div>
    </ActionForm>
  );
}

// ---------- Bestätigen mit Mengen ----------

export function ConfirmPoForm({
  poId,
  lines,
}: {
  poId: string;
  lines: Array<{ id: string; productName: string; qtyOrdered: number }>;
}) {
  return (
    <Card title="Bestellung bestätigen">
      <ActionForm action={markConfirmedAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={poId} />
        <p className="text-sm text-ink-tertiary">
          Optional: vom Lieferanten bestätigte Mengen (Basiseinheiten) je Position erfassen – leer
          gelassene Felder bleiben unverändert.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {lines.map((l) => (
            <Field key={l.id} label={l.productName} hint={`Bestellt: ${l.qtyOrdered}`}>
              <Input type="number" name={`qtyConfirmed_${l.id}`} min={0} placeholder={String(l.qtyOrdered)} />
            </Field>
          ))}
        </div>
        <div>
          <SubmitButton size="sm">Als bestätigt markieren</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

// ---------- Status-Override ----------

export function StatusOverrideForm({
  poId,
  currentStatus,
  overridden,
}: {
  poId: string;
  currentStatus: string;
  overridden: boolean;
}) {
  return (
    <Card title="Status manuell setzen">
      <ActionForm action={overrideStatusAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={poId} />
        <Field label="Neuer Status" required>
          <Select name="status" defaultValue={currentStatus} required>
            {PO_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Begründung"
          required
          hint="Der Status wird danach nicht mehr automatisch aus den Mengen berechnet."
        >
          <Textarea name="reason" required placeholder="z.B. Lieferant hat Restmenge erstattet – Bestellung gilt als abgeschlossen" />
        </Field>
        <div>
          <SubmitButton size="sm" variant="secondary">
            Status setzen
          </SubmitButton>
        </div>
      </ActionForm>
      {overridden && (
        <div className="mt-3 border-t border-border pt-3">
          <ActionButton action={clearOverrideAction} variant="ghost" hiddenFields={{ id: poId }}>
            Override aufheben (Status wieder automatisch)
          </ActionButton>
        </div>
      )}
    </Card>
  );
}

// ---------- Sendung melden ----------

export function CreateShipmentForm({
  poId,
  lines,
}: {
  poId: string;
  lines: Array<{ id: string; productName: string; remaining: number }>;
}) {
  return (
    <ActionForm action={createShipmentAction} resetOnSuccess className="flex flex-col gap-3">
      <input type="hidden" name="purchaseOrderId" value={poId} />
      <div className="grid gap-2 sm:grid-cols-2">
        {lines.map((l) => (
          <Field
            key={l.id}
            label={l.productName}
            hint={`Noch nicht versendet: ${l.remaining} Basiseinheiten`}
          >
            <Input type="number" name={`shipQty_${l.id}`} min={0} max={l.remaining} defaultValue={l.remaining} />
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Field label="Versanddienstleister">
          <Select name="carrier" defaultValue="">
            <option value="">– wählen –</option>
            {CARRIERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trackingnummer">
          <Input name="trackingNumber" placeholder="z.B. 1Z999AA10123456784" />
        </Field>
        <Field label="Pakete">
          <Input type="number" name="packageCount" min={1} placeholder="1" />
        </Field>
        <Field label="Versendet am" hint="Leer = heute">
          <Input type="date" name="shippedAt" />
        </Field>
        <Field label="Voraussichtliche Ankunft">
          <Input type="date" name="estimatedArrival" />
        </Field>
      </div>
      <div>
        <SubmitButton size="sm">Sendung melden</SubmitButton>
      </div>
    </ActionForm>
  );
}

// ---------- Nebenkosten erfassen ----------

export function AddCostForm({ poId }: { poId: string }) {
  return (
    <ActionForm
      action={addPoCostAction}
      resetOnSuccess
      className="mt-3 grid items-end gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-[140px_1fr_140px_160px_auto]"
    >
      <input type="hidden" name="purchaseOrderId" value={poId} />
      <Field label="Typ">
        <Select name="type" defaultValue="SHIPPING">
          {COST_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Beschreibung">
        <Input name="description" placeholder="z.B. UPS Expressversand aus UK" />
      </Field>
      <Field label="Betrag (EUR)" required>
        <MoneyInput name="amountCents" required />
      </Field>
      <Field label="Verteilung" hint="auf die Positionen">
        <Select name="allocationMethod" defaultValue="BY_VALUE">
          {COST_ALLOCATION_METHODS.map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton size="md" variant="secondary" className="mb-0.5">
        Kosten erfassen
      </SubmitButton>
    </ActionForm>
  );
}
