"use server";

import { db } from "../db";
import { requireRole } from "../auth";
import { AppError } from "../errors";
import { writeAudit, writeEvent, diffChanges } from "../audit";
import { refreshTracking } from "../carriers";
import { markShipmentDelivered } from "../services/sales";
import { CARRIERS, TRACKING_STATUSES, label } from "@/lib/constants";
import { runAction, str, optStr, optNum, optDate } from "./helpers";
import type { ActionState } from "@/components/form";

type ShipmentType = "INBOUND" | "CUSTOMER";

function parseShipmentType(formData: FormData): ShipmentType {
  const t = str(formData, "shipmentType");
  if (t !== "INBOUND" && t !== "CUSTOMER") {
    throw new AppError("Ungültiger Sendungstyp.");
  }
  return t;
}

/** Tracking über den Carrier-Adapter (Mock oder LIVE) aktualisieren. */
export async function refreshTrackingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    await requireRole("STAFF");
    const shipmentType = parseShipmentType(formData);
    const shipmentId = str(formData, "shipmentId");
    if (!shipmentId) throw new AppError("Die Sendung wurde nicht gefunden.");
    const result = await refreshTracking({ shipmentType, shipmentId });
    if ("error" in result) throw new AppError(result.error);
  });
}

/** Manuelles Tracking-Event erfassen (source MANUAL). */
export async function addTrackingEventAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const shipmentType = parseShipmentType(formData);
    const shipmentId = str(formData, "shipmentId");
    if (!shipmentId) throw new AppError("Die Sendung wurde nicht gefunden.");

    const status = str(formData, "status");
    if (!(TRACKING_STATUSES as readonly string[]).includes(status)) {
      throw new AppError("Bitte einen gültigen Tracking-Status wählen.");
    }
    const description = optStr(formData, "description");
    const location = optStr(formData, "location");
    const occurredAt = optDate(formData, "occurredAt") ?? new Date();

    if (shipmentType === "CUSTOMER") {
      const shipment = await db.customerShipment.findUnique({ where: { id: shipmentId } });
      if (!shipment) throw new AppError("Die Sendung wurde nicht gefunden.");

      await db.trackingEvent.create({
        data: {
          customerShipmentId: shipmentId,
          status,
          description,
          location,
          occurredAt,
          source: "MANUAL",
        },
      });
      await writeAudit({
        userId: user.id,
        entityType: "SHIPMENT",
        entityId: shipmentId,
        action: "UPDATE",
        comment: `Manuelles Tracking-Event erfasst: ${label(status)}`,
      });

      // Zustellung schließt die Sendung ab (Status, Zustelldatum, CO-Status).
      if (status === "DELIVERED" && ["SHIPPED", "IN_TRANSIT"].includes(shipment.status)) {
        await markShipmentDelivered({ shipmentId, deliveredAt: occurredAt, userId: user.id });
        await writeAudit({
          userId: user.id,
          entityType: "SHIPMENT",
          entityId: shipmentId,
          action: "STATUS_CHANGE",
          changes: [{ field: "status", old: shipment.status, new: "DELIVERED" }],
          comment: "Aus manuellem Tracking-Event (Zustellung) abgeleitet",
        });
      }
    } else {
      const shipment = await db.inboundShipment.findUnique({ where: { id: shipmentId } });
      if (!shipment) throw new AppError("Die Sendung wurde nicht gefunden.");

      await db.trackingEvent.create({
        data: {
          inboundShipmentId: shipmentId,
          status,
          description,
          location,
          occurredAt,
          source: "MANUAL",
        },
      });
      await writeAudit({
        userId: user.id,
        entityType: "SHIPMENT",
        entityId: shipmentId,
        action: "UPDATE",
        comment: `Manuelles Tracking-Event erfasst: ${label(status)}`,
      });

      // Eingehend: kein automatischer Wareneingang – nur Verzögerung spiegeln.
      if (status === "DELAYED" && !["DELAYED", "ARRIVED", "CANCELLED"].includes(shipment.status)) {
        await db.inboundShipment.update({ where: { id: shipmentId }, data: { status: "DELAYED" } });
        await writeAudit({
          userId: user.id,
          entityType: "SHIPMENT",
          entityId: shipmentId,
          action: "STATUS_CHANGE",
          changes: [{ field: "status", old: shipment.status, new: "DELAYED" }],
          comment: "Aus manuellem Tracking-Event (Verzögerung) abgeleitet",
        });
        await writeEvent({
          type: "INBOUND_SHIPMENT_DELAYED",
          entityType: "SHIPMENT",
          entityId: shipmentId,
          summary: `Sendung ${shipment.shipmentNumber} als verzögert gemeldet`,
          userId: user.id,
        });
      }
    }
  });
}

