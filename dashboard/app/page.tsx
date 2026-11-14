'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchReports, type PublicReport } from '../src/lib/reports';
const MapPanel = dynamic(() => import('../src/components/MapPanel'), { ssr: false, loading: () => <div className="map">Loading map...</div> });
const bands = ['urgent', 'high', 'medium', 'low'] as const;
const roadWeights: Record<string, number> = { primary: 100, secondary: 80, tertiary: 65, residential: 45, service: 25, footway: 20, unknown: 40 };
function components(report: PublicReport) { const severity = report.severity ? (report.severity - 1) * 25 : 0; const road = roadWeights[report.road_type] ?? 40; const community = Math.min(report.corroboration_count, 5) * 20; return { severity, road, community }; }
function formatTime(value: string) { return new Date(value).toLocaleString(); }

export default function DashboardPage() {
  const [reports, setReports] = useState<PublicReport[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); setError(''); try { const next = await fetchReports(); setReports(next); setSelectedId((current) => current && next.some((report) => report.id === current) ? current : next[0]?.id ?? null); } catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not load reports.'); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [load]);
  const selected = reports.find((report) => report.id === selectedId) ?? null;
  const counts: Record<string, number> = useMemo(() => Object.fromEntries(bands.map((band) => [band, reports.filter((report) => report.priority_band === band).length])), [reports]);
  return <main className="shell">
    <header className="header"><div><div className="eyebrow">FlowFix municipal view</div><h1>Road damage priority map</h1><p className="muted">Public reports from the safe <code>public_reports</code> view.</p></div><button onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing...' : 'Refresh now'}</button></header>
    <section className="summary" aria-label="Priority summary">{bands.map((band) => <div className="summary-card" data-band={band} key={band}><span>{band}</span><strong>{counts[band] ?? 0}</strong></div>)}</section>
    {loading && reports.length === 0 && <p>Loading reports...</p>}
    {error && <div className="error"><strong>Could not load reports.</strong><p>{error}</p><button onClick={() => void load()}>Retry</button></div>}
    {!loading && !error && reports.length === 0 && <p>No public reports are available yet.</p>}
    {reports.length > 0 && <section className="content">
      <div className="map-wrap"><MapPanel reports={reports} selectedId={selectedId} onSelect={setSelectedId} /></div>
      <aside className="list" aria-label="Reports sorted by priority"><h2>Priority list</h2>{reports.map((report) => <button className={`list-row ${selectedId === report.id ? 'selected' : ''}`} key={report.id} onClick={() => setSelectedId(report.id)}><strong>{report.priority_score ?? '—'} · {report.damage_type}</strong><div>{report.priority_band ?? 'unknown'} · severity {report.severity ?? '—'}</div><small className="muted">{report.address_label ?? 'Address unavailable'} {report.source === 'seeded_demo' && <span className="demo">· Demo data</span>}</small></button>)}</aside>
    </section>}
    {selected && <section className="detail"><h2>{selected.source === 'seeded_demo' && <span className="demo">Demo data · </span>}{selected.damage_type}</h2><div className="detail-grid"><div><span>Severity</span>{selected.severity ?? 'unknown'}</div><div><span>Priority</span>{selected.priority_score ?? 'unknown'} ({selected.priority_band ?? 'unknown'})</div><div><span>Road type</span>{selected.road_type}</div><div><span>Address</span>{selected.address_label ?? 'Unavailable'}</div><div><span>Corroborations</span>{selected.corroboration_count}</div><div><span>Created</span>{formatTime(selected.created_at)}</div></div><p><strong>Score explanation:</strong> severity is 65% ({components(selected).severity}/100), road importance is 15% ({components(selected).road}/100), and corroboration is 20% ({components(selected).community}/100). The final score is the documented deterministic weighted calculation.</p></section>}
    <footer>Scores are AI-assisted estimates, not engineering assessments. Map data © OpenStreetMap contributors. Road data: (c) OpenStreetMap contributors, geocoding by Photon (Komoot).</footer>
  </main>;
}
