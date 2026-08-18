import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { PageHeader, Card, StatusBadge, LinkButton, Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatEur } from "@/lib/money";
import { ItemReviewForm, BatchActions, ConfidenceBadge } from "./review-panels";

export const dynamic = "force-dynamic";

type ParsedItem = {
  productName?: string;
  sku?: string;
  ean?: string;
  qty?: string;
  unitPrice?: string;
  qtyParsed?: number | null;
  unitPriceCentsParsed?: number | null;
  totalPriceCentsParsed?: number | null;
  matchMethod?: string;
  candidates?: Array<{ productId: string; name: string; score: number }>;
  // Kontakt-Importe (Kunden/Lieferanten)
  company?: string;
  email?: string;
  city?: string;
};

export default async function ImportBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const batch = await db.importBatch.findUnique({
    where: { id },
    include: {
      items: { orderBy: { rowIndex: "asc" } },
      createdBy: { select: { name: true } },
    },
  });
  if (!batch) notFound();

  const [products, supplierSetting] = await Promise.all([
    db.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.setting.findUnique({ where: { key: `importSupplier:${id}` } }),
  ]);
  const supplierId = supplierSetting ? (JSON.parse(supplierSetting.value) as string) : null;
  const supplier = supplierId ? await db.supplier.findUnique({ where: { id: supplierId } }) : null;

  // Falls aus diesem Batch eine Entwurfs-Bestellung entstand: verlinken
  const draftPo = await db.purchaseOrder.findFirst({ where: { supplierOrderNumber: `IMPORT-${id}` } });

  const matchedIds = [...new Set(batch.items.map((i) => i.matchedProductId).filter(Boolean))] as string[];
  const matchedProducts = await db.product.findMany({ where: { id: { in: matchedIds } } });
  const productNameById = new Map(matchedProducts.map((p) => [p.id, p.name]));

  const pendingCount = batch.items.filter((i) => i.status === "PENDING" || i.status === "EDITED").length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {batch.filename ?? "Import"}
            <StatusBadge status={batch.status} />
          </span>
        }
        subtitle={
          <>
            {formatDateTime(batch.createdAt)} · {batch.createdBy?.name ?? "System"}
            {supplier && (
              <>
                {" · Lieferant: "}
                <Link href={`/suppliers/${supplier.id}`} className="hover:text-accent">{supplier.name}</Link>
              </>
            )}
          </>
        }
        backHref="/imports"
        backLabel="Import"
        actions={pendingCount > 0 ? <BatchActions batchId={id} supplierId={supplierId} /> : undefined}
      />

      {draftPo && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              Aus diesem Import ist die Entwurfs-Bestellung <span className="font-medium">{draftPo.orderNumber}</span>{" "}
              entstanden – bitte prüfen und als „Bestellt“ markieren.
            </p>
            <LinkButton href={`/purchase-orders/${draftPo.id}`} variant="primary" size="sm">
              Entwurfs-Bestellung öffnen
            </LinkButton>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {batch.items.map((item) => {
          const parsed: ParsedItem = item.parsed ? JSON.parse(item.parsed) : {};
          const raw: Record<string, string> = item.raw ? JSON.parse(item.raw) : {};
          const isOpen = item.status === "PENDING" || item.status === "EDITED";
          const defaultPrice =
            parsed.unitPriceCentsParsed ??
            (parsed.totalPriceCentsParsed && parsed.qtyParsed
              ? Math.round(parsed.totalPriceCentsParsed / parsed.qtyParsed)
              : null);
          return (
            <Card key={item.id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs text-ink-tertiary">Zeile {item.rowIndex + 1}</span>
                  <span className="font-medium">{parsed.productName ?? parsed.company ?? Object.values(raw)[0] ?? "–"}</span>
                  {parsed.sku && <Badge>Art-Nr: {parsed.sku}</Badge>}
                  {parsed.ean && <Badge>EAN: {parsed.ean}</Badge>}
                  {parsed.email && <Badge>{parsed.email}</Badge>}
                  {parsed.city && <Badge>{parsed.city}</Badge>}
                  {parsed.qtyParsed != null && <Badge tone="blue">Menge: {parsed.qtyParsed}</Badge>}
                  {defaultPrice != null && <Badge tone="blue">{formatEur(defaultPrice)}</Badge>}
                  <ConfidenceBadge confidence={item.confidence} method={parsed.matchMethod} />
                </div>
                <StatusBadge status={item.status} />
              </div>
              {isOpen ? (
                <ItemReviewForm
                  itemId={item.id}
                  kind={batch.kind}
                  supplierId={supplierId}
                  products={products}
                  candidates={(parsed.candidates ?? []).map((c) => ({ productId: c.productId, name: c.name }))}
                  matchedProductId={item.matchedProductId}
                  defaultQty={parsed.qtyParsed ?? null}
                  defaultPriceCents={defaultPrice}
                />
              ) : (
                <p className="text-sm text-ink-secondary">
                  {item.status === "ACCEPTED" && item.resultRefType === "PURCHASE_ORDER" && item.resultRefId && (
                    <>
                      Übernommen in{" "}
                      <Link href={`/purchase-orders/${item.resultRefId}`} className="font-medium hover:text-accent">
                        Bestellung öffnen →
                      </Link>
                    </>
                  )}
                  {item.status === "ACCEPTED" && item.resultRefType === "PRODUCT" && item.resultRefId && (
                    <>
                      Übernommen als{" "}
                      <Link href={`/products/${item.resultRefId}`} className="font-medium hover:text-accent">
                        {productNameById.get(item.matchedProductId ?? "") ?? "Produkt öffnen →"}
                      </Link>
                    </>
                  )}
                  {item.status === "ACCEPTED" && item.resultRefType === "CUSTOMER" && item.resultRefId && (
                    <>
                      Übernommen –{" "}
                      <Link href={`/customers/${item.resultRefId}`} className="font-medium hover:text-accent">
                        Kunde öffnen →
                      </Link>
                    </>
                  )}
                  {item.status === "ACCEPTED" && item.resultRefType === "SUPPLIER" && item.resultRefId && (
                    <>
                      Übernommen –{" "}
                      <Link href={`/suppliers/${item.resultRefId}`} className="font-medium hover:text-accent">
                        Lieferant öffnen →
                      </Link>
                    </>
                  )}
                  {item.status === "DISCARDED" && "Verworfen."}
                  {item.status === "DUPLICATE" && "Als Duplikat erkannt."}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
