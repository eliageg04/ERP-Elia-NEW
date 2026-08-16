import { requireUser } from "@/server/auth";
import { logoutAction } from "@/server/actions/auth";
import { Sidebar, MobileNav } from "@/components/nav";
import { GlobalSearch } from "@/components/global-search";
import { label } from "@/lib/constants";
import { LogOut } from "lucide-react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-surface/90 px-4 py-2.5 backdrop-blur lg:px-6">
          <MobileNav />
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight">{user.name}</div>
              <div className="text-xs text-ink-tertiary">{label(user.role)}</div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                title="Abmelden"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border-strong text-ink-secondary hover:bg-canvas"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
