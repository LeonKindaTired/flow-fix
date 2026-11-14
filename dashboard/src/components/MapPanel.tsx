'use client';
import { useEffect, useRef } from 'react';
import type { PublicReport } from '../lib/reports';
declare global { interface Window { L?: any } }
function cssToken(name: string) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function markerStyle(report: PublicReport) {
  const band = report.priority_band ?? 'low';
  const sizes: Record<string, number> = { low: 6, medium: 7, high: 9, urgent: 11 };
  return { radius: sizes[band] ?? 6, color: cssToken('--bg'), weight: 2, fillColor: cssToken(`--band-${band}`), fillOpacity: 1 };
}
function loadLeaflet(): Promise<any> { if (window.L) return Promise.resolve(window.L); return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.onload = () => window.L ? resolve(window.L) : reject(new Error('Leaflet did not load.')); script.onerror = () => reject(new Error('Map library could not load.')); document.head.appendChild(script); const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css); }); }
export default function MapPanel({ reports, selectedId, onSelect }: { reports: PublicReport[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const element = useRef<HTMLDivElement>(null); const map = useRef<any>(null); const layer = useRef<any>(null);
  useEffect(() => { let cancelled = false; loadLeaflet().then((L) => { if (cancelled || !element.current) return; map.current = L.map(element.current).setView([45.7489, 21.2087], 13); L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map.current); layer.current = L.layerGroup().addTo(map.current); }).catch(() => undefined); return () => { cancelled = true; map.current?.remove(); }; }, []);
  useEffect(() => { if (!map.current || !layer.current || !window.L) return; const L = window.L; layer.current.clearLayers(); reports.forEach((report) => { const band = report.priority_band ?? 'low'; const score = report.priority_score ?? '—'; const marker = L.circleMarker([report.latitude, report.longitude], markerStyle(report)); marker.bindTooltip(`${band} · ${score}`, { permanent: true, direction: 'top', className: 'marker-label', offset: [0, -6] }); marker.on('click', () => onSelect(report.id)); marker.addTo(layer.current); if (report.id === selectedId) marker.setStyle({ radius: (markerStyle(report).radius as number) + 3, weight: 4 }); }); if (selectedId) { const report = reports.find((item) => item.id === selectedId); if (report) map.current.setView([report.latitude, report.longitude], Math.max(map.current.getZoom(), 15)); } }, [reports, selectedId, onSelect]);
  return <div ref={element} className="map" aria-label="OpenStreetMap report map" />;
}
