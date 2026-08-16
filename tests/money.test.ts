import { describe, expect, it } from "vitest";
import {
  weightedAverageCents,
  apportionCents,
  margin,
  markup,
  priceForTargetMargin,
  toEurCents,
} from "@/lib/money";

describe("weightedAverageCents", () => {
  it("berechnet den gewichteten Durchschnitt (nie den einfachen Mittelwert)", () => {
    // Beispiel aus der Anforderung: 100 × 90 € + 50 × 94 € = 13.700 € / 150
    const result = weightedAverageCents([
      { qty: 100, unitPriceCents: 9000 },
      { qty: 50, unitPriceCents: 9400 },
    ]);
    expect(result).toBe(Math.round((100 * 9000 + 50 * 9400) / 150)); // 9133, NICHT 9200
    expect(result).not.toBe(9200); // der naive Durchschnitt wäre falsch
  });

  it("drei Lieferanten mit unterschiedlichen Mengen", () => {
    const result = weightedAverageCents([
      { qty: 100, unitPriceCents: 9000 },
      { qty: 50, unitPriceCents: 9400 },
      { qty: 25, unitPriceCents: 8800 },
    ]);
    expect(result).toBe(Math.round((900000 + 470000 + 220000) / 175)); // 9086
  });

  it("gibt null bei leerer Menge zurück", () => {
    expect(weightedAverageCents([])).toBeNull();
    expect(weightedAverageCents([{ qty: 0, unitPriceCents: 5000 }])).toBeNull();
  });
});

describe("apportionCents (Kostenverteilung)", () => {
  it("verteilt ohne Rundungsverlust (Summe exakt erhalten)", () => {
    const shares = apportionCents(10000, [1, 1, 1]); // 100 € auf 3 gleich
    expect(shares.reduce((a, b) => a + b, 0)).toBe(10000);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it("verteilt proportional nach Warenwert", () => {
    const shares = apportionCents(30000, [200000, 100000]); // 2:1
    expect(shares).toEqual([20000, 10000]);
  });

  it("kein Gewicht → keine Verteilung", () => {
    expect(apportionCents(5000, [0, 0])).toEqual([0, 0]);
  });
});

describe("Marge vs. Aufschlag (strikt getrennt)", () => {
  it("EK 90 €, VK 120 € → Marge 25 %, Aufschlag 33,33 %", () => {
    expect(margin(12000, 9000)).toBeCloseTo(0.25, 5);
    expect(markup(12000, 9000)).toBeCloseTo(1 / 3, 5);
  });

  it("Zielmarge 25 % auf EK 90 € → VK 120 €", () => {
    expect(priceForTargetMargin(9000, 0.25)).toBe(12000);
  });

  it("ungültige Werte ergeben null statt Unsinn", () => {
    expect(margin(0, 9000)).toBeNull();
    expect(markup(12000, 0)).toBeNull();
    expect(priceForTargetMargin(9000, 1)).toBeNull();
  });
});

describe("Währungsumrechnung", () => {
  it("friert den Kurs ein (USD → EUR)", () => {
    expect(toEurCents(10000, 0.92)).toBe(9200);
  });
});
