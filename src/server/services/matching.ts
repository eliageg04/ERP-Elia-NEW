import { db } from "../db";

// ============================================================
// Deterministisches Produktmatching für Importe.
// Reihenfolge: EAN → SKU → Lieferanten-Mapping (gelernt) →
// normalisierter Name → Ähnlichkeit (Trigramme).
// Unsichere Matches werden mit Confidence < 80 zur Prüfung markiert.
// ============================================================

export type MatchResult = {
  productId: string | null;
  confidence: number; // 0–100
  method: string;
  candidates: Array<{ productId: string; name: string; score: number }>;
};

/** Normalisierung für tolerantes Matching. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/pokémon/g, "pokemon")
    .replace(/[^a-z0-9äöüß ]/g, " ")
    .replace(/\b(the|und|and|von|of)\b/g, " ")
    .replace(/\bdisplays?\b/g, "display")
    .replace(/\bboxen\b/g, "box")
    .replace(/\bboxes\b/g, "box")
    .replace(/\bbooster\b/g, "booster")
    .replace(/\benglisch\b/g, "en")
    .replace(/\benglish\b/g, "en")
    .replace(/\bdeutsch\b/g, "de")
    .replace(/\bgerman\b/g, "de")
    .replace(/\bjapanese\b/g, "jp")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const grams = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Trigramm-Ähnlichkeit 0..1 (tolerant gegenüber Schreibvarianten). */
export function similarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = trigrams(na);
  const gb = trigrams(nb);
  let common = 0;
  for (const g of ga) if (gb.has(g)) common++;
  return (2 * common) / (ga.size + gb.size);
}

/**
 * Produkt zu importierten Rohdaten finden.
 * supplierId verbessert das Matching über gelernte Lieferanten-Mappings.
 */
export async function matchProduct(params: {
  name?: string | null;
  ean?: string | null;
  sku?: string | null; // interne oder Lieferanten-SKU
  supplierId?: string | null;
}): Promise<MatchResult> {
  // 1. EAN – eindeutig
  if (params.ean) {
    const byEan = await db.product.findFirst({ where: { ean: params.ean.trim(), active: true } });
    if (byEan) return { productId: byEan.id, confidence: 100, method: "EAN", candidates: [] };
  }
  // 2. Interne SKU
  if (params.sku) {
    const bySku = await db.product.findFirst({ where: { sku: params.sku.trim() } });
    if (bySku) return { productId: bySku.id, confidence: 100, method: "SKU", candidates: [] };
  }
  // 3. Gelerntes Lieferanten-Mapping (SKU oder exakter Name)
  if (params.supplierId) {
    if (params.sku) {
      const mapBySku = await db.supplierProductMapping.findFirst({
        where: { supplierId: params.supplierId, supplierSku: params.sku.trim() },
      });
      if (mapBySku)
        return { productId: mapBySku.productId, confidence: 98, method: "Lieferanten-Artikelnummer", candidates: [] };
    }
    if (params.name) {
      const mapByName = await db.supplierProductMapping.findFirst({
        where: { supplierId: params.supplierId, supplierName: params.name.trim() },
      });
      if (mapByName)
        return { productId: mapByName.productId, confidence: 97, method: "Gelerntes Mapping", candidates: [] };
    }
  }
  // 4. Namensähnlichkeit über alle aktiven Produkte
  if (params.name) {
    const products = await db.product.findMany({
      where: { active: true },
      select: { id: true, name: true, setName: true, language: true },
    });
    const scored = products
      .map((p) => {
        const full = [p.name, p.setName, p.language].filter(Boolean).join(" ");
        const score = Math.max(similarity(params.name!, p.name), similarity(params.name!, full));
        return { productId: p.id, name: p.name, score };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score >= 0.92) {
      return {
        productId: best.productId,
        confidence: Math.round(best.score * 100),
        method: "Name (exakt)",
        candidates: scored.slice(0, 5).filter((c) => c.score > 0.3),
      };
    }
    if (best && best.score >= 0.55) {
      return {
        productId: best.productId,
        confidence: Math.round(best.score * 100),
        method: "Name (ähnlich)",
        candidates: scored.slice(0, 5).filter((c) => c.score > 0.3),
      };
    }
    return {
      productId: null,
      confidence: best ? Math.round(best.score * 100) : 0,
      method: "Kein Treffer",
      candidates: scored.slice(0, 5).filter((c) => c.score > 0.25),
    };
  }
  return { productId: null, confidence: 0, method: "Keine Daten", candidates: [] };
}

/** Bestätigtes Mapping speichern, damit das System dazulernt. */
export async function learnSupplierMapping(params: {
  supplierId: string;
  productId: string;
  supplierName: string;
  supplierSku?: string | null;
  unitFactor?: number | null;
  defaultUnitId?: string | null;
  lastPriceCents?: number | null;
}) {
  await db.supplierProductMapping.upsert({
    where: {
      supplierId_supplierName: {
        supplierId: params.supplierId,
        supplierName: params.supplierName.trim(),
      },
    },
    create: {
      supplierId: params.supplierId,
      productId: params.productId,
      supplierName: params.supplierName.trim(),
      supplierSku: params.supplierSku?.trim() || null,
      unitFactor: params.unitFactor ?? null,
      defaultUnitId: params.defaultUnitId ?? null,
      lastPriceCents: params.lastPriceCents ?? null,
    },
    update: {
      productId: params.productId,
      supplierSku: params.supplierSku?.trim() || undefined,
      unitFactor: params.unitFactor ?? undefined,
      defaultUnitId: params.defaultUnitId ?? undefined,
      lastPriceCents: params.lastPriceCents ?? undefined,
    },
  });
}
