import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { createProductAction } from "@/server/actions/products";
import { ProductForm } from "../product-form";

export const metadata = { title: "Neues Produkt" };

export default async function NewProductPage() {
  const units = await db.unit.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <div>
      <PageHeader title="Neues Produkt" backHref="/products" backLabel="Produkte" />
      <ProductForm action={createProductAction} units={units} />
    </div>
  );
}
