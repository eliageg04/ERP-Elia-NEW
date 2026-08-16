import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { updateProductAction, archiveProductAction } from "@/server/actions/products";
import { ActionButton } from "@/components/form";
import { ProductForm } from "../../product-form";

export const metadata = { title: "Produkt bearbeiten" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id } });
  if (!product) notFound();
  const units = await db.unit.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div>
      <PageHeader
        title={`${product.name} bearbeiten`}
        backHref={`/products/${id}`}
        backLabel="Produktseite"
        actions={
          <ActionButton
            action={archiveProductAction}
            variant={product.active ? "danger" : "secondary"}
            hiddenFields={{ id }}
            confirmMessage={
              product.active
                ? "Produkt archivieren? Es bleibt in allen historischen Daten erhalten."
                : "Produkt reaktivieren?"
            }
          >
            {product.active ? "Archivieren" : "Reaktivieren"}
          </ActionButton>
        }
      />
      <ProductForm action={updateProductAction} units={units} product={product} />
    </div>
  );
}
