import Link from "next/link";
import { db } from "@/server/db";
import { getProductOverview } from "@/server/services/stats";
import { PageHeader, Table, THead, Th, Td, Tr, LinkButton, EmptyState, Badge } from "@/components/ui";
import { formatEur } from "@/lib/money";
import { formatNumber } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produkte" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; archived?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const showArchived = params.archived === "1";

  const products = await db.product.findMany({
    where: {
      active: showArchived ? undefined : true,
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { sku: { contains: q } },
              { ean: { contains: q } },
              { setName: { contains: q } },
            ],
          }
        : {}),
      ...(params.type ? { productType: params.type } : {}),
    },
    include: { baseUnit: true },
    orderBy: { name: "asc" },
    take: 300,
  });

  const types = await db.product.findMany({
    where: { productType: { not: null } },
    select: { productType: true },
    distinct: ["productType"],
  });

  const { stockMap, inTransitMap, priceMap, salesMap } = await getProductOverview(
    products.map((p) => p.id)
  );

  return (
    <div>
      <PageHeader
        title="Produkte"
        subtitle={`${products.length} Produkte`}
        actions={<LinkButton href="/products/new" variant="primary">Neues Produkt</LinkButton>}
      />

      {/* Filter */}
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Name, SKU, EAN, Set…"
          className="w-64 rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
        />
        <select
          name="type"
          defaultValue={params.type ?? ""}
          className="rounded-md border border-border-strong bg-surface px-2 py-1.5 text-sm"
        >
          <option value="">Alle Produktarten</option>
          {types.map((t) => (
            <option key={t.productType} value={t.productType!}>
              {t.productType}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-ink-secondary">
          <input type="checkbox" name="archived" value="1" defaultChecked={showArchived} />
          Archivierte zeigen
        </label>
        <button type="submit" className="rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm font-medium hover:bg-canvas">
          Filtern
        </button>
      </form>

      {products.length === 0 ? (
        <EmptyState
          title="Keine Produkte gefunden"
          hint={q ? "Suchbegriff anpassen oder neues Produkt anlegen." : "Lege dein erstes Produkt an."}
          action={<LinkButton href="/products/new" variant="primary">Neues Produkt</LinkButton>}
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Produkt</Th>
              <Th>Set / Sprache</Th>
              <Th align="right">Bestand</Th>
              <Th align="right">Reserviert</Th>
              <Th align="right">Frei</Th>
              <Th align="right">Unterwegs</Th>
              <Th align="right">Ø Einkauf</Th>
              <Th align="right">Verkauft</Th>
              <Th align="right">Marge</Th>
            </tr>
          </THead>
          <tbody>
            {products.map((p) => {
              const stock = stockMap.get(p.id) ?? { onHand: 0, reserved: 0, available: 0 };
              const price = priceMap.get(p.id);
              const sales = salesMap.get(p.id);
              return (
                <Tr key={p.id} muted={!p.active}>
                  <Td>
                    <Link href={`/products/${p.id}`} className="font-medium hover:text-accent">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-ink-tertiary">
                      {p.sku}
                      {!p.active && " · archiviert"}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-ink-secondary">{p.setName ?? "–"}</span>
                    {p.language && <Badge className="ml-1.5">{p.language}</Badge>}
                  </Td>
                  <Td align="right">{formatNumber(stock.onHand)}</Td>
                  <Td align="right">{stock.reserved > 0 ? formatNumber(stock.reserved) : "–"}</Td>
                  <Td align="right" className="font-medium">{formatNumber(stock.available)}</Td>
                  <Td align="right">{formatNumber(inTransitMap.get(p.id) ?? 0)}</Td>
                  <Td align="right">{formatEur(price?.weightedAvgCents)}</Td>
                  <Td align="right">{sales ? formatNumber(sales.soldQty) : "–"}</Td>
                  <Td align="right">
                    {sales?.marginPct !== null && sales?.marginPct !== undefined
                      ? `${(sales.marginPct * 100).toFixed(1)} %`
                      : "–"}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
