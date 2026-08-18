// Zentrale Status-/Typ-Definitionen. SQLite kennt keine Enums,
// daher werden alle Werte hier definiert und serverseitig validiert.

export const ROLES = ["ADMIN", "STAFF", "READONLY"] as const;
export type Role = (typeof ROLES)[number];

export const PO_STATUSES = [
  "DRAFT",
  "ORDERED",
  "CONFIRMED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const CO_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "PARTIALLY_SHIPPED",
  "SHIPPED",
  "PARTIALLY_DELIVERED",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type CoStatus = (typeof CO_STATUSES)[number];

export const INBOUND_SHIPMENT_STATUSES = [
  "ANNOUNCED",
  "IN_TRANSIT",
  "DELAYED",
  "PARTIALLY_ARRIVED",
  "ARRIVED",
  "CANCELLED",
] as const;

export const CUSTOMER_SHIPMENT_STATUSES = [
  "PREPARED",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
] as const;

export const INVOICE_STATUSES = ["OPEN", "PARTIALLY_PAID", "PAID", "CANCELLED"] as const;

export const INVENTORY_TX_TYPES = [
  "RECEIPT",
  "CUSTOMER_SHIPMENT",
  "ADJUSTMENT",
  "DAMAGE",
  "LOSS",
  "RETURN",
  "CORRECTION",
] as const;
export type InventoryTxType = (typeof INVENTORY_TX_TYPES)[number];

export const COST_TYPES = ["SHIPPING", "CUSTOMS", "FEES", "OTHER"] as const;
export const COST_ALLOCATION_METHODS = ["BY_VALUE", "BY_QUANTITY", "MANUAL"] as const;

export const CARRIERS = ["UPS", "DHL", "DPD", "GLS", "FEDEX", "OTHER"] as const;

export const TRACKING_STATUSES = [
  "LABEL_CREATED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELAYED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "EXCEPTION",
] as const;

export const CURRENCIES = ["EUR", "USD", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const IMPORT_SOURCES = ["CSV", "XLSX", "PDF", "MANUAL", "LEXWARE"] as const;
export const IMPORT_KINDS = [
  "SUPPLIER_INVOICE",
  "PURCHASE_ORDER",
  "PRODUCTS",
  "CUSTOMERS",
  "SUPPLIERS",
  "OPENING_STOCK",
  "INVENTORY",
] as const;

// Deutsche Anzeige-Labels
export const LABELS: Record<string, string> = {
  // PO-Status
  DRAFT: "Entwurf",
  ORDERED: "Bestellt",
  CONFIRMED: "Bestätigt",
  PARTIALLY_SHIPPED: "Teilweise versendet",
  SHIPPED: "Versendet",
  PARTIALLY_RECEIVED: "Teilweise angekommen",
  RECEIVED: "Angekommen",
  COMPLETED: "Abgeschlossen",
  CANCELLED: "Storniert",
  // CO-Status
  PARTIALLY_DELIVERED: "Teilweise zugestellt",
  DELIVERED: "Zugestellt",
  // Sendungen
  ANNOUNCED: "Angekündigt",
  IN_TRANSIT: "Unterwegs",
  DELAYED: "Verzögert",
  PARTIALLY_ARRIVED: "Teilweise angekommen",
  ARRIVED: "Angekommen",
  PREPARED: "Versand vorbereitet",
  // Rechnungen
  OPEN: "Offen",
  PARTIALLY_PAID: "Teilweise bezahlt",
  PAID: "Bezahlt",
  // Bestand
  RECEIPT: "Wareneingang",
  CUSTOMER_SHIPMENT: "Kundenversand",
  ADJUSTMENT: "Korrektur",
  DAMAGE: "Beschädigt",
  LOSS: "Verlust",
  RETURN: "Retoure",
  CORRECTION: "Manuelle Korrektur",
  // Kosten
  SHIPPING: "Versand",
  CUSTOMS: "Zoll",
  FEES: "Gebühren",
  OTHER: "Sonstiges",
  BY_VALUE: "Nach Warenwert",
  BY_QUANTITY: "Nach Menge",
  MANUAL: "Manuell",
  // Tracking
  LABEL_CREATED: "Label erstellt",
  PICKED_UP: "Abgeholt",
  OUT_FOR_DELIVERY: "In Zustellung",
  EXCEPTION: "Problem",
  // Rollen
  ADMIN: "Admin",
  STAFF: "Mitarbeiter",
  READONLY: "Nur lesen",
  // Reservierung
  ACTIVE: "Aktiv",
  RELEASED: "Freigegeben",
  // Import
  REVIEW: "Prüfung",
  PENDING: "Ausstehend",
  ACCEPTED: "Übernommen",
  EDITED: "Bearbeitet",
  DISCARDED: "Verworfen",
  DUPLICATE: "Duplikat",
  FAILED: "Fehlgeschlagen",
  // Zahlungsrichtungen
  OUTGOING: "Ausgehend",
  INCOMING: "Eingehend",
  SUPPLIER: "Eingangsrechnung",
  CUSTOMER: "Ausgangsrechnung",
};

export function label(key: string | null | undefined): string {
  if (!key) return "–";
  return LABELS[key] ?? key;
}

// Statusfarben (semantisch, zurückhaltend eingesetzt)
export const STATUS_TONE: Record<string, "neutral" | "blue" | "amber" | "green" | "red" | "violet"> = {
  DRAFT: "neutral",
  ORDERED: "blue",
  CONFIRMED: "blue",
  PARTIALLY_SHIPPED: "amber",
  SHIPPED: "violet",
  PARTIALLY_RECEIVED: "amber",
  RECEIVED: "green",
  COMPLETED: "green",
  CANCELLED: "red",
  PARTIALLY_DELIVERED: "amber",
  DELIVERED: "green",
  ANNOUNCED: "neutral",
  IN_TRANSIT: "violet",
  DELAYED: "red",
  PARTIALLY_ARRIVED: "amber",
  ARRIVED: "green",
  PREPARED: "blue",
  OPEN: "amber",
  PARTIALLY_PAID: "amber",
  PAID: "green",
  ACTIVE: "blue",
  RELEASED: "neutral",
  REVIEW: "amber",
  PENDING: "amber",
  ACCEPTED: "green",
  EDITED: "blue",
  DISCARDED: "neutral",
  DUPLICATE: "red",
  FAILED: "red",
  LABEL_CREATED: "neutral",
  PICKED_UP: "blue",
  OUT_FOR_DELIVERY: "violet",
  EXCEPTION: "red",
};
