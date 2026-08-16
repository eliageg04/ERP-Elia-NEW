"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

type Result = { type: string; title: string; subtitle?: string; href: string };

/** Globale Suche: findet Produkte, Bestellungen, Kunden, Tracking, Rechnungen. */
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const data = (await res.json()) as { results: Result[] };
          setResults(data.results);
          setActive(0);
          setOpen(true);
        }
      } catch {
        // abgebrochen oder offline – ignorieren
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function go(result: Result) {
    setOpen(false);
    setQuery("");
    router.push(result.href);
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="search"
          value={query}
          placeholder="Suchen: Produkt, Bestellung, Kunde, Tracking…"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && open && results[active]) {
              e.preventDefault();
              go(results[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="w-full rounded-md border border-border-strong bg-surface py-1.5 pl-8 pr-3 text-sm placeholder:text-ink-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {results.map((r, i) => (
            <button
              key={`${r.href}-${i}`}
              onClick={() => go(r)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${
                i === active ? "bg-accent-soft" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.title}</span>
                {r.subtitle && <span className="block truncate text-xs text-ink-tertiary">{r.subtitle}</span>}
              </span>
              <span className="shrink-0 rounded bg-canvas px-1.5 py-0.5 text-[11px] text-ink-tertiary">
                {r.type}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
