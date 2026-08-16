# Entwicklungs-Konventionen (für alle Module verbindlich)

## Architektur

- **Next.js 15 App Router**, TypeScript strict, Tailwind v4.
- Seiten: Server Components unter `src/app/(app)/<modul>/`. Interaktive Teile als kleine Client-Komponenten (`"use client"`) in Dateien wie `panels.tsx` / `<name>-form.tsx` im selben Ordner.
- Geschäftslogik NUR in `src/server/services/*` (bereits vorhanden) oder Server Actions `src/server/actions/<modul>.ts` (`"use server"` am Dateianfang).
- Jede Detailseite: `export const dynamic = "force-dynamic";`
- `params`/`searchParams` sind in Next 15 **Promises** → `const { id } = await params;`

## Server Actions (Vertrag)

```ts
"use server";
import { runAction, str, optStr, num, optNum, optDate } from "./helpers";
import { requireRole } from "../auth";
import type { ActionState } from "@/components/form";

export async function fooAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireRole("STAFF"); // Mutationen: STAFF; Admin-Funktionen: ADMIN
    // ... AppError für Geschäftsfehler mit deutscher Meldung werfen
    return { redirect: `/ziel/${id}` }; // optional
  });
}
```

- Fehler: `new AppError("Verständliche deutsche Meldung.")` aus `@/server/errors`.
- Audit: `writeAudit({ userId, entityType, entityId, action, changes, comment })` aus `@/server/audit` bei jeder relevanten Änderung; `diffChanges(before, after)` für Feld-Diffs.
- Events: `writeEvent({ type, entityType, entityId, summary })` für Warenfluss-Ereignisse.
- Geld: **Integer-Cents**. Formulare nutzen `MoneyInput` (liefert Cents als Hidden-Feld). Anzeige: `formatEur(cents)`.
- Mengen: Integer in Basiseinheiten. Einheiten-Erfassung: `enteredQty × unitFactor = qtyOrdered`.

## UI-Bausteine (nur diese verwenden, keine neuen Basis-Komponenten!)

Aus `@/components/ui`: `PageHeader`, `Card`, `StatCard`, `Badge`, `StatusBadge`,
`Table/THead/Th/Td/Tr`, `EmptyState`, `DL/DT/DD`, `QtyProgress`, `LinkButton`, `buttonClass`.
Aus `@/components/form` (Client): `ActionForm`, `SubmitButton`, `ActionButton`, `Field`,
`Input`, `Select`, `Textarea`, `MoneyInput`.
Gemeinsame Panels: `NotesPanel` (`@/components/notes`), `HistoryPanel` (`@/components/history`)
— auf jeder Detailseite einbinden (`entityType` z.B. `"PURCHASE_ORDER"`, `"CUSTOMER_ORDER"`, `"PRODUCT"`, `"CUSTOMER"`, `"SUPPLIER"`, `"INVOICE"`).

- Filter in Listen: einfaches `<form method="get">` mit Selects/Inputs (siehe `products/page.tsx`).
- Status-Anzeige: `<StatusBadge status={...} />`; Labels über `label()` aus `@/lib/constants`.
- Datum: `formatDate`/`formatDateTime` aus `@/lib/format`; Zahlen: `formatNumber`.
- Alle Detailseiten verlinken verwandte Datensätze (Deep-Linking): Produkt ↔ Bestellung ↔ Rechnung ↔ Kunde ↔ Lieferant.
- Sprache der UI: **Deutsch**. Listen kompakt, Detailseiten vollständig.

## Referenz-Implementierungen (Muster kopieren!)

- Liste: `src/app/(app)/products/page.tsx`
- Detail: `src/app/(app)/products/[id]/page.tsx`
- Formular (Client): `src/app/(app)/products/product-form.tsx`
- Client-Panels mit Actions: `src/app/(app)/products/[id]/panels.tsx`
- Actions: `src/server/actions/products.ts`
- Dashboard: `src/app/(app)/page.tsx`

## Services (vorhanden – NICHT neu erfinden)

- `@/server/services/inventory`: `getStock`, `getStockMap`, `getCurrentAvgCost`, `postInbound`, `postOutbound`, `allocate`, `releaseAllocation`, `getInboundInTransitMap`
- `@/server/services/purchasing`: `getPoLineStats`, `recomputePoStatus`, `createInboundShipment`, `postGoodsReceipt`, `computeOverheadPerUnit`, `recomputeLandedCosts`
- `@/server/services/sales`: `getCoLineStats`, `recomputeCoStatus`, `createCustomerShipment`, `markShipmentShipped`, `markShipmentDelivered`
- `@/server/services/finance`: `createInvoice`, `recordPayment`, `addCost`, `recomputeInvoiceStatus`
- `@/server/services/stats`: `getPurchasePriceStats`, `getSalesStats`, `getProductOverview`, `getCustomerStats`, `getSupplierStats`, `getInventoryValue`
- `@/server/services/dashboard`, `warnings`, `search`, `matching`, `importing`
- `@/server/carriers`: `refreshTracking`, `getCarrierAdapter`
- `@/server/numbering`: `nextNumber("PO" | "SO" | "WE" | "WES" | "VS" | "RE" | "PRD" | "SUP" | "KND", tx?)`

## Datenmodell

Vollständig in `prisma/schema.prisma`. Status-Konstanten + deutsche Labels in `src/lib/constants.ts`.
SQLite: keine Enums (Strings), kein Decimal (Integer-Cents), JSON als String (`JSON.parse/stringify`).

## Wichtige Geschäftsregeln

1. Bestand = Summe `InventoryTransaction.qty`; NIE direkt ein Bestandsfeld schreiben.
2. Reservierungen binden Bestand, ändern ihn nicht. Verfügbar = Bestand − aktive Reservierungen.
3. Versand an Kunden nur in Höhe aktiver Reservierungen; verbraucht Chargen per FIFO (macht `createCustomerShipment`).
4. `versendet ≤ bestellt` und `angekommen ≤ bestellt` je PO-Zeile (harte Validierung in Services).
5. Gewichteter Durchschnitt = Gesamtkosten ÷ Gesamtmenge (`weightedAverageCents`) – nie einfacher Mittelwert.
6. Marge = Gewinn ÷ VK, Aufschlag = Gewinn ÷ EK (`margin`/`markup` aus `@/lib/money`).
7. Soft-Delete: Stornieren/Archivieren statt Löschen; alles Wichtige ins Audit-Log.
8. Manuelle Status-Overrides: erlaubt, aber mit `statusOverridden`-Flag + Begründung (Warnung im Dashboard).
