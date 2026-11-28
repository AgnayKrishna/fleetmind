import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { eur, personOf } from '@/lib/fleet'
import type { FleetState } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Panel } from '@/components/fm'

type What = 'orders' | 'approvals' | 'decisions'
type Row = Record<string, unknown>

/** Reports: today's totals and the saved history (kept across restarts, from /api/history). */
export function ReportsPage({ state }: { state: FleetState }) {
  const [what, setWhat] = useState<What>('orders')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setRows(null)
    api<Record<string, Row[]>>(`/api/history/${what}?limit=200`).then(d => { setRows(d[what]); setErr(null) })
      .catch(e => setErr(e instanceof Error ? e.message : String(e)))
  }, [what])
  const k = state.kpi
  const tiles: [string, string][] = [
    [String(k.delivered), 'delivered'], [`${k.on_time_pct}%`, 'on time'], [Math.round(k.km).toLocaleString(), 'km driven'],
    ...(k.fuel_cost != null ? [[eur((k.fuel_cost ?? 0) + (k.energy_cost ?? 0)), 'fuel and charging'] as [string, string],
      [eur(k.fuel_savings), 'saved at cheaper stations'] as [string, string], [`€${(k.cost_per_km ?? 0).toFixed(2)}`, 'energy cost per km'] as [string, string]] : []),
    ...(k.revenue != null ? [[eur(k.revenue), 'revenue'] as [string, string], [eur(k.profit), 'profit'] as [string, string]] : []),
    [Math.round(k.co2_kg).toLocaleString(), 'kg CO₂'], [`${k.auto_decisions} / ${k.approvals_done}`, 'AI decisions / approved by people'],
  ]
  const cols: Record<What, [string, (r: Row) => string][]> = {
    orders: [['Order', r => String(r.id)], ['Route', r => `${r.pickup} → ${r.dropoff}`], ['Load', r => `${Number(r.weight).toLocaleString()} kg ${r.cargo}`],
      ['Status', r => String(r.status)], ['Vehicle', r => String(r.vehicle ?? '—')], ['Late', r => (r.late ? 'yes' : '')]],
    approvals: [['Id', r => String(r.id)], ['Decision', r => String(r.title)], ['State', r => String(r.state)],
      ['Decided by', r => String(r.decided_by ?? '—')], ['When', r => String(r.decided_sim ?? r.created_sim ?? '')]],
    decisions: [['When', r => String(r.sim_time)], ['Who', r => personOf(String(r.agent))], ['What', r => String(r.text)]],
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Panel className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([b, t]) => (
          <div key={t} className="rounded-[16px] bg-chip p-3"><div className="num text-[22px]">{b}</div><div className="text-[13px] text-muted-ink">{t}</div></div>
        ))}
      </Panel>
      <Panel className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-[20px] font-extrabold tracking-[-0.3px]">History</h1>
          {(['orders', 'approvals', 'decisions'] as What[]).map(w => (
            <button key={w} onClick={() => setWhat(w)} aria-pressed={what === w}
              className={cn('min-h-9 rounded-full px-3.5 text-[13px] font-bold', what === w ? 'bg-ink text-[var(--fm-solid)]' : 'bg-chip text-ink')}>
              {w === 'decisions' ? 'AI decisions' : w[0].toUpperCase() + w.slice(1)}
            </button>
          ))}
          <Badge className="ml-auto">Kept across restarts</Badge>
        </div>
        {err && <p className="text-[13px] text-act-text">Couldn't load the history: {err}</p>}
        {!rows && !err && <p className="text-[13px] text-muted-ink">Loading…</p>}
        {rows && (
          <div className="scroll-thin min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left text-[13px]">
              <thead className="sticky top-0 bg-[var(--fm-solid)] text-muted-ink">
                <tr>{cols[what].map(([h]) => <th key={h} className="px-2 py-2 font-bold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">{cols[what].map(([h, f]) => <td key={h} className="px-2 py-2 align-top">{f(r)}</td>)}</tr>
                ))}
                {rows.length === 0 && <tr><td className="px-2 py-4 text-muted-ink" colSpan={9}>Nothing saved yet.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
