/**
 * Seed-Skript: realistische Testdaten für das gesamte ERP.
 * Nutzt die echten Domain-Services, damit alle Invarianten gelten
 * (Ledger, FIFO-Chargen, Reservierungen, Statusableitung).
 *
 * Ausführen: npm run db:seed  (löscht vorhandene Daten!)
 * Login danach: admin@elia-erp.de / admin1234
 */
import bcrypt from "bcryptjs";
import { db } from "../src/server/db";
import { nextNumber } from "../src/server/numbering";
import { createInboundShipment, postGoodsReceipt } from "../src/server/services/purchasing";
import { allocate } from "../src/server/services/inventory";
import { createCustomerShipment, markShipmentDelivered, recomputeCoStatus } from "../src/server/services/sales";
import { createInvoice, recordPayment, addCost } from "../src/server/services/finance";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

async function reset() {
  // Reihenfolge wegen FK-Restriktionen
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
    "customer", "supplier", "session", "user", "unit",
    "counter", "setting", "integrationConfig", "exchangeRate",
  ] as const;
  for (const t of tables) {
    // @ts-expect-error dynamischer Zugriff auf Model-Delegates
    await db[t].deleteMany({});
  }
}

async function main() {
  console.log("Setze Datenbank zurück…");
  await reset();

  // ---------- Benutzer ----------
  console.log("Benutzer…");
  const [admin] = await Promise.all([
    db.user.create({
      data: {
        email: "admin@elia-erp.de",
        name: "Elia (Admin)",
        passwordHash: await bcrypt.hash("admin1234", 10),
        role: "ADMIN",
      },
    }),
    db.user.create({
      data: {
        email: "mitarbeiter@elia-erp.de",
        name: "Max Mitarbeiter",
        passwordHash: await bcrypt.hash("staff1234", 10),
        role: "STAFF",
      },
    }),
    db.user.create({
      data: {
        email: "leser@elia-erp.de",
        name: "Lena Leser",
        passwordHash: await bcrypt.hash("read1234", 10),
        role: "READONLY",
      },
    }),
  ]);

  // ---------- Einheiten ----------
  console.log("Einheiten…");
  const [piece, box, display, casE] = await Promise.all([
    db.unit.create({ data: { code: "PIECE", name: "Stück", isSystem: true, sortOrder: 0 } }),
    db.unit.create({ data: { code: "BOX", name: "Box", isSystem: true, sortOrder: 1 } }),
    db.unit.create({ data: { code: "DISPLAY", name: "Display", isSystem: true, sortOrder: 2 } }),
    db.unit.create({ data: { code: "CASE", name: "Case", isSystem: true, sortOrder: 3 } }),
  ]);
  await Promise.all([
    db.unit.create({ data: { code: "BUNDLE", name: "Bundle", isSystem: true, sortOrder: 4 } }),
    db.unit.create({ data: { code: "PACK", name: "Pack", isSystem: true, sortOrder: 5 } }),
    db.unit.create({ data: { code: "CARTON", name: "Karton", isSystem: true, sortOrder: 6 } }),
  ]);

  // ---------- Einstellungen & Integrationen ----------
  await db.setting.createMany({
    data: [
      { key: "companyName", value: JSON.stringify("Elia Trading") },
      { key: "defaultCurrency", value: JSON.stringify("EUR") },
      { key: "targetMarginPct", value: JSON.stringify(25) },
    ],
  });
  await db.integrationConfig.create({
    data: { provider: "UPS", enabled: true, mode: "MOCK" },
  });
  await db.exchangeRate.createMany({
    data: [
      { currency: "USD", rate: 0.92, validOn: daysAgo(30) },
      { currency: "GBP", rate: 1.17, validOn: daysAgo(30) },
    ],
  });

  // ---------- Großhändler ----------
  console.log("Großhändler…");
  const supplierData = [
    { name: "ABC Trading GmbH", city: "Hamburg", currency: "EUR", terms: "Vorkasse" },
    { name: "CardWorld Distribution", city: "Berlin", currency: "EUR", terms: "30 Tage netto" },
    { name: "TCG Grosshandel Nord", city: "Bremen", currency: "EUR", terms: "Vorkasse" },
    { name: "PlayMore Wholesale B.V.", city: "Amsterdam", currency: "EUR", terms: "14 Tage netto" },
    { name: "US Cards Direct LLC", city: "Miami", currency: "USD", terms: "Vorkasse" },
    { name: "Collectors Supply UK Ltd", city: "London", currency: "GBP", terms: "Vorkasse" },
    { name: "GameStore Süd GmbH", city: "München", currency: "EUR", terms: "Sofort" },
    { name: "Anime & Cards Import", city: "Düsseldorf", currency: "EUR", terms: "Vorkasse" },
  ];
  const suppliers = [];
  for (const s of supplierData) {
    suppliers.push(
      await db.supplier.create({
        data: {
          code: await nextNumber("SUP"),
          name: s.name,
          city: s.city,
          country: s.city === "Miami" ? "US" : s.city === "London" ? "GB" : s.city === "Amsterdam" ? "NL" : "DE",
          currency: s.currency,
          paymentTerms: s.terms,
          email: `bestellung@${s.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 12)}.example`,
          customerNumber: `K-${1000 + suppliers.length * 37}`,
        },
      })
    );
  }

  // ---------- Kunden ----------
  console.log("Kunden…");
  const customerNames = [
    ["Max Mustermann", null], ["Laura Schmidt", "CardCorner Shop"], ["Jonas Weber", null],
    ["Sarah Fischer", "Fischer Collectibles"], ["Tim Becker", null], ["Nina Hoffmann", "NH Trading"],
    ["Kevin Wagner", null], ["Julia Koch", "Koch & Söhne"], ["David Richter", null],
    ["Anna Klein", "Klein Kartenladen"], ["Felix Wolf", null], ["Marie Neumann", null],
    ["Lukas Schwarz", "Schwarz TCG"], ["Sophie Zimmermann", null], ["Paul Braun", "Braun Games GmbH"],
  ] as const;
  const customers = [];
  for (const [name, company] of customerNames) {
    customers.push(
      await db.customer.create({
        data: {
          code: await nextNumber("KND"),
          name,
          company,
          email: `${name.toLowerCase().replace(" ", ".")}@example.com`,
          billingStreet: "Musterstraße 12",
          billingZip: "50667",
          billingCity: "Köln",
          shippingStreet: "Musterstraße 12",
          shippingZip: "50667",
          shippingCity: "Köln",
        },
      })
    );
  }

  // ---------- Produkte ----------
  console.log("Produkte…");
  type ProdSpec = {
    name: string; type: string; set: string; lang: string; base: string;
    listCents: number; ean?: string; caseFactor?: number;
  };
  const productSpecs: ProdSpec[] = [
    { name: "Pokémon Scarlet & Violet 151 Booster Display", type: "Booster Display", set: "Scarlet & Violet 151", lang: "EN", base: "DISPLAY", listCents: 18900, ean: "0820650854187", caseFactor: 6 },
    { name: "Pokémon Karmesin & Purpur 151 Booster Display", type: "Booster Display", set: "Karmesin & Purpur 151", lang: "DE", base: "DISPLAY", listCents: 15900, ean: "0820650454187", caseFactor: 6 },
    { name: "Pokémon Mega Evolution Booster Display", type: "Booster Display", set: "Mega Evolution", lang: "EN", base: "DISPLAY", listCents: 14900, caseFactor: 6 },
    { name: "Pokémon Surging Sparks Booster Display", type: "Booster Display", set: "Surging Sparks", lang: "EN", base: "DISPLAY", listCents: 13900, caseFactor: 6 },
    { name: "Pokémon Prismatic Evolutions Booster Bundle", type: "Booster Bundle", set: "Prismatic Evolutions", lang: "EN", base: "BOX", listCents: 4900, caseFactor: 10 },
    { name: "Pokémon Prismatic Evolutions Elite Trainer Box", type: "Elite Trainer Box", set: "Prismatic Evolutions", lang: "EN", base: "BOX", listCents: 8900, caseFactor: 10 },
    { name: "Pokémon Stellar Crown Booster Display", type: "Booster Display", set: "Stellar Crown", lang: "EN", base: "DISPLAY", listCents: 11900, caseFactor: 6 },
    { name: "Pokémon Twilight Masquerade Booster Display", type: "Booster Display", set: "Twilight Masquerade", lang: "EN", base: "DISPLAY", listCents: 12900, caseFactor: 6 },
    { name: "Pokémon Temporal Forces Booster Display", type: "Booster Display", set: "Temporal Forces", lang: "EN", base: "DISPLAY", listCents: 11500, caseFactor: 6 },
    { name: "Pokémon Paldean Fates Elite Trainer Box", type: "Elite Trainer Box", set: "Paldean Fates", lang: "EN", base: "BOX", listCents: 7900, caseFactor: 10 },
    { name: "Pokémon Obsidian Flames Booster Display", type: "Booster Display", set: "Obsidian Flames", lang: "EN", base: "DISPLAY", listCents: 10900, caseFactor: 6 },
    { name: "Pokémon Paradox Rift Booster Display", type: "Booster Display", set: "Paradox Rift", lang: "EN", base: "DISPLAY", listCents: 10500, caseFactor: 6 },
    { name: "Pokémon Glurak ex Premium-Kollektion", type: "Collection Box", set: "Glurak ex", lang: "DE", base: "BOX", listCents: 6900, caseFactor: 12 },
    { name: "Pokémon 151 Ultra Premium Collection", type: "Collection Box", set: "Scarlet & Violet 151", lang: "EN", base: "BOX", listCents: 14900, caseFactor: 4 },
    { name: "Pokémon Terastal Festival ex Booster Display JP", type: "Booster Display", set: "Terastal Festival", lang: "JP", base: "DISPLAY", listCents: 8900, caseFactor: 12 },
    { name: "Pokémon Shiny Treasure ex Booster Display JP", type: "Booster Display", set: "Shiny Treasure ex", lang: "JP", base: "DISPLAY", listCents: 7900, caseFactor: 12 },
    { name: "One Piece OP-09 Booster Display", type: "Booster Display", set: "OP-09 Emperors in the New World", lang: "EN", base: "DISPLAY", listCents: 9900, caseFactor: 12 },
    { name: "One Piece OP-10 Booster Display", type: "Booster Display", set: "OP-10 Royal Blood", lang: "EN", base: "DISPLAY", listCents: 8900, caseFactor: 12 },
    { name: "Disney Lorcana Fabled Booster Display", type: "Booster Display", set: "Fabled", lang: "EN", base: "DISPLAY", listCents: 13900, caseFactor: 4 },
    { name: "Yu-Gi-Oh! Quarter Century Bonanza Display", type: "Booster Display", set: "Quarter Century Bonanza", lang: "DE", base: "DISPLAY", listCents: 7500, caseFactor: 12 },
    { name: "Ultra Pro Toploader 3x4 (25er Pack)", type: "Zubehör", set: "Zubehör", lang: "EN", base: "PACK", listCents: 450, caseFactor: 40 },
    { name: "Pokémon Heartgold Tin Mew", type: "Tin", set: "Klassik", lang: "EN", base: "BOX", listCents: 3900, caseFactor: 12 },
  ];
  const products = [];
  const unitByCode = new Map([["PIECE", piece], ["BOX", box], ["DISPLAY", display], ["CASE", casE]]);
  const packUnit = await db.unit.findUniqueOrThrow({ where: { code: "PACK" } });
  unitByCode.set("PACK", packUnit);
  for (const spec of productSpecs) {
    const baseUnit = unitByCode.get(spec.base) ?? piece;
    const product = await db.product.create({
      data: {
        sku: await nextNumber("PRD"),
        name: spec.name,
        productType: spec.type,
        setName: spec.set,
        language: spec.lang,
        ean: spec.ean ?? null,
        manufacturer: spec.name.startsWith("Pokémon")
          ? "The Pokémon Company"
          : spec.name.startsWith("One Piece")
            ? "Bandai"
            : spec.name.startsWith("Disney")
              ? "Ravensburger"
              : spec.name.startsWith("Yu-Gi-Oh")
                ? "Konami"
                : "Ultra Pro",
        baseUnitId: baseUnit.id,
        listPriceCents: spec.listCents,
      },
    });
    if (spec.caseFactor) {
      await db.unitConversion.create({
        data: { productId: product.id, unitId: casE.id, factor: spec.caseFactor },
      });
    }
    products.push(product);
  }
  const P = (i: number) => products[i];

  // Lieferanten-Mappings (gelernte Bezeichnungen)
  await db.supplierProductMapping.createMany({
    data: [
      { supplierId: suppliers[0].id, productId: P(0).id, supplierName: "PKM SV3.5 151 DISP EN", supplierSku: "ABC-4711", unitFactor: 6, defaultUnitId: casE.id, lastPriceCents: 14500 },
      { supplierId: suppliers[0].id, productId: P(2).id, supplierName: "PKM MEGA EVO DISPLAY EN", supplierSku: "ABC-4890", lastPriceCents: 11000 },
      { supplierId: suppliers[1].id, productId: P(0).id, supplierName: "SV 151 Booster Display englisch", supplierSku: "CW-151-EN", lastPriceCents: 14900 },
      { supplierId: suppliers[4].id, productId: P(3).id, supplierName: "Surging Sparks BB EN (36ct)", supplierSku: "USC-SSP", lastPriceCents: 11900 },
    ],
  });

  // ---------- Hilfsfunktion: PO anlegen ----------
  async function createPo(params: {
    supplierIdx: number;
    status: string;
    orderedDaysAgo: number;
    expectedInDays?: number;
    currency?: string;
    fxRate?: number;
    supplierOrderNumber?: string;
    lines: Array<{ prodIdx: number; qty: number; unit?: "CASE" | "BASE"; priceCents: number }>;
  }) {
    const orderNumber = await nextNumber("PO");
    const po = await db.purchaseOrder.create({
      data: {
        orderNumber,
        supplierId: suppliers[params.supplierIdx].id,
        supplierOrderNumber: params.supplierOrderNumber ?? null,
        status: params.status,
        orderedAt: params.status === "DRAFT" ? null : daysAgo(params.orderedDaysAgo),
        expectedAt: params.expectedInDays !== undefined ? inDays(params.expectedInDays) : null,
        currency: params.currency ?? "EUR",
        fxRate: params.fxRate ?? 1.0,
        createdAt: daysAgo(params.orderedDaysAgo + 1),
      },
    });
    let position = 0;
    for (const line of params.lines) {
      const product = P(line.prodIdx);
      const conversion = await db.unitConversion.findFirst({
        where: { productId: product.id, unitId: casE.id },
      });
      const useCase = line.unit === "CASE" && conversion;
      const unitFactor = useCase ? conversion.factor : 1;
      const enteredUnitId = useCase ? casE.id : product.baseUnitId;
      const lineTotal = line.qty * line.priceCents;
      await db.purchaseOrderLine.create({
        data: {
          purchaseOrderId: po.id,
          productId: product.id,
          position: position++,
          enteredQty: line.qty,
          enteredUnitId,
          unitFactor,
          qtyOrdered: line.qty * unitFactor,
          unitPriceCents: line.priceCents,
          lineTotalCents: lineTotal,
        },
      });
    }
    await db.activityEvent.create({
      data: {
        type: "PURCHASE_ORDER_CREATED",
        entityType: "PURCHASE_ORDER",
        entityId: po.id,
        summary: `Bestellung ${orderNumber} bei ${suppliers[params.supplierIdx].name} angelegt`,
        createdAt: daysAgo(params.orderedDaysAgo + 1),
      },
    });
    return po;
  }

  // ---------- Einkaufsbestellungen ----------
  console.log("Einkaufsbestellungen…");

  // 1) Vollständig angekommen + bezahlt (Basis für Lagerbestand)
  const po1 = await createPo({
    supplierIdx: 0, status: "ORDERED", orderedDaysAgo: 90, expectedInDays: -75,
    supplierOrderNumber: "ABC-2026-0142",
    lines: [
      { prodIdx: 0, qty: 10, unit: "CASE", priceCents: 87000 }, // 10 Cases = 60 Displays à 145 €
      { prodIdx: 10, qty: 24, priceCents: 8200 },
      { prodIdx: 11, qty: 24, priceCents: 7900 },
    ],
  });
  const ship1 = await createInboundShipment({
    purchaseOrderId: po1.id,
    items: (await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po1.id } })).map((l) => ({ poLineId: l.id, qty: l.qtyOrdered })),
    carrier: "UPS", trackingNumber: "1Z999AA10123456784", packageCount: 8,
    shippedAt: daysAgo(84), estimatedArrival: daysAgo(78),
  });
  await addCost({ type: "SHIPPING", description: "UPS Fracht", amountCents: 24000, purchaseOrderId: po1.id, incurredAt: daysAgo(84) });
  await postGoodsReceipt({
    purchaseOrderId: po1.id, shipmentId: ship1.id, receivedAt: daysAgo(78), packageCount: 8,
    items: (await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po1.id } })).map((l) => ({ poLineId: l.id, qtyReceived: l.qtyOrdered })),
    userId: admin.id,
  });
  const inv1 = await createInvoice({
    type: "SUPPLIER", supplierId: suppliers[0].id, purchaseOrderId: po1.id,
    externalNumber: "RE-2026-08834", issuedAt: daysAgo(88), dueAt: daysAgo(74),
    totalCents: 1257800, netCents: 1057000, taxCents: 200800,
  });
  await recordPayment({ invoiceId: inv1.id, direction: "OUTGOING", amountCents: 1257800, paidAt: daysAgo(86), method: "Überweisung", reference: "ABC-2026-0142" });

  // 2) Vollständig angekommen (DE-Ware)
  const po2 = await createPo({
    supplierIdx: 1, status: "ORDERED", orderedDaysAgo: 60, expectedInDays: -45,
    supplierOrderNumber: "CW-55821",
    lines: [
      { prodIdx: 1, qty: 5, unit: "CASE", priceCents: 72000 }, // 30 Displays à 120 €
      { prodIdx: 12, qty: 36, priceCents: 4900 },
      { prodIdx: 19, qty: 20, priceCents: 5400 },
    ],
  });
  const po2Lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po2.id } });
  const ship2 = await createInboundShipment({
    purchaseOrderId: po2.id,
    items: po2Lines.map((l) => ({ poLineId: l.id, qty: l.qtyOrdered })),
    carrier: "DHL", trackingNumber: "00340434123456789", packageCount: 5,
    shippedAt: daysAgo(52), estimatedArrival: daysAgo(48),
  });
  await postGoodsReceipt({
    purchaseOrderId: po2.id, shipmentId: ship2.id, receivedAt: daysAgo(47),
    items: po2Lines.map((l) => ({ poLineId: l.id, qtyReceived: l.qtyOrdered })),
    userId: admin.id,
  });
  const inv2 = await createInvoice({
    type: "SUPPLIER", supplierId: suppliers[1].id, purchaseOrderId: po2.id,
    externalNumber: "2026-11402", issuedAt: daysAgo(58), dueAt: daysAgo(28),
    totalCents: 774760, netCents: 651060, taxCents: 123700,
  });
  await recordPayment({ invoiceId: inv2.id, direction: "OUTGOING", amountCents: 774760, paidAt: daysAgo(30), method: "Überweisung" });

  // 3) USD-Bestellung, vollständig angekommen, mit Zoll
  const po3 = await createPo({
    supplierIdx: 4, status: "ORDERED", orderedDaysAgo: 45, expectedInDays: -25,
    currency: "USD", fxRate: 0.92, supplierOrderNumber: "USC-7711",
    lines: [
      { prodIdx: 3, qty: 40, priceCents: 12500 }, // 40 Displays à 125 USD
      { prodIdx: 13, qty: 12, priceCents: 11900 },
    ],
  });
  const po3Lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po3.id } });
  const ship3 = await createInboundShipment({
    purchaseOrderId: po3.id,
    items: po3Lines.map((l) => ({ poLineId: l.id, qty: l.qtyOrdered })),
    carrier: "FEDEX", trackingNumber: "771234567890", packageCount: 6,
    shippedAt: daysAgo(38), estimatedArrival: daysAgo(30),
  });
  await addCost({ type: "CUSTOMS", description: "Einfuhrumsatzsteuer + Zoll", amountCents: 98000, purchaseOrderId: po3.id, incurredAt: daysAgo(29) });
  await addCost({ type: "SHIPPING", description: "FedEx International", amountCents: 42000, purchaseOrderId: po3.id, incurredAt: daysAgo(38) });
  await postGoodsReceipt({
    purchaseOrderId: po3.id, shipmentId: ship3.id, receivedAt: daysAgo(28),
    items: po3Lines.map((l) => ({ poLineId: l.id, qtyReceived: l.qtyOrdered })),
    userId: admin.id,
  });
  const inv3 = await createInvoice({
    type: "SUPPLIER", supplierId: suppliers[4].id, purchaseOrderId: po3.id,
    externalNumber: "INV-2026-3319", issuedAt: daysAgo(44), dueAt: daysAgo(37),
    currency: "USD", fxRate: 0.92, totalCents: 642800,
  });
  await recordPayment({ invoiceId: inv3.id, direction: "OUTGOING", amountCents: 642800, currency: "USD", fxRate: 0.92, paidAt: daysAgo(40), method: "Überweisung" });

  // 4) Teilweise angekommen: 2 von 3 Paketen da, Fehlmenge + Beschädigung
  const po4 = await createPo({
    supplierIdx: 2, status: "ORDERED", orderedDaysAgo: 21, expectedInDays: -3,
    supplierOrderNumber: "TCG-90312",
    lines: [
      { prodIdx: 4, qty: 100, priceCents: 3600 }, // 100 Bundles à 36 €
      { prodIdx: 5, qty: 60, priceCents: 6500 },
      { prodIdx: 9, qty: 40, priceCents: 5900 },
    ],
  });
  const po4Lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po4.id }, orderBy: { position: "asc" } });
  const ship4 = await createInboundShipment({
    purchaseOrderId: po4.id,
    items: po4Lines.map((l) => ({ poLineId: l.id, qty: l.qtyOrdered })),
    carrier: "UPS", trackingNumber: "1Z999AA10198765432", packageCount: 3,
    shippedAt: daysAgo(12), estimatedArrival: daysAgo(5),
  });
  await postGoodsReceipt({
    purchaseOrderId: po4.id, shipmentId: ship4.id, receivedAt: daysAgo(4), packageCount: 2,
    items: [
      { poLineId: po4Lines[0].id, qtyReceived: 60 },
      { poLineId: po4Lines[1].id, qtyReceived: 38, qtyDamaged: 2, note: "2 ETBs mit eingedrückter Ecke" },
    ],
    userId: admin.id,
  });
  await db.note.create({
    data: {
      entityType: "PURCHASE_ORDER", entityId: po4.id,
      body: "2 von 3 Paketen angekommen. Paket 3 laut UPS noch unterwegs (Verzögerung im Hub Köln). 2 ETBs beschädigt – Ersatz bei TCG Nord angefragt.",
      authorId: admin.id, pinned: true,
    },
  });
  await db.trackingEvent.create({
    data: { inboundShipmentId: ship4.id, status: "DELAYED", description: "Verzögerung im Sortierzentrum", location: "Köln", occurredAt: daysAgo(5), source: "UPS" },
  });
  const inv4 = await createInvoice({
    type: "SUPPLIER", supplierId: suppliers[2].id, purchaseOrderId: po4.id,
    externalNumber: "R-26-4471", issuedAt: daysAgo(20), dueAt: inDays(10),
    totalCents: 1023400, netCents: 860000, taxCents: 163400,
  });
  await recordPayment({ invoiceId: inv4.id, direction: "OUTGOING", amountCents: 500000, paidAt: daysAgo(15), method: "Überweisung", note: "Anzahlung 50 %" });

  // 5) Versendet, unterwegs (nichts angekommen)
  const po5 = await createPo({
    supplierIdx: 3, status: "ORDERED", orderedDaysAgo: 10, expectedInDays: 4,
    supplierOrderNumber: "PM-2026-556",
    lines: [
      { prodIdx: 6, qty: 30, priceCents: 8900 },
      { prodIdx: 7, qty: 20, priceCents: 9500 },
    ],
  });
  const po5Lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po5.id } });
  await createInboundShipment({
    purchaseOrderId: po5.id,
    items: po5Lines.map((l) => ({ poLineId: l.id, qty: l.qtyOrdered })),
    carrier: "GLS", trackingNumber: "ZY12345678DE", packageCount: 4,
    shippedAt: daysAgo(3), estimatedArrival: inDays(4),
  });
  await createInvoice({
    type: "SUPPLIER", supplierId: suppliers[3].id, purchaseOrderId: po5.id,
    externalNumber: "PM-INV-8834", issuedAt: daysAgo(9), dueAt: inDays(5),
    totalCents: 546210, netCents: 459000, taxCents: 87210,
  });

  // 6) Bestellt, noch nichts versendet (JP-Ware)
  await createPo({
    supplierIdx: 7, status: "ORDERED", orderedDaysAgo: 18, expectedInDays: 14,
    supplierOrderNumber: "AC-1192",
    lines: [
      { prodIdx: 14, qty: 24, priceCents: 6900 },
      { prodIdx: 15, qty: 24, priceCents: 5900 },
    ],
  });

  // 7) Bestätigt, wartet auf Versand
  await createPo({
    supplierIdx: 5, status: "CONFIRMED", orderedDaysAgo: 7, expectedInDays: 10,
    currency: "GBP", fxRate: 1.17,
    lines: [{ prodIdx: 18, qty: 15, priceCents: 10500 }],
  });

  // 8) Überfällig: bestellt vor 30 Tagen, erwartet vor 8 Tagen, nichts passiert
  await createPo({
    supplierIdx: 6, status: "ORDERED", orderedDaysAgo: 30, expectedInDays: -8,
    supplierOrderNumber: "GS-2026-072",
    lines: [
      { prodIdx: 16, qty: 20, priceCents: 7500 },
      { prodIdx: 17, qty: 20, priceCents: 6900 },
    ],
  });

  // 9) Entwurf (Vorbestellung nächstes Set)
  await createPo({
    supplierIdx: 0, status: "DRAFT", orderedDaysAgo: 0,
    lines: [
      { prodIdx: 2, qty: 20, unit: "CASE", priceCents: 63000 },
      { prodIdx: 0, qty: 5, unit: "CASE", priceCents: 89400 },
    ],
  });

  // 10) Zweiter Einkauf von Produkt 0 bei anderem Lieferanten (Preisvergleich!)
  const po10 = await createPo({
    supplierIdx: 1, status: "ORDERED", orderedDaysAgo: 35, expectedInDays: -20,
    supplierOrderNumber: "CW-56102",
    lines: [{ prodIdx: 0, qty: 25, priceCents: 14900 }], // 25 Displays direkt à 149 €
  });
  const po10Lines = await db.purchaseOrderLine.findMany({ where: { purchaseOrderId: po10.id } });
  const ship10 = await createInboundShipment({
    purchaseOrderId: po10.id,
    items: po10Lines.map((l) => ({ poLineId: l.id, qty: l.qtyOrdered })),
    carrier: "DPD", trackingNumber: "01234567890123", packageCount: 2,
    shippedAt: daysAgo(28), estimatedArrival: daysAgo(24),
  });
  await postGoodsReceipt({
    purchaseOrderId: po10.id, shipmentId: ship10.id, receivedAt: daysAgo(23),
    items: po10Lines.map((l) => ({ poLineId: l.id, qtyReceived: l.qtyOrdered })),
    userId: admin.id,
  });
  const inv10 = await createInvoice({
    type: "SUPPLIER", supplierId: suppliers[1].id, purchaseOrderId: po10.id,
    externalNumber: "2026-11688", issuedAt: daysAgo(34), dueAt: daysAgo(4),
    totalCents: 443275, netCents: 372500, taxCents: 70775,
  });
  await recordPayment({ invoiceId: inv10.id, direction: "OUTGOING", amountCents: 443275, paidAt: daysAgo(20), method: "Überweisung" });

  // ---------- Kundenbestellungen ----------
  console.log("Kundenbestellungen…");

  async function createCo(params: {
    customerIdx: number;
    status: string;
    orderedDaysAgo: number;
    lines: Array<{ prodIdx: number; qty: number; priceCents: number }>;
  }) {
    const orderNumber = await nextNumber("SO");
    const co = await db.customerOrder.create({
      data: {
        orderNumber,
        customerId: customers[params.customerIdx].id,
        status: params.status,
        orderedAt: daysAgo(params.orderedDaysAgo),
        createdAt: daysAgo(params.orderedDaysAgo),
      },
    });
    let position = 0;
    for (const line of params.lines) {
      await db.customerOrderLine.create({
        data: {
          customerOrderId: co.id,
          productId: P(line.prodIdx).id,
          position: position++,
          qty: line.qty,
          unitPriceCents: line.priceCents,
          lineTotalCents: line.qty * line.priceCents,
        },
      });
    }
    await db.activityEvent.create({
      data: {
        type: "CUSTOMER_ORDER_CREATED", entityType: "CUSTOMER_ORDER", entityId: co.id,
        summary: `Bestellung ${orderNumber} von ${customers[params.customerIdx].name} angelegt`,
        createdAt: daysAgo(params.orderedDaysAgo),
      },
    });
    return co;
  }

  async function allocateAll(coId: string) {
    const lines = await db.customerOrderLine.findMany({ where: { customerOrderId: coId } });
    for (const line of lines) {
      await db.$transaction(async (tx) => {
        await allocate(tx, { productId: line.productId, orderLineId: line.id, qty: line.qty });
      });
    }
  }

  // A) Zugestellt + bezahlt (kompletter Zyklus)
  const coA = await createCo({
    customerIdx: 0, status: "CONFIRMED", orderedDaysAgo: 40,
    lines: [
      { prodIdx: 0, qty: 10, priceCents: 18900 },
      { prodIdx: 10, qty: 5, priceCents: 10900 },
    ],
  });
  await allocateAll(coA.id);
  const shipA = await createCustomerShipment({
    customerOrderId: coA.id,
    items: (await db.customerOrderLine.findMany({ where: { customerOrderId: coA.id } })).map((l) => ({ orderLineId: l.id, qty: l.qty })),
    carrier: "UPS", trackingNumber: "1Z999AA10111111111", shippedAt: daysAgo(35), markShipped: true,
  });
  await markShipmentDelivered({ shipmentId: shipA.id, deliveredAt: daysAgo(33) });
  const invA = await createInvoice({
    type: "CUSTOMER", customerId: customers[0].id, customerOrderId: coA.id,
    issuedAt: daysAgo(35), dueAt: daysAgo(21), totalCents: 243500, netCents: 204622, taxCents: 38878,
  });
  await recordPayment({ invoiceId: invA.id, direction: "INCOMING", amountCents: 243500, paidAt: daysAgo(30), method: "Überweisung" });

  // B) Zugestellt, Rechnung OFFEN (Warnung!)
  const coB = await createCo({
    customerIdx: 1, status: "CONFIRMED", orderedDaysAgo: 25,
    lines: [
      { prodIdx: 1, qty: 8, priceCents: 15900 },
      { prodIdx: 12, qty: 10, priceCents: 6900 },
    ],
  });
  await allocateAll(coB.id);
  const shipB = await createCustomerShipment({
    customerOrderId: coB.id,
    items: (await db.customerOrderLine.findMany({ where: { customerOrderId: coB.id } })).map((l) => ({ orderLineId: l.id, qty: l.qty })),
    carrier: "DHL", trackingNumber: "00340434111122223", shippedAt: daysAgo(20), markShipped: true,
  });
  await markShipmentDelivered({ shipmentId: shipB.id, deliveredAt: daysAgo(18) });
  await createInvoice({
    type: "CUSTOMER", customerId: customers[1].id, customerOrderId: coB.id,
    issuedAt: daysAgo(20), dueAt: daysAgo(6), totalCents: 196200, netCents: 164874, taxCents: 31326,
  });

  // C) Teilweise versendet (Teillieferung an Kunde)
  const coC = await createCo({
    customerIdx: 3, status: "CONFIRMED", orderedDaysAgo: 12,
    lines: [
      { prodIdx: 3, qty: 20, priceCents: 13900 },
      { prodIdx: 4, qty: 30, priceCents: 4900 },
    ],
  });
  await allocateAll(coC.id);
  const coCLines = await db.customerOrderLine.findMany({ where: { customerOrderId: coC.id }, orderBy: { position: "asc" } });
  await createCustomerShipment({
    customerOrderId: coC.id,
    items: [{ orderLineId: coCLines[0].id, qty: 20 }],
    carrier: "UPS", trackingNumber: "1Z999AA10122222222", shippedAt: daysAgo(8), markShipped: true,
  });

  // D) Vollständig reserviert, bereit zum Versand
  const coD = await createCo({
    customerIdx: 5, status: "CONFIRMED", orderedDaysAgo: 9,
    lines: [
      { prodIdx: 13, qty: 6, priceCents: 14900 },
      { prodIdx: 2, qty: 10, priceCents: 14900 },
    ],
  });
  // Produkt 2 hat noch keinen Bestand → nur Zeile 1 reservieren
  const coDLines = await db.customerOrderLine.findMany({ where: { customerOrderId: coD.id }, orderBy: { position: "asc" } });
  await db.$transaction(async (tx) => {
    await allocate(tx, { productId: coDLines[0].productId, orderLineId: coDLines[0].id, qty: 6 });
  });

  // E) Bestätigt, teilweise reservierbar (Produkt fehlt teilweise)
  const coE = await createCo({
    customerIdx: 7, status: "CONFIRMED", orderedDaysAgo: 5,
    lines: [
      { prodIdx: 0, qty: 30, priceCents: 17900 },
      { prodIdx: 5, qty: 20, priceCents: 8900 },
    ],
  });
  const coELines = await db.customerOrderLine.findMany({ where: { customerOrderId: coE.id }, orderBy: { position: "asc" } });
  await db.$transaction(async (tx) => {
    await allocate(tx, { productId: coELines[0].productId, orderLineId: coELines[0].id, qty: 20 });
  });

  // F) Entwurf
  await createCo({
    customerIdx: 9, status: "DRAFT", orderedDaysAgo: 1,
    lines: [{ prodIdx: 6, qty: 10, priceCents: 11900 }],
  });

  // G) Noch ein kompletter Zyklus für Margen-Daten
  const coG = await createCo({
    customerIdx: 14, status: "CONFIRMED", orderedDaysAgo: 15,
    lines: [
      { prodIdx: 11, qty: 12, priceCents: 10500 },
      { prodIdx: 19, qty: 10, priceCents: 7500 },
    ],
  });
  await allocateAll(coG.id);
  const shipG = await createCustomerShipment({
    customerOrderId: coG.id,
    items: (await db.customerOrderLine.findMany({ where: { customerOrderId: coG.id } })).map((l) => ({ orderLineId: l.id, qty: l.qty })),
    carrier: "DPD", trackingNumber: "09876543210987", shippedAt: daysAgo(11), markShipped: true,
  });
  await markShipmentDelivered({ shipmentId: shipG.id, deliveredAt: daysAgo(9) });
  const invG = await createInvoice({
    type: "CUSTOMER", customerId: customers[14].id, customerOrderId: coG.id,
    issuedAt: daysAgo(11), dueAt: inDays(3), totalCents: 201000, netCents: 168908, taxCents: 32092,
  });
  await recordPayment({ invoiceId: invG.id, direction: "INCOMING", amountCents: 100000, paidAt: daysAgo(5), method: "PayPal", note: "Teilzahlung" });

  // Statusableitung für alle Kundenbestellungen nachziehen
  for (const co of await db.customerOrder.findMany({ where: { status: { notIn: ["DRAFT", "CANCELLED"] } } })) {
    await db.$transaction(async (tx) => {
      await recomputeCoStatus(tx, co.id);
    });
  }

  // ---------- Notizen ----------
  await db.note.createMany({
    data: [
      { entityType: "CUSTOMER", entityId: customers[1].id, body: "Zahlt meist erst nach Erinnerung – vor größeren Bestellungen Vorkasse vereinbaren.", authorId: admin.id },
      { entityType: "SUPPLIER", entityId: suppliers[2].id, body: "Bei Teillieferungen immer Packliste prüfen – zuletzt 2× Fehlmengen.", authorId: admin.id },
      { entityType: "PRODUCT", entityId: P(0).id, body: "Sehr gefragt – Nachbestellung prüfen, sobald frei verfügbar < 20.", authorId: admin.id },
    ],
  });

  // ---------- Zusammenfassung ----------
  const counts = {
    Benutzer: await db.user.count(),
    Großhändler: await db.supplier.count(),
    Kunden: await db.customer.count(),
    Produkte: await db.product.count(),
    Einkaufsbestellungen: await db.purchaseOrder.count(),
    Kundenbestellungen: await db.customerOrder.count(),
    Bestandsbewegungen: await db.inventoryTransaction.count(),
    Chargen: await db.purchaseLot.count(),
    Rechnungen: await db.invoice.count(),
    Zahlungen: await db.payment.count(),
  };
  console.log("Seed abgeschlossen:", counts);
  console.log("\nLogin: admin@elia-erp.de / admin1234");
  console.log("       mitarbeiter@elia-erp.de / staff1234");
  console.log("       leser@elia-erp.de / read1234");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
