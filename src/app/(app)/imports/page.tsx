import Link from "next/link";
import { db } from "@/server/db";
import { PageHeader, Table, THead, Th, Td, Tr, StatusBadge, EmptyState } from "@/components/ui";
import { ActionButton } from "@/components/form";
import { formatDateTime } from "@/lib/format";
import { label } from "@/lib/constants";
import { syncLexwareAction } from "@/server/actions/lexware";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // KI-Analyse von PDF-Rechnungen braucht Zeit
export const metadata = { title: "Import" };

const KIND_LABELS: Record<string, string> = {
  SUPPLIER_INVOICE: "Lieferantenrechnung",
  PURCHASE_ORDER: "Bestellung",
  PRODUCTS: "Produkte",
  CUSTOMERS: "Kunden",
  INVENTORY: "Bestand",
};

export default async function ImportsPage() {
  const [batches, suppliers, lexware, ai] = await Promise.all([
    db.importBatch.findMany({
      include: { items: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.integrationConfig.findUnique({ where: { provider: "LEXWARE" } }),
    db.integrationConfig.findUnique({ where: { provider: "AI" } }),
  ]);
  const aiEnabled = Boolean((ai?.enabled && ai.config && JSON.parse(ai.config)?.apiKey) || process.env.ANTHROPIC_API_KEY);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Import"
        subtitle="Automatisch importierte Daten landen zuerst in der Inbox – nichts wird ungeprüft übernommen."
        actions={
          lexware?.enabled ? (
            <ActionButton action={syncLexwareAction} variant="primary" size="md">
              Aus Lexware abrufen
            </ActionButton>
          ) : undefined
        }
      />

      <UploadForm
        suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))}
        lexwareEnabled={lexware?.enabled ?? false}
        aiEnabled={aiEnabled}
      />

      {batches.length === 0 ? (
        <EmptyState
          title="Noch keine Importe"
          hint="Lade eine CSV- oder Excel-Datei hoch (z.B. Lexware-Export oder Lieferantenrechnung)."
        />
      ) : (
        <Table>
          <THead>
            <tr>
              <Th>Datum</Th>
              <Th>Datei</Th>
              <Th>Art</Th>
              <Th>Quelle</Th>
              <Th>Positionen</Th>
              <Th>Status</Th>
            </tr>
          </THead>
          <tbody>
            {batches.map((b) => {
              const pending = b.items.filter((i) => i.status === "PENDING" || i.status === "EDITED").length;
              const accepted = b.items.filter((i) => i.status === "ACCEPTED").length;
              const discarded = b.items.filter((i) => i.status === "DISCARDED").length;
              return (
                <Tr key={b.id}>
                  <Td>{formatDateTime(b.createdAt)}</Td>
                  <Td>
                    <Link href={`/imports/${b.id}`} className="font-medium hover:text-accent">
                      {b.filename ?? "Import"}
                    </Link>
                  </Td>
                  <Td>{KIND_LABELS[b.kind] ?? b.kind}</Td>
                  <Td>{label(b.source)}</Td>
                  <Td className="text-ink-secondary">
                    {pending > 0 && <span className="font-medium text-warn">{pending} offen</span>}
                    {pending > 0 && (accepted > 0 || discarded > 0) && " · "}
                    {accepted > 0 && `${accepted} übernommen`}
                    {accepted > 0 && discarded > 0 && " · "}
                    {discarded > 0 && `${discarded} verworfen`}
                    {pending + accepted + discarded === 0 && "leer"}
                  </Td>
                  <Td><StatusBadge status={b.status} /></Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
