"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import { ZONE_META, type ShippingZone } from "@/lib/geo";

export type MapPoint = {
  id: string;
  name: string;
  place: string;
  lat: number;
  lng: number;
  zone: ShippingZone;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Interaktive Weltkarte (Leaflet, dunkle CARTO-Kacheln): Kunden als
 * farbige Punkte nach UPS-Versanddauer, mit Zoom/Pan und Popups.
 */
export function CustomerMap({
  points,
  legend,
}: {
  points: MapPoint[];
  legend: Array<{ zone: ShippingZone; label: string; color: string; count: number }>;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current || ref.current.dataset.init) return;
      ref.current.dataset.init = "1";
      map = L.map(ref.current, { worldCopyJump: true, minZoom: 2 }).setView([30, -20], 2);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 19,
      }).addTo(map);

      for (const p of points) {
        const color = ZONE_META[p.zone].color;
        L.circleMarker([p.lat, p.lng], {
          radius: 7,
          color,
          weight: 1.5,
          fillColor: color,
          fillOpacity: 0.75,
        })
          .addTo(map)
          .bindPopup(
            `<div style="font-size:13px;line-height:1.5">` +
              `<b>${escapeHtml(p.name)}</b><br>` +
              `${escapeHtml(p.place)}<br>` +
              `<span style="color:${color}">●</span> ${escapeHtml(ZONE_META[p.zone].label)}` +
              `</div>`
          );
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
      if (ref.current) delete ref.current.dataset.init;
    };
  }, [points]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm">
        {legend.map((l) => (
          <span key={l.zone} className="flex items-center gap-1.5 text-ink-secondary">
            <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: l.color }} />
            {l.label}
            <span className="text-xs text-ink-tertiary">({l.count})</span>
          </span>
        ))}
      </div>
      <div
        ref={ref}
        className="h-[72vh] w-full overflow-hidden rounded-xl border border-border bg-canvas"
        aria-label="Weltkarte mit Kundenstandorten"
      />
    </div>
  );
}
