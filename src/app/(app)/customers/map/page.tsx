import { db } from "@/server/db";
import { PageHeader } from "@/components/ui";
import { detectUsState, normalizeCity, resolveCoords, shippingZone, ZONE_META, type ShippingZone } from "@/lib/geo";
import { CustomerMap, type MapPoint } from "./customer-map";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kunden-Weltkarte" };

export default async function CustomerMapPage() {
  const customers = await db.customer.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      shippingStreet: true, shippingZip: true, shippingCity: true, shippingCountry: true,
      billingStreet: true, billingZip: true, billingCity: true, billingCountry: true,
    },
    orderBy: { name: "asc" },
  });

  // Punkte auflösen; mehrere Kunden am selben Ort werden leicht versetzt
  const seen = new Map<string, number>();
  const points: MapPoint[] = [];
  let withoutAddress = 0;
  for (const c of customers) {
    const city = c.shippingCity ?? c.billingCity;
    const zip = c.shippingZip ?? c.billingZip;
    const street = c.shippingStreet ?? c.billingStreet;
    const country = c.shippingCountry ?? c.billingCountry;
    const coords = resolveCoords({ city, zip, country });
    if (!coords) {
      withoutAddress++;
      continue;
    }
    const state = (country ?? "").toUpperCase() === "US" ? detectUsState(zip, city, street) : null;
    const zone: ShippingZone = shippingZone(country, state, normalizeCity(city));
    const idx = seen.get(`${coords.lat},${coords.lng}`) ?? 0;
    seen.set(`${coords.lat},${coords.lng}`, idx + 1);
    // Spiralversatz, damit Punkte am selben Ort nicht exakt übereinanderliegen
    const angle = idx * 2.4;
    const r = idx === 0 ? 0 : 0.06 + 0.02 * idx;
    points.push({
      id: c.id,
      name: c.name,
      place: [city, country].filter(Boolean).join(", ") || "unbekannt",
      lat: coords.lat + r * Math.sin(angle),
      lng: coords.lng + r * Math.cos(angle),
      zone,
    });
  }

  const counts = new Map<ShippingZone, number>();
  for (const p of points) counts.set(p.zone, (counts.get(p.zone) ?? 0) + 1);
  const legend = (Object.keys(ZONE_META) as ShippingZone[])
    .filter((z) => (counts.get(z) ?? 0) > 0)
    .map((z) => ({ zone: z, ...ZONE_META[z], count: counts.get(z) ?? 0 }));

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Kunden-Weltkarte"
        backHref="/customers"
        backLabel="Kunden"
        subtitle={`${points.length} Kunden auf der Karte${withoutAddress > 0 ? ` · ${withoutAddress} ohne Adresse` : ""} – Farben zeigen die UPS-Versanddauer`}
      />
      <CustomerMap points={points} legend={legend} />
    </div>
  );
}
