import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    // Client-Router-Cache: bereits besuchte Seiten bleiben 30 s im Browser
    // frisch – Zurück-/Seitenwechsel sind damit sofort da statt jedes Mal
    // die Cloud-Datenbank zu fragen. Nach Aktionen (Speichern etc.)
    // invalidiert revalidatePath den Cache ohnehin.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