/** Carrier, Trackingnummer und Paketanzahl bearbeiten (beide Sendungstypen). */
export async function updateShipmentMetaAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const shipmentType = parseShipmentType(formData);
    const shipmentId = str(formData, "shipmentId");
    if (!shipmentId) throw new AppError("Die Sendung wurde nicht gefunden.");

    const carrier = optStr(formData, "carrier");
    if (carrier && !(CARRIERS as readonly string[]).includes(carrier)) {
      throw new AppError("Unbekannter Versanddienstleister.");
    }
    const trackingNumber = optStr(formData, "trackingNumber");

    if (shipmentType === "INBOUND") {
      const before = await db.inboundShipment.findUnique({ where: { id: shipmentId } });
      if (!before) throw new AppError("Die Sendung wurde nicht gefunden.");
      const rawCount = optNum(formData, "packageCount");
      const packageCount = rawCount === null ? null : Math.round(rawCount);
      if (packageCount !== null && packageCount <= 0) {
        throw new AppError("Die Paketanzahl muss größer als 0 sein.");
      }
      const data = { carrier, trackingNumber, packageCount };
      const changes = diffChanges(before as unknown as Record<string, unknown>, data);
      await db.inboundShipment.update({ where: { id: shipmentId }, data });
      if (changes.length > 0) {
        await writeAudit({
          userId: user.id,
          entityType: "SHIPMENT",
          entityId: shipmentId,
          action: "UPDATE",
          changes,
          comment: "Sendungsdaten aktualisiert",
        });
      }
    } else {
      const before = await db.customerShipment.findUnique({ where: { id: shipmentId } });
      if (!before) throw new AppError("Die Sendung wurde nicht gefunden.");
      const data = { carrier, trackingNumber };
      const changes = diffChanges(before as unknown as Record<string, unknown>, data);
      await db.customerShipment.update({ where: { id: shipmentId }, data });
      if (changes.length > 0) {
        await writeAudit({
          userId: user.id,
          entityType: "SHIPMENT",
          entityId: shipmentId,
          action: "UPDATE",
          changes,
          comment: "Sendungsdaten aktualisiert",
        });
      }
    }
  });
}

const INBOUND_MANUAL_STATUSES = ["IN_TRANSIT", "DELAYED", "CANCELLED"] as const;

/**
 * Status einer eingehenden Sendung manuell setzen.
 * „Angekommen“ wird bewusst NICHT hier gesetzt, sondern ausschließlich
 * über die Wareneingangs-Buchung (kein Bestand ohne menschliche Bestätigung).
 */
export async function markInboundStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const shipmentId = str(formData, "shipmentId");
    if (!shipmentId) throw new AppError("Die Sendung wurde nicht gefunden.");

    const status = str(formData, "status");
    if (!(INBOUND_MANUAL_STATUSES as readonly string[]).includes(status)) {
      throw new AppError(
        "Ungültiger Status. „Angekommen“ wird ausschließlich über die Wareneingangs-Buchung gesetzt."
      );
    }

    const shipment = await db.inboundShipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new AppError("Die Sendung wurde nicht gefunden.");
    if (shipment.status === "ARRIVED") {
      throw new AppError("Die Sendung ist bereits vollständig angekommen – der Status kann nicht mehr geändert werden.");
    }
    if (shipment.status === "CANCELLED") {
      throw new AppError("Die Sendung ist storniert – der Status kann nicht mehr geändert werden.");
    }
    if (shipment.status === status) {
      throw new AppError(`Die Sendung hat den Status „${label(status)}“ bereits.`);
    }

    const data: { status: string; shippedAt?: Date } = { status };
    const changes: Array<{ field: string; old: unknown; new: unknown }> = [
      { field: "status", old: shipment.status, new: status },
    ];
    if (status === "IN_TRANSIT" && !shipment.shippedAt) {
      const shippedAt = new Date();
      data.shippedAt = shippedAt;
      changes.push({ field: "shippedAt", old: null, new: shippedAt.toISOString() });
    }

    await db.inboundShipment.update({ where: { id: shipmentId }, data });
    await writeAudit({
      userId: user.id,
      entityType: "SHIPMENT",
      entityId: shipmentId,
      action: "STATUS_CHANGE",
      changes,
      comment: "Status manuell gesetzt",
    });
    await writeEvent({
      type: "INBOUND_SHIPMENT_STATUS_CHANGED",
      entityType: "SHIPMENT",
      entityId: shipmentId,
      summary: `Sendung ${shipment.shipmentNumber}: Status auf „${label(status)}“ gesetzt`,
      userId: user.id,
    });
  });
}

/** Kundensendung manuell als zugestellt markieren (SHIPPED/IN_TRANSIT). */
export async function markCustomerDeliveredAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF");
    const shipmentId = str(formData, "shipmentId");
    if (!shipmentId) throw new AppError("Die Sendung wurde nicht gefunden.");
    const before = await db.customerShipment.findUnique({ where: { id: shipmentId } });
    if (!before) throw new AppError("Die Sendung wurde nicht gefunden.");

    await markShipmentDelivered({ shipmentId, userId: user.id });
    await writeAudit({
      userId: user.id,
      entityType: "SHIPMENT",
      entityId: shipmentId,
      action: "STATUS_CHANGE",
      changes: [{ field: "status", old: before.status, new: "DELIVERED" }],
      comment: "Zustellung manuell bestätigt",
    });
  });
}
