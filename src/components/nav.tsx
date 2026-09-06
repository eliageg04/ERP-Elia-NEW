"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Package,
  Users,
  ClipboardList,
  Truck,
  TrendingUp,
  Inbox,
  Settings,
  ScrollText,
  Building2,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/format";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavGroup = { title: string | null; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    title: null,
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Einkauf",
    items: [
      { href: "/purchase-orders", label: "Vorbestellungen", icon: ShoppingCart },
      { href: "/suppliers", label: "Großhändler", icon: Building2 },
    ],
  },
  {
    title: "Lager",
    items: [
      { href: "/products", label: "Produkte", icon: Package },
      { href: "/inventory", label: "Bestand", icon: Boxes },
    ],
  },
  {
    title: "Verkauf",
    items: [
      { href: "/customers", label: "Kunden", icon: Users },
      { href: "/customer-orders", label: "Bestellungen", icon: ClipboardList },
      { href: "/shipments", label: "Versand", icon: Truck },
      { href: "/reports", label: "Margen & Reports", icon: TrendingUp },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/imports", label: "Import", icon: Inbox },
      { href: "/settings", label: "Einstellungen", icon: Settings },
      { href: "/audit-log", label: "Audit Log", icon: ScrollText },
    ],
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-4 px-3 pb-6">
      {NAV.map((group, gi) => (
        <div key={gi}>
          {group.title && (
            <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
              {group.title}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : item.href === "/inventory"
                    ? pathname === "/inventory"
                    : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-ink-secondary hover:bg-canvas hover:text-ink"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 overflow-y-auto border-r border-border bg-surface/70 backdrop-blur-xl lg:block">
      <Link href="/" className="flex items-center gap-2 px-5 py-4 transition-opacity hover:opacity-80">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#6ea8fe] to-[#8b7cf6] text-sm font-bold text-white">
          E
        </div>
        <span className="text-sm font-semibold tracking-tight">Elia ERP</span>
      </Link>
      <NavLinks />
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="Menü öffnen"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-border-strong bg-surface"
      >
        <Menu className="h-4 w-4" />
      </button>
      {/* Portal in den Body: der Header hat backdrop-blur und würde sonst
          zum Bezugsrahmen für position:fixed – das Menü klebte dann in der
          Kopfleiste statt die volle Höhe einzunehmen. */}
      {open &&
        mounted &&
        createPortal(
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col overflow-y-auto border-r border-border bg-surface shadow-2xl">
              <div className="flex items-center justify-between px-5 py-4">
                <span className="text-sm font-semibold">Elia ERP</span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Menü schließen"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary hover:bg-canvas hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
