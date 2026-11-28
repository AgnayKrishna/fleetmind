// Fleet table (design/reference/fleet-table.reference.html): one row per vehicle, status filter pills
// with counts, "/" to search, sortable columns, Export CSV. Rows are virtualised so 100+ vehicles stay fast.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react'
import { DOING, LOW_ENERGY_PCT, STATUS, STATUS_ORDER, VEHICLE_COLOR, personOf, statusOf, type StatusKey } from '@/lib/fleet'
import type { FleetState, LogEntry, Place, Vehicle } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Btn, Panel, StatusChip } from '@/components/fm'

const ROW_H = 56
const OVERSCAN = 8
const MAX_DRIVE_H = 9
const COLS = 'grid-cols-[150px_150px_130px_minmax(150px,1.3fr)_minmax(150px,1.2fr)_90px_100px_100px_minmax(180px,1.5fr)]'

type SortKey = 'id' | 'driver' | 'status' | 'where' | 'next' | 'load' | 'energy' | 'drive' | 'note'

export interface FleetRow {
  v: Vehicle
  status: StatusKey
  where: string
  next: string
  load: number
  driveLeft: number
  note: string
}

const LOADED = ['to_dropoff', 'unloading']

function nearest(places: Place[], v: Vehicle) {
  let best: Place | null = null, d = Infinity
  for (const p of places) {
    const dd = (p.lat - v.lat) ** 2 + ((p.lon - v.lon) * Math.cos((v.lat * Math.PI) / 180)) ** 2
    if (dd < d) { d = dd; best = p }
  }
  return best && d < 0.0004 ? `at ${best.name}` : best && d < 0.02 ? `near ${best.name}` : ''   // ~2 km / ~15 km
}

