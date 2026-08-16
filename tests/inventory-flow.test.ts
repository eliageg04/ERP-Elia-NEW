/**
 * Integrationstests des kompletten Warenflusses gegen eine echte
 * SQLite-Testdatenbank: Einkauf → Sendung → (Teil-)Wareneingang →
 * Bestand/Chargen → Reservierung → Kundenversand (FIFO/COGS) →
 * Statusableitung, Kostenverteilung, Duplikate, Integritätsregeln.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  createInboundShipment,
  postGoodsReceipt,
  getPoLineStats,
  derivePoStatus,
} from "@/server/services/purchasing";
import { allocate, getStock, postOutbound, releaseAllocation } from "@/server/services/inventory";
import { createCustomerShipment } from "@/server/services/sales";
import { createInvoice, addCost } from "@/server/services/finance";
import { AppError } from "@/server/errors";

async function wipe() {
  const tables = [
    "lotConsumption", "trackingEvent", "customerShipmentItem", "customerShipment",
    "allocation", "customerOrderLine", "customerOrder",
    "purchaseLot", "inventoryTransaction", "goodsReceiptItem", "goodsReceipt",
    "inboundShipmentItem", "inboundShipment",
    "payment", "invoiceLine", "invoice", "cost",
    "purchaseOrderLine", "purchaseOrder",
    "importItem", "importBatch",
    "supplierProductMapping", "unitConversion", "product",
    "note", "auditLog", "activityEvent",
    "customer", "supplier", "session", "user", "unit", "counter", "setting",
    "integrationConfig", "exchangeRate",
  ] as const;
  for (const t of tables) {
    // @ts-expect-error dynamischer Model-Zugriff
    await db[t].deleteMany({});
  }
}

type Fixtures = Awaited<ReturnType<typeof fixtures>>;

async function fixtures() {
  const unit = await db.unit.create({ data: { code: "DISPLAY", name: "Display" } });
  const caseUnit = await db.unit.create({ data: { code: "CASE", name: "Case" } });
  const supplier = await db.supplier.create({ data: { code: "SUP-0001", name: "Test-Großhändler" } });
  const customer = await db.customer.create({ data: { code: "KND-0001", name: "Test-Kunde" } });
  const product = await db.product.create({
    data: { sku: "PRD-0001", name: "Testprodukt Display", baseUnitId: unit.id, listPriceCents: 12000 },
  });
  await db.unitConversion.create({ data: { productId: product.id, unitId: caseUnit.id, factor: 6 } });
  return { unit, caseUnit, supplier, customer, product };
}

async function createPo(
  f: Fixtures,
  opts: { qty: number; priceCents: number; fxRate?: number; currency?: string; unitFactor?: number; enteredUnitId?: string }
) {
  const factor = opts.unitFactor ?? 1;
  const po = await db.purchaseOrder.create({
    data: {
      orderNumber: `PO-T${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      supplierId: f.supplier.id,
      status: "ORDERED",
      orderedAt: new Date(),
      currency: opts.currency ?? "EUR",
      fxRate: opts.fxRate ?? 1.0,
    },
  });
  const line = await db.purchaseOrderLine.create({
    data: {
      purchaseOrderId: po.id,
      productId: f.product.id,
      enteredQty: opts.qty,
      enteredUnitId: opts.enteredUnitId ?? f.unit.id,
      unitFactor: factor,
      qtyOrdered: opts.qty * factor,
      unitPriceCents: opts.priceCents,
      lineTotalCents: opts.qty * opts.priceCents,
    },
  });
  return { po, line };
}

async function createCo(f: Fixtures, qty: number, priceCents: number) {
  const co = await db.customerOrder.create({
    data: {
      orderNumber: `SO-T${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      customerId: f.customer.id,
      status: "CONFIRMED",
    },
  });
  const line = await db.customerOrderLine.create({
    data: {
      customerOrderId: co.id,
      productId: f.product.id,
      qty,
      unitPriceCents: priceCents,
      lineTotalCents: qty * priceCents,
    },
  });
  return { co, line };
}

beforeEach(async () => {
  await wipe();
});

describe("Wareneingang & Bestand", () => {
  it("Teillieferung: 100 bestellt, 100 versendet, 60 + 40 angekommen", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 100, priceCents: 9000 });

    await createInboundShipment({
      purchaseOrderId: po.id,
      items: [{ poLineId: line.id, qty: 100 }],
      trackingNumber: "1Z-TEST",
    });

    // Teileingang 1: 60 Stück
    await postGoodsReceipt({
      purchaseOrderId: po.id,
      items: [{ poLineId: line.id, qtyReceived: 60 }],
    });
    let stock = await getStock(f.product.id);
    expect(stock.onHand).toBe(60);
    let stats = (await getPoLineStats(po.id))[0];
    expect(stats.shipped).toBe(100);
    expect(stats.arrived).toBe(60);
    expect(stats.open).toBe(40);
    expect(stats.inTransit).toBe(40);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTIALLY_RECEIVED");

    // Teileingang 2: restliche 40
    await postGoodsReceipt({
      purchaseOrderId: po.id,
      items: [{ poLineId: line.id, qtyReceived: 40 }],
    });
    stock = await getStock(f.product.id);
    expect(stock.onHand).toBe(100);
    stats = (await getPoLineStats(po.id))[0];
    expect(stats.arrived).toBe(100);
    expect(stats.open).toBe(0);
    expect((await db.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
  });

  it("verweigert Überbuchung: mehr angekommen als bestellt", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 20, priceCents: 9000 });
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 15 }] });
    await expect(
      postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 6 }] })
    ).rejects.toThrow(AppError);
  });

  it("verweigert Versandmeldung über der Bestellmenge", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 100, priceCents: 9000 });
    await expect(
      createInboundShipment({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qty: 120 }] })
    ).rejects.toThrow(AppError);
  });

  it("beschädigte Ware zählt als angekommen, aber nicht als Bestand", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 50, priceCents: 9000 });
    await postGoodsReceipt({
      purchaseOrderId: po.id,
      items: [{ poLineId: line.id, qtyReceived: 45, qtyDamaged: 3, qtyMissing: 2 }],
    });
    const stock = await getStock(f.product.id);
    expect(stock.onHand).toBe(45); // nur unbeschädigte Ware
    const stats = (await getPoLineStats(po.id))[0];
    expect(stats.arrived).toBe(48); // 45 + 3 beschädigt
    expect(stats.missing).toBe(2);
  });

  it("Einheiten-Umrechnung: 2 Cases (Faktor 6) = 12 Basiseinheiten", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, {
      qty: 2, priceCents: 60000, unitFactor: 6, enteredUnitId: f.caseUnit.id,
    });
    expect(line.qtyOrdered).toBe(12);
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 12 }] });
    const stock = await getStock(f.product.id);
    expect(stock.onHand).toBe(12);
    // EK pro Basiseinheit: 2 × 600 € / 12 = 100 €
    const lot = await db.purchaseLot.findFirstOrThrow({ where: { productId: f.product.id } });
    expect(lot.unitCostEurCents).toBe(10000);
  });

  it("Fremdwährung: USD-Preis wird mit eingefrorenem Kurs in EUR umgerechnet", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 10, priceCents: 10000, currency: "USD", fxRate: 0.92 });
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 10 }] });
    const lot = await db.purchaseLot.findFirstOrThrow({ where: { productId: f.product.id } });
    expect(lot.unitCostEurCents).toBe(9200); // 100 USD × 0,92
  });
});

describe("Reservierung", () => {
  it("Reservierung bindet Bestand: 100 vorhanden, 30 reserviert → 70 frei", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 100, priceCents: 9000 });
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 100 }] });
    const { line: coLine } = await createCo(f, 30, 12000);

    await db.$transaction(async (tx) => {
      await allocate(tx, { productId: f.product.id, orderLineId: coLine.id, qty: 30 });
    });
    const stock = await getStock(f.product.id);
    expect(stock).toEqual({ onHand: 100, reserved: 30, available: 70 });
  });

  it("verweigert Reservierung über den verfügbaren Bestand", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 10, priceCents: 9000 });
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 10 }] });
    const { line: coLine } = await createCo(f, 20, 12000);
    await expect(
      db.$transaction(async (tx) => {
        await allocate(tx, { productId: f.product.id, orderLineId: coLine.id, qty: 15 });
      })
    ).rejects.toThrow(/frei verfügbar/);
  });

  it("Freigabe einer Reservierung stellt Verfügbarkeit wieder her", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 50, priceCents: 9000 });
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 50 }] });
    const { line: coLine } = await createCo(f, 20, 12000);
    const alloc = await db.$transaction((tx) =>
      allocate(tx, { productId: f.product.id, orderLineId: coLine.id, qty: 20 })
    );
    await db.$transaction((tx) => releaseAllocation(tx, { allocationId: alloc.id }));
    const stock = await getStock(f.product.id);
    expect(stock).toEqual({ onHand: 50, reserved: 0, available: 50 });
  });
});

describe("Kundenversand, FIFO & Marge", () => {
  it("kompletter Fluss: FIFO-COGS über zwei Chargen mit unterschiedlichen Preisen", async () => {
    const f = await fixtures();
    // Charge 1: 10 Stück à 90 € — Charge 2: 10 Stück à 100 €
    const first = await createPo(f, { qty: 10, priceCents: 9000 });
    await postGoodsReceipt({ purchaseOrderId: first.po.id, items: [{ poLineId: first.line.id, qtyReceived: 10 }] });
    const second = await createPo(f, { qty: 10, priceCents: 10000 });
    await postGoodsReceipt({ purchaseOrderId: second.po.id, items: [{ poLineId: second.line.id, qtyReceived: 10 }] });

    // 15 Stück verkaufen à 120 €
    const { co, line: coLine } = await createCo(f, 15, 12000);
    await db.$transaction((tx) => allocate(tx, { productId: f.product.id, orderLineId: coLine.id, qty: 15 }));
    await createCustomerShipment({
      customerOrderId: co.id,
      items: [{ orderLineId: coLine.id, qty: 15 }],
      markShipped: true,
    });

    // FIFO: 10 × 90 € + 5 × 100 € = 1.400 €
    const shipItem = await db.customerShipmentItem.findFirstOrThrow({ where: { orderLineId: coLine.id } });
    expect(shipItem.cogsEurCents).toBe(10 * 9000 + 5 * 10000);

    // Bestand: 20 − 15 = 5; Charge 1 leer, Charge 2 hat 5 übrig
    const stock = await getStock(f.product.id);
    expect(stock).toEqual({ onHand: 5, reserved: 0, available: 5 });
    const lots = await db.purchaseLot.findMany({ where: { productId: f.product.id }, orderBy: { receivedAt: "asc" } });
    expect(lots[0].qtyRemaining).toBe(0);
    expect(lots[1].qtyRemaining).toBe(5);

    // Nachvollziehbarkeit: LotConsumption dokumentiert die Herkunft
    const consumptions = await db.lotConsumption.findMany({ where: { customerShipmentItemId: shipItem.id } });
    expect(consumptions).toHaveLength(2);

    // Marge: Umsatz 1.800 €, COGS 1.400 € → Gewinn 400 €
    const revenue = 15 * 12000;
    expect(revenue - shipItem.cogsEurCents).toBe(40000);
  });

  it("verweigert Versand ohne ausreichende Reservierung", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 20, priceCents: 9000 });
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 20 }] });
    const { co, line: coLine } = await createCo(f, 10, 12000);
    await db.$transaction((tx) => allocate(tx, { productId: f.product.id, orderLineId: coLine.id, qty: 5 }));
    await expect(
      createCustomerShipment({
        customerOrderId: co.id,
        items: [{ orderLineId: coLine.id, qty: 10 }],
        markShipped: true,
      })
    ).rejects.toThrow(/reserviert/);
  });

  it("verhindert negativen Bestand bei Abgängen", async () => {
    const f = await fixtures();
    await expect(
      db.$transaction((tx) =>
        postOutbound(tx, { productId: f.product.id, qty: 5, type: "CORRECTION", note: "Test" })
      )
    ).rejects.toThrow(/Nicht genug Bestand/);
  });
});

describe("Kostenverteilung (Landed Costs)", () => {
  it("verteilt Nebenkosten nach Warenwert auf die Chargen", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 100, priceCents: 10000 }); // 10.000 € Ware
    // 500 € Versand + 300 € Zoll VOR dem Eingang erfassen
    await addCost({ type: "SHIPPING", amountCents: 50000, purchaseOrderId: po.id });
    await addCost({ type: "CUSTOMS", amountCents: 30000, purchaseOrderId: po.id });
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 100 }] });

    const lot = await db.purchaseLot.findFirstOrThrow({ where: { productId: f.product.id } });
    expect(lot.unitCostEurCents).toBe(10000); // reiner Warenpreis
    expect(lot.landedUnitCostEurCents).toBe(10000 + 800); // + 800 €/100 Stück = 8 €/Stück
  });

  it("nachträgliche Kosten aktualisieren die Landed Costs der Chargen", async () => {
    const f = await fixtures();
    const { po, line } = await createPo(f, { qty: 50, priceCents: 10000 });
    await postGoodsReceipt({ purchaseOrderId: po.id, items: [{ poLineId: line.id, qtyReceived: 50 }] });
    let lot = await db.purchaseLot.findFirstOrThrow({ where: { productId: f.product.id } });
    expect(lot.landedUnitCostEurCents).toBe(10000);

    await addCost({ type: "SHIPPING", amountCents: 25000, purchaseOrderId: po.id }); // 250 € / 50 = 5 €
    lot = await db.purchaseLot.findFirstOrThrow({ where: { productId: f.product.id } });
    expect(lot.landedUnitCostEurCents).toBe(10500);
  });
});

describe("Status & Duplikate", () => {
  it("leitet PO-Status korrekt aus Mengen ab", () => {
    expect(derivePoStatus("ORDERED", { ordered: 100, shipped: 0, arrived: 0 })).toBe("ORDERED");
    expect(derivePoStatus("ORDERED", { ordered: 100, shipped: 40, arrived: 0 })).toBe("PARTIALLY_SHIPPED");
    expect(derivePoStatus("ORDERED", { ordered: 100, shipped: 100, arrived: 0 })).toBe("SHIPPED");
    expect(derivePoStatus("ORDERED", { ordered: 100, shipped: 100, arrived: 60 })).toBe("PARTIALLY_RECEIVED");
    expect(derivePoStatus("ORDERED", { ordered: 100, shipped: 100, arrived: 100 })).toBe("RECEIVED");
    expect(derivePoStatus("CANCELLED", { ordered: 100, shipped: 100, arrived: 100 })).toBe("CANCELLED");
  });

  it("erkennt doppelte Lieferantenrechnungen", async () => {
    const f = await fixtures();
    await createInvoice({
      type: "SUPPLIER", supplierId: f.supplier.id, externalNumber: "INV-123", totalCents: 100000,
    });
    await expect(
      createInvoice({
        type: "SUPPLIER", supplierId: f.supplier.id, externalNumber: "INV-123", totalCents: 100000,
      })
    ).rejects.toThrow(/existiert bereits/);
  });
});
