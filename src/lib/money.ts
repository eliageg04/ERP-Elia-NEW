// Geld-Arithmetik: ausschließlich Integer-Cents.
// Marge vs. Aufschlag werden hier zentral (und nur hier) definiert,
// damit die Begriffe nie verwechselt werden:
//   Marge   = Gewinn / Verkaufspreis
//   Aufschlag (Markup) = Gewinn / Einkaufspreis

export function formatEur(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "–";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function formatMoney(cents: number | null | undefined, currency: string = "EUR"): string {
  if (cents === null || cents === undefined) return "–";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(cents / 100);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !isFinite(value)) return "–";
  return new Intl.NumberFormat("de-DE", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** Fremdwährungs-Cents → EUR-Cents mit eingefrorenem Kurs (EUR pro 1 Einheit). */
export function toEurCents(amountCents: number, fxRate: number): number {
  return Math.round(amountCents * fxRate);
}

/** Marge = Gewinn / Verkaufspreis. Gibt z.B. 0.25 für 25 % zurück. */
export function margin(salePriceCents: number, costCents: number): number | null {
  if (salePriceCents <= 0) return null;
  return (salePriceCents - costCents) / salePriceCents;
}

/** Aufschlag (Markup) = Gewinn / Einkaufspreis. Gibt z.B. 0.3333 für 33,33 % zurück. */
export function markup(salePriceCents: number, costCents: number): number | null {
  if (costCents <= 0) return null;
  return (salePriceCents - costCents) / costCents;
}

/** Empfohlener Verkaufspreis für eine Zielmarge (z.B. 0.25 = 25 %). */
export function priceForTargetMargin(costCents: number, targetMargin: number): number | null {
  if (targetMargin >= 1 || targetMargin < 0) return null;
  return Math.round(costCents / (1 - targetMargin));
}

/**
 * Gewichteter Durchschnittspreis: Gesamtkosten / Gesamtmenge.
 * Niemals ein einfacher Durchschnitt der Einzelpreise!
 */
export function weightedAverageCents(
  entries: Array<{ qty: number; unitPriceCents: number }>
): number | null {
  let totalQty = 0;
  let totalCents = 0;
  for (const e of entries) {
    totalQty += e.qty;
    totalCents += e.qty * e.unitPriceCents;
  }
  if (totalQty === 0) return null;
  return Math.round(totalCents / totalQty);
}

/**
 * Verteilt einen Gesamtbetrag proportional zu Gewichten, ohne Rundungsverluste
 * (Largest-Remainder-Verfahren): Die Summe der Anteile ergibt exakt den Betrag.
 */
export function apportionCents(totalCents: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalCents * w) / totalWeight);
  const floored = raw.map(Math.floor);
  let remainder = totalCents - floored.reduce((a, b) => a + b, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floored];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    result[order[k].i] += 1;
  }
  return result;
}
