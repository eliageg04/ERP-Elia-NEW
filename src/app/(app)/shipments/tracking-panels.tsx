"use client";

import { Card } from "@/components/ui";
import { ActionForm, ActionButton, Field, Input, Select, SubmitButton } from "@/components/form";
import { CARRIERS, TRACKING_STATUSES, label } from "@/lib/constants";
import {
  refreshTrackingAction,
  addTrackingEventAction,
  updateShipmentMetaAction,
  markInboundStatusAction,
  markCustomerDeliveredAction,
} from "@/server/actions/shipments";

type ShipmentType = "INBOUND" | "CUSTOMER";

/** Tracking beim Carrier abrufen (nur mit Trackingnummer + Carrier möglich). */
export function TrackingRefreshPanel({
  shipmentType,
  shipmentId,
  canRefresh,
  mockMode,
}: {
  shipmentType: ShipmentType;
  shipmentId: string;
  canRefresh: boolean;
  mockMode: boolean;
}) {
  return (
    <Card title="Tracking abrufen">
      {canRefresh ? (
        <div className="flex flex-col gap-2">
          <ActionButton
            action={refreshTrackingAction}
            variant="primary"
            size="md"
            hiddenFields={{ shipmentType, shipmentId }}
          >
            Tracking aktualisieren
          </ActionButton>
          {mockMode && (
            <p className="text-xs text-ink-tertiary">
              Hinweis: Die Abfrage läuft im Mock-Modus, solange die UPS-Integration nicht LIVE
              konfiguriert ist (Einstellungen → Integrationen). Manuelles Tracking funktioniert immer.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-tertiary">
          Zum automatischen Abruf zuerst Carrier und Trackingnummer unter „Sendungsdaten bearbeiten“
          hinterlegen.
        </p>
      )}
    </Card>
  );
}

/** Manuelles Tracking-Event erfassen (source MANUAL). */
export function ManualTrackingEventForm({
  shipmentType,
  shipmentId,
}: {
  shipmentType: ShipmentType;
  shipmentId: string;
}) {
  return (
    <Card title="Tracking-Event manuell erfassen">
      <ActionForm action={addTrackingEventAction} resetOnSuccess className="flex flex-col gap-3">
        <input type="hidden" name="shipmentType" value={shipmentType} />
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <Field label="Status" required>
          <Select name="status" required defaultValue="">
            <option value="" disabled>
              – wählen –
            </option>
            {TRACKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Beschreibung">
          <Input name="description" placeholder="z.B. Laut Hotline im Zustellfahrzeug" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ort">
            <Input name="location" placeholder="z.B. Köln" />
          </Field>
          <Field label="Zeitpunkt" required>
            <Input type="datetime-local" name="occurredAt" required />
          </Field>
        </div>
        <div>
          <SubmitButton size="sm">Event speichern</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

/** Carrier / Trackingnummer / Paketanzahl bearbeiten. */
export function ShipmentMetaForm({
  shipmentType,
  shipmentId,
  carrier,
  trackingNumber,
  packageCount,
}: {
  shipmentType: ShipmentType;
  shipmentId: string;
  carrier: string | null;
  trackingNumber: string | null;
  packageCount?: number | null;
}) {
  const showPackageCount = shipmentType === "INBOUND";
  return (
    <Card title="Sendungsdaten bearbeiten">
      <ActionForm action={updateShipmentMetaAction} className="flex flex-col gap-3">
        <input type="hidden" name="shipmentType" value={shipmentType} />
        <input type="hidden" name="shipmentId" value={shipmentId} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Carrier">
            <Select name="carrier" defaultValue={carrier ?? ""}>
              <option value="">– kein Carrier –</option>
              {CARRIERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {showPackageCount && (
            <Field label="Pakete">
              <Input
                type="number"
                name="packageCount"
                min={1}
                defaultValue={packageCount ?? undefined}
                placeholder="z.B. 3"
              />
            </Field>
          )}
        </div>
        <Field label="Trackingnummer">
          <Input
            name="trackingNumber"
            defaultValue={trackingNumber ?? ""}
            placeholder="z.B. 1Z999AA10123456784"
            className="font-mono"
          />
        </Field>
        <div>
          <SubmitButton size="sm">Speichern</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

const INBOUND_MANUAL_STATUSES = ["IN_TRANSIT", "DELAYED", "CANCELLED"] as const;

/** Status einer eingehenden Sendung manuell setzen (ohne ARRIVED). */
export function InboundStatusForm({
  shipmentId,
  currentStatus,
}: {
  shipmentId: string;
  currentStatus: string;
}) {
  const locked = currentStatus === "ARRIVED" || currentStatus === "CANCELLED";
  return (
    <Card title="Sendungsstatus setzen">
      {locked ? (
        <p className="text-sm text-ink-tertiary">
          Der Status „{label(currentStatus)}“ ist endgültig und kann nicht mehr geändert werden.
        </p>
      ) : (
        <ActionForm action={markInboundStatusAction} className="flex flex-col gap-3">
          <input type="hidden" name="shipmentId" value={shipmentId} />
          <Field
            label="Neuer Status"
            required
            hint="„Angekommen“ wird nicht manuell gesetzt, sondern automatisch beim Buchen des Wareneingangs."
          >
            <Select name="status" required defaultValue="">
              <option value="" disabled>
                – wählen –
              </option>
              {INBOUND_MANUAL_STATUSES.filter((s) => s !== currentStatus).map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <SubmitButton size="sm" confirmMessage="Sendungsstatus wirklich ändern?">
              Status übernehmen
            </SubmitButton>
          </div>
        </ActionForm>
      )}
    </Card>
  );
}

/** Kundensendung als zugestellt markieren (nur SHIPPED/IN_TRANSIT). */
export function MarkDeliveredButton({ shipmentId }: { shipmentId: string }) {
  return (
    <ActionButton
      action={markCustomerDeliveredAction}
      variant="primary"
      size="md"
      hiddenFields={{ shipmentId }}
      confirmMessage="Sendung wirklich als zugestellt markieren?"
    >
      Als zugestellt markieren
    </ActionButton>
  );
}