export const fmtHours = (h: number) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`

/** The rows, with the latest AI note per vehicle from the agent log. */
export function fleetRows(s: FleetState, log: LogEntry[]): FleetRow[] {
  const places = new Map<string, Place>()
  for (const j of s.jobs) { places.set(j.pickup.name, j.pickup); places.set(j.dropoff.name, j.dropoff) }
  const placeList = [...places.values()]
  const notes = new Map<string, string>()
  for (const e of log) {
    if (e.agent === 'Fleet manager' || e.agent === 'GTM Agent') continue
    for (const m of e.text.matchAll(/LV-[A-Z]?\d+/g)) notes.set(m[0], `${personOf(e.agent)}: ${e.text}`)
  }
  return s.vehicles.map(v => {
    const t = v.trip
    const near = nearest(placeList, v)
    const next = !t ? (v.status === 'idle' ? 'Free now' : DOING[v.status] ?? v.status)
      : `${t.destination}, ${t.eta}${t.on_time === false && t.late_min ? ` (+${t.late_min})` : ''}`
    return {
      v, status: statusOf(v),
      where: [DOING[v.status] ?? v.status, near].filter(Boolean).join(', '),
      next,
      load: t?.weight && LOADED.includes(v.status) ? Math.min(100, Math.round((t.weight / v.capacity) * 100)) : 0,
      driveLeft: Math.max(0, MAX_DRIVE_H - v.drive_today_h),
      note: notes.get(v.id) ?? '',
    }
  })
}

const SORTERS: Record<SortKey, (r: FleetRow) => string | number> = {
  id: r => r.v.id, driver: r => r.v.driver, status: r => STATUS_ORDER.indexOf(r.status), where: r => r.where,
  next: r => r.next, load: r => r.load, energy: r => r.v.energy_pct, drive: r => r.driveLeft, note: r => r.note,
}

const HEADERS: [SortKey, string][] = [
  ['id', 'Vehicle'], ['driver', 'Driver'], ['status', 'Status'], ['where', 'Where'], ['next', 'Next stop, ETA'],
  ['load', 'Load'], ['energy', 'Fuel / charge'], ['drive', 'Drive left'], ['note', 'AI note'],
]

function csvCell(x: string | number) {
  const s = String(x)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: FleetRow[]) {
  const head = ['Vehicle', 'Type', 'Driver', 'Status', 'Where', 'Next stop, ETA', 'Load %', 'Fuel / charge %', 'Drive left h', 'AI note']
  const body = rows.map(r => [r.v.id, r.v.label, r.v.driver, STATUS[r.status].label, r.where, r.next, r.load, r.v.energy_pct,
    r.driveLeft.toFixed(1), r.note])
  return [head, ...body].map(line => line.map(csvCell).join(',')).join('\r\n')
}

export function FleetPage({ state, log, onSelect, lastOk }: {
  state: FleetState
  log: LogEntry[]
  onSelect: (id: string) => void
  lastOk: Date | null
}) {
  const [filter, setFilter] = useState<StatusKey | 'all'>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 })
  const search = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, h: 600 })

  const all = useMemo(() => fleetRows(state, log), [state, log])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length }
    for (const r of all) c[r.status] = (c[r.status] ?? 0) + 1
    return c
  }, [all])
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase()
    const f = all.filter(r => (filter === 'all' || r.status === filter)
      && (!t || `${r.v.id} ${r.v.driver} ${r.where} ${r.next} ${r.v.label}`.toLowerCase().includes(t)))
    const get = SORTERS[sort.key]
    return f.sort((a, b) => {
      const x = get(a), y = get(b)
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return (c || a.v.id.localeCompare(b.v.id)) * sort.dir
    })
  }, [all, filter, q, sort])

  // "/" focuses the search (unless you're already typing somewhere)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (e.key === '/' && !/input|textarea|select/i.test(el.tagName) && !el.isContentEditable) { e.preventDefault(); search.current?.focus() }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  useEffect(() => {
    const el = body.current
    if (!el) return
    const ro = new ResizeObserver(() => setScroll(s => ({ ...s, h: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / ROW_H) + OVERSCAN)
  const ago = lastOk ? Math.max(0, Math.round((Date.now() - lastOk.getTime()) / 1000)) : null

  function exportCsv() {
    const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fleet-${state.clock.replace(/[^\dA-Za-z]+/g, '-')}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const pills: (StatusKey | 'all')[] = ['all', 'route', 'loading', 'parked', 'risk', 'act', 'nosignal']

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">Fleet</h1>
        <span className="text-[14px] text-muted-ink">{all.length} vehicles, {rows.length} shown</span>
        {ago != null && (
          <span className="flex items-center gap-2 text-[13px] text-muted-ink">
            <span className="size-2 rounded-full bg-good shadow-[0_0_0_4px_var(--fm-good-tint)]" />Live, updated {ago} s ago
          </span>
        )}
        <div className="flex-1" />
        <label className="flex h-[42px] w-[320px] max-w-full items-center gap-2 rounded-[12px] border border-line bg-[var(--fm-solid)] px-3.5 text-[14px]">
          <Search className="size-4 text-muted-ink" aria-hidden="true" />
          <span className="sr-only">Search plate, driver or place</span>
          <input ref={search} value={q} onChange={e => setQ(e.target.value)} placeholder="Search plate, driver or place"
            onKeyDown={e => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur() } }}
            className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted-ink" />
          <kbd className="rounded-md bg-chip px-1.5 py-0.5 text-[12px] font-bold text-muted-ink">/</kbd>
        </label>
        <Btn tone="outline" onClick={exportCsv} className="h-[42px] min-h-0 rounded-[12px] bg-[var(--fm-solid)]">
          <Download className="size-4" />Export CSV
        </Btn>
      </div>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {pills.map(k => {
          const on = filter === k
          return (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={on}
              className={cn('flex h-[38px] items-center gap-2 rounded-full px-3.5 text-[14px] font-bold transition-[background,box-shadow] duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-text',
                on ? 'bg-ink text-[var(--fm-solid)]' : 'bg-[var(--fm-solid)] text-ink shadow-[inset_0_0_0_1px_var(--fm-line)]')}>
              <span className="size-[9px] rounded-full"
                style={k === 'all' ? { background: on ? 'var(--fm-solid)' : 'var(--fm-ink)' }
                  : k === 'nosignal' ? { border: '2px dashed var(--fm-muted)' } : { background: STATUS[k].dot }} />
              {k === 'all' ? 'All' : STATUS[k].label}
              <span className="opacity-70">{counts[k] ?? 0}</span>
            </button>
          )
        })}
      </div>

      <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[18px] bg-[var(--fm-solid)]">
        <div className="scroll-thin min-h-0 flex-1 overflow-auto" ref={body}
          onScroll={e => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })}>
          <div role="table" aria-label="Vehicles" aria-rowcount={rows.length + 1} className="min-w-[1180px]">
            <div role="row" className={cn('sticky top-0 z-10 grid h-11 items-center gap-3 border-b border-line bg-[color-mix(in_srgb,var(--fm-solid),var(--fm-ink)_2%)] px-5 text-[12px] font-bold text-muted-ink', COLS)}>
              {HEADERS.map(([key, label]) => {
                const on = sort.key === key
                return (
                  <span role="columnheader" key={key} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                    <button onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
                      className={cn('inline-flex min-h-8 items-center gap-1 rounded-md hover:text-ink focus-visible:outline-2 focus-visible:outline-amber', on && 'text-ink')}>
                      {label}{on && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  </span>
                )
              })}
            </div>
            <div role="rowgroup" style={{ height: rows.length * ROW_H, position: 'relative' }}>
              {rows.slice(first, last).map((r, i) => (
                <div role="row" key={r.v.id} tabIndex={0} aria-rowindex={first + i + 2}
                  onClick={() => onSelect(r.v.id)} onKeyDown={e => { if (e.key === 'Enter') onSelect(r.v.id) }}
                  title={`Show ${r.v.id} on the map`}
                  style={{ position: 'absolute', top: (first + i) * ROW_H, left: 0, right: 0, height: ROW_H }}
                  className={cn('grid cursor-pointer items-center gap-3 border-b border-[color-mix(in_srgb,var(--fm-line)_50%,transparent)] px-5 text-[14px] hover:bg-chip focus-visible:bg-chip focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-amber', COLS)}>
                  <span role="cell" className="flex items-center gap-2.5 font-extrabold">
                    <span className="h-3.5 w-[26px] shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)]" style={{ background: VEHICLE_COLOR[r.v.type] }}
                      title={r.v.label} />
                    {r.v.id}
                  </span>
                  <span role="cell" className="truncate">{r.v.driver}</span>
                  <span role="cell"><StatusChip status={r.status} /></span>
                  <span role="cell" className="truncate text-muted-ink">{r.where}</span>
                  <span role="cell" className="truncate">{r.next}</span>
                  <span role="cell" className="flex items-center gap-2" aria-label={`Load ${r.load}%`}>
                    <span className="h-1.5 w-11 overflow-hidden rounded-[3px] bg-chip"><span className="block h-1.5 bg-[var(--fm-park-text)]" style={{ width: `${r.load}%` }} /></span>
                    <span className="text-[12px] text-muted-ink">{r.load}%</span>
                  </span>
                  <span role="cell" className={cn('font-bold', r.v.energy_pct < LOW_ENERGY_PCT && 'text-act-text')}>{r.v.energy_pct}%</span>
                  <span role="cell" className={cn('font-bold', r.driveLeft < 1 && 'text-watch-text')}>{fmtHours(r.driveLeft)}</span>
                  <span role="cell" className="truncate text-[13px] text-muted-ink" title={r.note}>{r.note || '—'}</span>
                </div>
              ))}
            </div>
            {rows.length === 0 && <p className="px-5 py-8 text-center text-muted-ink">No vehicles match. Try another filter or search.</p>}
          </div>
        </div>
      </Panel>
    </div>
  )
}
