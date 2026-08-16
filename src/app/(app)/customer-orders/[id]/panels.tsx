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
  addCoLineAction,
  updateCoLineAction,
  deleteCoLineAction,
  allocateLineAction,
  createShipmentAction,
} from "@/server/actions/customer-orders";
import { CARRIERS } from "@/lib/constants";

// ---------- Position hinzufügen ----------

type ProductOption = {
  id: string;
  name: string;
  available: number;
  listPriceCents: number | null;
};

/** Neue Bestellzeile: der Ziel-VK des Produkts wird als Preis vorgeschlagen. */
export function AddCoLineForm({
  customerOrderId,
  products,
}: {
  customerOrderId: string;
  products: ProductOption[];
}) {
  const [productId, setProductId] = useState("");
  const selected = products.find((p) => p.id === productId);

  return (
    <Card title="Position hinzufügen">
      <ActionForm action={addCoLineAction} resetOnSuccess className="flex flex-col gap-3">
        <input type="hidden" name="customerOrderId" value={customerOrderId} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Produkt" required className="sm:col-span-2 lg:col-span-3">
            <Select
              name="productId"
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">– wählen –</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (verfügbar: {p.available})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Menge (Basiseinheiten)" required>
            <Input type="number" name="qty" min={1} required placeholder="1" />
          </Field>
          <Field
            label="VK je Einheit (EUR)"
            required
            hint={
              selected
                ? selected.listPriceCents !== null
                  ? "Vorschlag: Ziel-VK des Produkts"
                  : "Kein Ziel-VK hinterlegt"
                : undefined
            }
          >
            {/* key erzwingt Neuaufbau, damit der Ziel-VK des gewählten Produkts vorbelegt wird */}
            <MoneyInput
              key={productId || "empty"}
              name="unitPriceCents"
              defaultCents={selected?.listPriceCents ?? undefined}
              required
            />
          </Field>
          <Field label="Rabatt auf Zeile (EUR)">
            <MoneyInput name="discountCents" />
          </Field>
          <div className="flex items-end lg:col-span-3">
            <SubmitButton size="md">Position hinzufügen</SubmitButton>
          </div>
        </div>
      </ActionForm>
    </Card>
  );
}

// ---------- Inline reservieren ----------

/**
 * Reservieren-Formular je Zeile: max = min(offen, verfügbar).
 * Bei Unterdeckung wird die Fehlmenge (+ unterwegs befindliche Ware) angezeigt.
 */
export function AllocateLineForm({
  orderLineId,
  open,
  available,
  inTransit,
}: {
  orderLineId: string;
  open: number;
  available: number;
  inTransit: number;
}) {
  const max = Math.min(open, Math.max(0, available));
  const missing = open - max;
  return (
    <div className="flex flex-col gap-1">
      {max > 0 && (
        <ActionForm action={allocateLineAction} resetOnSuccess className="flex items-center gap-1.5">
          <input type="hidden" name="orderLineId" value={orderLineId} />
          <Input
            type="number"
            name="qty"
            min={1}
            max={max}
            defaultValue={max}
            required
            className="w-20"
          />
          <SubmitButton size="sm" variant="secondary">
            Reservieren
          </SubmitButton>
        </ActionForm>
      )}
      {open > 0 && missing > 0 && (
        <span className="text-xs text-warn">
          {missing} fehlen
          {inTransit > 0 ? ` – ${inTransit} unterwegs` : ""}
        </span>
      )}
      {open <= 0 && <span className="text-xs text-ink-tertiary">vollständig zugeordnet</span>}
    </div>
  );
}

// ---------- Zeile inline bearbeiten / löschen ----------

export function CoLineEditor({
  line,
  canEdit,
  canDelete,
}: {
  line: {
    id: string;
    qty: number;
    unitPriceCents: number;
    discountCents: number;
    reserved: number; // aktiv reservierte Menge (Untergrenze für die neue Menge)
  };
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [editing, setEditing] = useState(false);

  if (!canEdit && !canDelete) {
    return <span className="text-xs text-ink-tertiary">–</span>;
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        {canEdit && (
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setEditing(true)}>
            Bearbeiten
          </button>
        )}
        {canDelete && (
          <ActionButton
            action={deleteCoLineAction}
            variant="ghost"
            hiddenFields={{ lineId: line.id }}
            confirmMessage="Position wirklich löschen? Aktive Reservierungen werden dabei freigegeben."
          >
            Löschen
          </ActionButton>
        )}
      </div>
    );
  }

  return (
    <ActionForm
      action={updateCoLineAction}
      className="min-w-[260px] rounded-md border border-border bg-canvas/60 p-3 text-left"
    >
      <input type="hidden" name="lineId" value={line.id} />
      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Menge (Basiseinheiten)"
          required
          hint={line.reserved > 0 ? `Mindestens ${line.reserved} (bereits reserviert)` : undefined}
        >
          <Input type="number" name="qty" min={Math.max(1, line.reserved)} defaultValue={line.qty} required />
        </Field>
        <Field label="VK je Einheit">
          <MoneyInput name="unitPriceCents" defaultCents={line.unitPriceCents} required />
        </Field>
        <Field label="Rabatt (Zeile)" className="col-span-2">
          <MoneyInput name="discountCents" defaultCents={line.discountCents} />
        </Field>
      </div>
      <Field label="Begründung" required className="mt-2">
        <Textarea name="reason" required placeholder="z.B. Kunde hat die Menge reduziert" />
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

// ---------- Versand erstellen ----------

/** Versand erstellen: Vorbelegung je Zeile = aktive Reservierungsmenge. */
export function CreateCustomerShipmentForm({
  customerOrderId,
  lines,
}: {
  customerOrderId: string;
  lines: Array<{ id: string; productName: string; allocated: number }>;
}) {
  return (
    <ActionForm action={createShipmentAction} resetOnSuccess className="flex flex-col gap-3">
      <input type="hidden" name="customerOrderId" value={customerOrderId} />
      <div className="grid gap-2 sm:grid-cols-2">
        {lines.map((l) => (
          <Field
            key={l.id}
            label={l.productName}
            hint={`Aktiv reserviert: ${l.allocated} Basiseinheiten`}
          >
            <Input type="number" name={`ship_${l.id}`} min={0} max={l.allocated} defaultValue={l.allocated} />
          </Field>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <Field label="Versendet am" hint="Leer = heute">
          <Input type="date" name="shippedAt" />
        </Field>
        <label className="flex items-center gap-2 pt-6 text-sm text-ink-secondary">
          <input type="checkbox" name="markShipped" value="1" defaultChecked />
          Direkt als versendet buchen
        </label>
      </div>
      <p className="text-xs text-ink-tertiary">
        Beim Buchen als „versendet“ wird der Bestand per FIFO ausgebucht und die Einkaufskosten
        (COGS) werden eingefroren. Ohne Häkchen wird die Sendung nur vorbereitet – die Ware bleibt
        reserviert.
      </p>
      <div>
        <SubmitButton size="sm">Versand erstellen</SubmitButton>
      </div>
    </ActionForm>
  );
}
