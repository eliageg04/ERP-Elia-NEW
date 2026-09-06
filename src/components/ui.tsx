import Link from "next/link";
import { cn } from "@/lib/format";
import { label, STATUS_TONE } from "@/lib/constants";

// ============================================================
// Präsentations-Komponenten (Server-kompatibel)
// ============================================================

export function PageHeader({
  title,
  subtitle,
  actions,
  backHref,
  backLabel,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="mb-6">
      {backHref && (
        <Link href={backHref} className="mb-1 inline-block text-sm text-ink-tertiary hover:text-ink">
          ← {backLabel ?? "Zurück"}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-ink-secondary">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({
  title,
  children,
  className,
  actions,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-surface shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_10px_30px_rgba(0,0,0,0.16)]",
        className
      )}
    >
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatCard({
  label: statLabel,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: "default" | "warn" | "danger";
}) {
  const inner = (
    <div
      className={cn(
        "rounded-lg border bg-surface px-4 py-3 transition-colors",
        tone === "danger" ? "border-danger/30" : tone === "warn" ? "border-warn/30" : "border-border",
        href && "hover:border-border-strong hover:bg-canvas"
      )}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-ink-tertiary">{statLabel}</div>
      <div className="tnum mt-1 text-lg font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-tertiary">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

const TONE_CLASSES: Record<string, string> = {
  neutral: "bg-canvas text-ink-secondary border-border",
  blue: "bg-info-soft text-info border-info/20",
  amber: "bg-warn-soft text-warn border-warn/20",
  green: "bg-ok-soft text-ok border-ok/20",
  red: "bg-danger-soft text-danger border-danger/20",
  violet: "bg-violet-soft text-violet border-violet/20",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONE_CLASSES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Status-Badge mit zentraler Farb- und Label-Zuordnung. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label(status)}</Badge>;
}

// ---------- Tabellen ----------

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border border-border bg-surface shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_10px_30px_rgba(0,0,0,0.16)]",
        className
      )}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-border bg-canvas text-left text-xs font-medium uppercase tracking-wide text-ink-tertiary">
      {children}
    </thead>
  );
}

export function Th({
  children,
  align,
  className,
}: {
  children?: React.ReactNode;
  align?: "right" | "center";
  className?: string;
}) {
  return (
    <th
      className={cn(
        "px-3 py-2 font-medium",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align,
  className,
  colSpan,
}: {
  children?: React.ReactNode;
  align?: "right" | "center";
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={cn(
        "px-3 py-2 align-middle",
        align === "right" && "tnum text-right",
        align === "center" && "text-center",
        className
      )}
    >
      {children}
    </td>
  );
}

export function Tr({
  children,
  className,
  muted,
}: {
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-b-0 hover:bg-canvas/60",
        muted && "opacity-60",
        className
      )}
    >
      {children}
    </tr>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-tertiary">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------- Detail-Listen ----------

export function DL({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm", className)}>{children}</dl>;
}

export function DT({ children }: { children: React.ReactNode }) {
  return <dt className="text-ink-tertiary">{children}</dt>;
}

export function DD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dd className={cn("text-ink", className)}>{children}</dd>;
}

/** Mengenfortschritt, z.B. „350 / 500 angekommen“. */
export function QtyProgress({
  value,
  total,
  toneWhenPartial = "amber",
}: {
  value: number;
  total: number;
  toneWhenPartial?: "amber" | "blue";
}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  const complete = total > 0 && value >= total;
  return (
    <div className="flex min-w-[110px] items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full", complete ? "bg-ok" : toneWhenPartial === "amber" ? "bg-warn" : "bg-info")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tnum text-xs text-ink-secondary">
        {value}/{total}
      </span>
    </div>
  );
}

// ---------- Buttons (Link-Varianten; Form-Buttons in form.tsx) ----------

const BUTTON_STYLES = {
  primary: "bg-ink text-canvas hover:bg-white border-transparent",
  secondary: "bg-surface text-ink border-border-strong hover:bg-canvas",
  ghost: "bg-transparent text-ink-secondary border-transparent hover:bg-canvas hover:text-ink",
  danger: "bg-surface text-danger border-danger/40 hover:bg-danger-soft",
};

export function buttonClass(variant: keyof typeof BUTTON_STYLES = "secondary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-full border font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
    BUTTON_STYLES[variant]
  );
}

export function LinkButton({
  href,
  children,
  variant = "secondary",
  size = "md",
}: {
  href: string;
  children: React.ReactNode;
  variant?: keyof typeof BUTTON_STYLES;
  size?: "sm" | "md";
}) {
  return (
    <Link href={href} className={buttonClass(variant, size)}>
      {children}
    </Link>
  );
}
