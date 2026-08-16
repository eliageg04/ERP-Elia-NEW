import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, Badge } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { CreateUnitForm, DeleteUnitButton } from "./unit-panels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Einheiten" };

export default async function UnitsPage() {
  const units = await db.unit.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      _count: { select: { productsAsBase: true, conversions: true, poLines: true } },
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Einheiten"
        subtitle="Verpackungs-/Mengeneinheiten. Umrechnungen (z.B. 1 Case = 6 Displays) werden pro Produkt gepflegt."
        backHref="/settings"
        backLabel="Einstellungen"
      />
      <CreateUnitForm />
      <Table>
        <THead>
          <tr>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th></Th>
            <Th align="right">Verwendungen</Th>
            <Th></Th>
          </tr>
        </THead>
        <tbody>
          {units.map((u) => {
            const uses = u._count.productsAsBase + u._count.conversions + u._count.poLines;
            return (
              <Tr key={u.id}>
                <Td className="font-medium">{u.name}</Td>
                <Td className="font-mono text-xs">{u.code}</Td>
                <Td>{u.isSystem && <Badge>System</Badge>}</Td>
                <Td align="right">{formatNumber(uses)}</Td>
                <Td align="right">
                  {!u.isSystem && uses === 0 && <DeleteUnitButton id={u.id} name={u.name} />}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
