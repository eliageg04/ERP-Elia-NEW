import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { globalSearch } from "@/server/services/search";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const results = await globalSearch(q);
  return NextResponse.json({ results });
}
