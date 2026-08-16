import { db } from "./db";
import type { Prisma } from "@prisma/client";

const PREFIXES: Record<string, string> = {
  PO: "PO", // Einkaufsbestellung
  SO: "SO", // Kundenbestellung
  WE: "WE", // Wareneingang
  WES: "WES", // eingehende Sendung
  VS: "VS", // Kundenversand
  RE: "RE", // Rechnung (intern)
  PRD: "PRD", // Produkt-SKU
  SUP: "SUP", // Lieferant
  KND: "KND", // Kunde
};

type Tx = Prisma.TransactionClient;

/**
 * Nächste fortlaufende Belegnummer, transaktionssicher.
 * Innerhalb einer bestehenden Transaktion den `tx`-Parameter übergeben.
 */
export async function nextNumber(counter: keyof typeof PREFIXES, tx?: Tx): Promise<string> {
  const client = tx ?? db;
  const row = await client.counter.upsert({
    where: { name: counter },
    create: { name: counter, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${PREFIXES[counter]}-${String(row.value).padStart(4, "0")}`;
}
