import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, EmptyState } from "@/components/ui";
import { formatEur } from "@/lib/money";
import { MappingRowActions } from "./mapping-panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Produkt-Mappings" };

export default async function MappingsPage() {
  const mappings = await db.supplierProductMapping.findMany({
    include: { supplier: true, product: true, defaultUnit: true },
    orderBy: [{ supplier: { name: "asc" } }, { supplierName: "asc" }],
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Produkt-Mappings"
        subtitle="Gelernte Zuordnungen: Lieferanten-Bezeichnung → internes Produkt. Entstehen automatisch beim Import-Review und verbessern die Erkennung mit der Zeit."
        backHref="/settings"
        backLabel="Einstellungen"
      />
      {mappings.length === 0 ? (
        <EmptyState
          title="Noch keine Mappings"
          hint="Beim Prüfen von Importen lernt das System, welche Lieferanten-Bezeichnung zu welchem Produkt gehört."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Großhändler</Th>
              <Th>Bezeichnung des Lieferanten</Th>
              <Th>Art-Nr</Th>
              <Th>Internes Produkt</Th>
              <Th align="right">Letzter Preis</Th>
              <Th align="right">Einheiten-Faktor / Aktionen</Th>
            </tr>
          </THead>
          <tbody>
            {mappings.map((m) => (
              <Tr key={m.id}>
                <Td>
                  <Link href={`/suppliers/${m.supplierId}`} className="hover:text-accent">{m.supplier.name}</Link>
                </Td>
                <Td className="text-ink-secondary">„{m.supplierName}“</Td>
                <Td className="font-mono text-xs">{m.supplierSku ?? "–"}</Td>
                <Td>
                  <Link href={`/products/${m.productId}`} className="font-medium hover:text-accent">
                    {m.product.name}
                  </Link>
                </Td>
                <Td align="right">{formatEur(m.lastPriceCents)}</Td>
                <Td>
                  <MappingRowActions id={m.id} unitFactor={m.unitFactor} />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
