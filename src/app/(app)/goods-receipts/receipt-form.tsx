"use client";

import { useState } from "react";
import { ActionForm, Field, Input, Select, SubmitButton } from "@/components/form";
import { Table, THead, Th, Td, Tr } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { label } from "@/lib/constants";
import { postGoodsReceiptAction } from "@/server/actions/goods-receipts";

export type ReceiptFormLine = {
  poLineId: string;
  productId: string;
  productName: string;
  sku: string;
  ordered: number;
  shipped: number;
  arrived: number;
  open: number;
};

export type ReceiptFormShipment = {
  id: string;
  shipmentNumber: string;
  status: string;
  trackingNumber: string | null;
  announcedTotal: number;
  items: Array<{ poLineId: string; qty: number }>;
};

/**
 * Wareneingangs-Formular: Kopf (Datum, Pakete, optionale Sendung) plus eine
 * Zeile je offener Bestellposition. Die angekommene Menge ist mit der offenen
 * Menge vorbelegt – im Normalfall reicht ein Klick auf „Wareneingang buchen“.
 */
export function ReceiptForm({
  purchaseOrderId,
  lines,
  shipments,
  defaultShipmentId,
  defaultDate,
}: {
  purchaseOrderId: string;
  lines: ReceiptFormLine[];
  shipments: ReceiptFormShipment[];
  defaultShipmentId: string;
  defaultDate: string;
}) {
  const [shipmentId, setShipmentId] = useState(defaultShipmentId);
  const shipment = shipments.find((s) => s.id === shipmentId) ?? null;
  const announcedByLine = new Map((shipment?.items ?? []).map((i) => [i.poLineId, i.qty]));

  return (
    <ActionForm action={postGoodsReceiptAction} className="flex flex-col gap-4">
      <input type="hidden" name="purchaseOrderId" value={purchaseOrderId} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Empfangsdatum" required>
          <Input type="date" name="receivedAt" defaultValue={defaultDate} required />
        </Field>
        <Field label="Paketanzahl" hint="Anzahl angekommener Pakete (optional)">
          <Input type="number" name="packageCount" min={0} step={1} placeholder="z.B. 3" />
        </Field>
        <Field
          label="Sendung"
          hint={
            shipment
              ? `${formatNumber(shipment.announcedTotal)} Einheiten angekündigt` +
                (shipment.trackingNumber ? ` · ${shipment.trackingNumber}` : "")
              : "Optional: zugehörige Sendung zuordnen"
          }
        >
          <Select name="shipmentId" value={shipmentId} onChange={(e) => setShipmentId(e.target.value)}>
            <option value="">– keine Sendung –</option>
            {shipments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.shipmentNumber} · {label(s.status)} · {formatNumber(s.announcedTotal)} Einheiten
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Table>
        <THead>
          <tr>
            <Th>Produkt</Th>
            <Th align="right">Bestellt</Th>
            <Th align="right">Versendet</Th>
            <Th align="right">Bereits angekommen</Th>
            <Th align="right">Offen</Th>
            <Th>Jetzt angekommen</Th>
            <Th>Beschädigt</Th>
            <Th>Fehlend</Th>
            <Th>Notiz</Th>
          </tr>
        </THead>
        <tbody>
          {lines.map((l) => {
            const announced = announcedByLine.get(l.poLineId);
            return (
              <Tr key={l.poLineId}>
                <Td>
                  <span className="font-medium">{l.productName}</span>
                  <span className="block font-mono text-xs text-ink-tertiary">{l.sku}</span>
                </Td>
                <Td align="right">{formatNumber(l.ordered)}</Td>
                <Td align="right">{formatNumber(l.shipped)}</Td>
                <Td align="right">{formatNumber(l.arrived)}</Td>
                <Td align="right" className="font-medium">
                  {formatNumber(l.open)}
                </Td>
                <Td>
                  <Input
                    type="number"
                    name={`recv_${l.poLineId}`}
                    min={0}
                    max={l.open}
                    step={1}
                    defaultValue={l.open}
                    className="w-24"
                  />
                  {announced !== undefined && (
                    <span className="mt-1 block text-xs text-ink-tertiary">
                      Sendung: {formatNumber(announced)} angekündigt
                    </span>
                  )}
                </Td>
                <Td>
                  <Input type="number" name={`dmg_${l.poLineId}`} min={0} step={1} placeholder="0" className="w-20" />
                </Td>
                <Td>
                  <Input type="number" name={`miss_${l.poLineId}`} min={0} step={1} placeholder="0" className="w-20" />
                </Td>
                <Td>
                  <Input
                    type="text"
                    name={`note_${l.poLineId}`}
                    placeholder="z.B. Karton eingedrückt"
                    className="min-w-[160px]"
                  />
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
        <p className="text-sm text-ink-secondary">
          Mengen prüfen und bestätigen – der Bestand wird sofort erhöht und der Bestellstatus aktualisiert.
        </p>
        <SubmitButton variant="primary">Wareneingang buchen</SubmitButton>
      </div>
    </ActionForm>
  );
}
