// Orders board (design/reference/orders.reference.html): New, Assigned, In progress, Delivered, Problem.
// New cards show the rules engine's suggestion with a one-click amber Assign. Problem cards get a
// 2px red border and the proposed fix. Prices only reach the company admin (the server strips them).
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/lib/api'
import { eur } from '@/lib/fleet'
import type { Approval, FleetState, Job } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Btn } from '@/components/fm'

export interface Suggestion { vehicle: string; type: string; driver: string; deadhead_km: number; eta: string; on_time: boolean; energy_cost_eur?: number }
export interface DeliveredJob extends Job { delivered_str: string | null }
interface Board { places: { key: string; name: string }[]; suggestions: Record<string, Suggestion>; delivered: DeliveredJob[] }

type Col = 'new' | 'assigned' | 'progress' | 'delivered' | 'problem'
const COLS: { id: Col; title: string; dot: string }[] = [
  { id: 'new', title: 'New', dot: 'var(--fm-ink)' },
  { id: 'assigned', title: 'Assigned', dot: 'var(--fm-load)' },
  { id: 'progress', title: 'In progress', dot: 'var(--fm-good)' },
  { id: 'delivered', title: 'Delivered', dot: 'var(--fm-park-dot)' },
  { id: 'problem', title: 'Problem', dot: 'var(--fm-act)' },
]

const BOARD_POLL_MS = 5000

export function columnOf(j: Job, s: FleetState): Col {
  if (j.status === 'delivered') return 'delivered'
  const v = j.vehicle ? s.vehicles.find(x => x.id === j.vehicle) : null
  if (v?.status === 'broken' || (j.status === 'pending' && j.window_end < s.sim)) return 'problem'
  if (v?.trip && v.job_id === j.id && v.trip.on_time === false && (v.trip.late_min ?? 0) >= 30) return 'problem'
  if (j.status === 'pending') return 'new'
  if (j.status === 'assigned') return 'assigned'
  return 'progress'
}

const placeName = (n: string) => n.replace(/\s*\(.*\)$/, '')

export function OrdersPage({ state, canWrite, newOrder, onNewOrderClose, onAssign, onCreate, onReview, onShowVehicle }: {
  state: FleetState
  canWrite: boolean
  newOrder: boolean
  onNewOrderClose: () => void
  onAssign: (jid: string, vid?: string) => Promise<boolean>
  onCreate: (o: { pickup: string; dropoff: string; weight: number; cargo?: string; priority: string }) => Promise<boolean>
  onReview: (a: Approval) => void
  onShowVehicle: (id: string) => void
}) {
  const [board, setBoard] = useState<Board | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Board & { ok: boolean }>('/api/orders/board').then(setBoard).catch(() => { /* keep the last board */ })
  }, [])
  useEffect(() => {
    load()
    const t = window.setInterval(load, BOARD_POLL_MS)
    return () => window.clearInterval(t)
  }, [load])

  const live = new Set(state.jobs.map(j => j.id))
  const jobs: Job[] = [...state.jobs, ...(board?.delivered ?? []).filter(j => !live.has(j.id))]
  const byCol = new Map<Col, Job[]>(COLS.map(c => [c.id, []]))
  for (const j of jobs) byCol.get(columnOf(j, state))!.push(j)
  for (const list of byCol.values()) list.sort((a, b) => (a.priority === 'urgent' ? 0 : 1) - (b.priority === 'urgent' ? 0 : 1) || a.window_end - b.window_end)
  const planned = jobs.reduce((sum, j) => sum + (j.price_eur ?? 0), 0)
  const showPrices = jobs.some(j => j.price_eur != null)
  const approvalFor = (j: Job) => state.approvals.find(a => `${a.title} ${a.summary}`.includes(j.id) || (j.vehicle && `${a.title} ${a.summary}`.includes(j.vehicle)))

  async function assign(jid: string, vid?: string) {
    setBusy(jid)
    try { if (await onAssign(jid, vid)) load() } finally { setBusy(null) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
        <h1 className="text-[26px] font-extrabold tracking-[-0.4px]">Orders today</h1>
        <span className="text-[14px] text-muted-ink">{jobs.length} orders{showPrices ? `, ${eur(planned)} revenue planned` : ''}</span>
      </div>
      <div className="grid min-h-0 flex-1 gap-3.5 overflow-x-auto max-lg:auto-cols-[260px] max-lg:grid-flow-col lg:grid-cols-5">
        {COLS.map(c => {
          const list = byCol.get(c.id)!
          return (
            <section key={c.id} aria-label={c.title} className="flex min-h-0 flex-col gap-2.5 rounded-[16px] bg-[color-mix(in_srgb,var(--fm-ink)_6%,var(--fm-bg))] p-3">
              <div className="flex items-center gap-2 px-1 pt-0.5">
                <span className="size-[9px] rounded-full" style={{ background: c.dot }} />
                <h2 className="text-[15px] font-extrabold">{c.title}</h2>
                <span className="text-[13px] font-bold text-muted-ink">{list.length}</span>
              </div>
              <div className="scroll-thin -mx-1 flex min-h-0 flex-col gap-2.5 overflow-y-auto px-1 pb-1">
                {list.length === 0 && <p className="px-1 py-3 text-[13px] text-muted-ink">{c.id === 'problem' ? 'No problems.' : 'Nothing here.'}</p>}
                {list.map(j => (
                  <OrderCard key={j.id} j={j} col={c.id} state={state} canWrite={canWrite} busy={busy === j.id}
                    suggestion={board?.suggestions[j.id]} approval={approvalFor(j)}
                    onAssign={vid => assign(j.id, vid)} onReview={onReview} onShowVehicle={onShowVehicle} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {canWrite && <NewOrderDialog open={newOrder} places={board?.places ?? []} onClose={onNewOrderClose}
        onCreate={async o => { const ok = await onCreate(o); if (ok) { load(); onNewOrderClose() } return ok }} />}
    </div>
  )
}

function OrderCard({ j, col, state, canWrite, busy, suggestion, approval, onAssign, onReview, onShowVehicle }: {
  j: Job | DeliveredJob
  col: Col
  state: FleetState
  canWrite: boolean
  busy: boolean
  suggestion?: Suggestion
  approval?: Approval
  onAssign: (vid?: string) => void
  onReview: (a: Approval) => void
  onShowVehicle: (id: string) => void
}) {
  const v = j.vehicle ? state.vehicles.find(x => x.id === j.vehicle) : null
  const trip = v && v.job_id === j.id ? v.trip : null
  let when = `By ${j.window_end_str}`
  if (col === 'progress' && trip) when = `Arrives ${trip.eta}${trip.on_time === false ? `, ${trip.late_min} min late` : ', on time'}`
  if (col === 'delivered') when = `Delivered ${(j as DeliveredJob).delivered_str ?? ''}${j.late ? ', late' : ''}`
  if (col === 'problem' && j.status === 'pending') when = `Was due ${j.window_end_str}`

  let meta: { text: string; tone: 'amber' | 'watch' | 'act' | 'plain' } | null = null
  let action: { label: string; primary: boolean; run: () => void } | null = null
  if (col === 'new' || (col === 'problem' && j.status === 'pending')) {
    if (suggestion) {
      meta = { text: `Dina suggests ${suggestion.vehicle} (${suggestion.driver.split(' ')[0]}), ${suggestion.deadhead_km} km away, ETA ${suggestion.eta.slice(-5)}${suggestion.on_time ? '' : ', late'}`,
        tone: col === 'problem' ? 'act' : 'amber' }
      if (canWrite) action = { label: `Assign ${suggestion.vehicle}`, primary: true, run: () => onAssign(suggestion.vehicle) }
    } else meta = { text: j.hold ? 'On hold' : 'No vehicle can take it right now (busy, too small, hours or range)', tone: 'watch' }
  } else if (col === 'problem') {
    meta = { text: v?.status === 'broken' ? `${v.id} broke down${v.fault ? `: ${v.fault}` : ''}.` : `${v?.id} running ${trip?.late_min} min late.`, tone: 'act' }
    if (approval) {
      meta.text += approval.can_decide ? ` Proposed fix: ${approval.options.find(o => o.id === approval.recommended)?.label ?? approval.title}.` : ` ${approval.blocked_reason ?? ''}`
      if (canWrite && approval.can_decide) action = { label: 'Review the fix', primary: true, run: () => onReview(approval) }
    }
  } else if (v) {
    meta = { text: `${v.id} · ${v.driver.split(' ')[0]}${v.fuel_stop ? ', fuel or charge stop planned' : ''}${j.customer_notified ? ', customer told' : ''}`,
      tone: trip?.on_time === false ? 'watch' : 'plain' }
  } else if (col === 'delivered' && j.vehicle) meta = { text: `${j.vehicle}`, tone: 'plain' }

  const metaCls = { amber: 'text-amber-text', watch: 'text-watch-text', act: 'text-act-text', plain: 'text-[var(--fm-park-text)]' }

  return (
    <article className={cn('flex flex-col gap-1.5 rounded-[12px] bg-[var(--fm-solid)] p-3 transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(24,25,28,.06),0_10px_24px_rgba(24,25,28,.10)] motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      col === 'problem' ? 'shadow-[inset_0_0_0_2px_var(--fm-act)]' : 'shadow-[inset_0_0_0_1px_var(--fm-line)]')}>
      <div className="flex justify-between gap-2 text-[12px] font-bold text-muted-ink">
        <span>{j.id}</span>
        {j.price_eur != null && <span>{eur(j.price_eur)}</span>}
      </div>
      <div className="text-[15px] leading-snug font-extrabold">{placeName(j.pickup.name)} → {placeName(j.dropoff.name)}</div>
      <div className="text-[13px] text-[var(--fm-park-text)]">{j.cargo} · {j.weight.toLocaleString()} kg</div>
      <div className="text-[13px] text-[var(--fm-park-text)]">{when}</div>
      {(j.priority === 'urgent' || j.hazmat) && (
        <div className="flex flex-wrap gap-1.5">
          {j.priority === 'urgent' && <Badge tone="act">Urgent</Badge>}
          {j.hazmat && <Badge tone="watch" title="ADR dangerous goods: needs a trained driver"><AlertTriangle className="mr-1 size-3" />Dangerous goods</Badge>}
        </div>
      )}
      {meta && <div className={cn('text-[13px] font-bold', metaCls[meta.tone])}>{meta.text}</div>}
      <div className="mt-0.5 flex gap-2">
        {action && (
          <Btn size="sm" tone={action.primary ? 'primary' : 'secondary'} className="min-h-[38px] flex-1" disabled={busy} onClick={action.run}>
            {busy ? 'Assigning…' : action.label}
          </Btn>
        )}
        {v && col !== 'delivered' && <Btn size="sm" className="min-h-[38px]" onClick={() => onShowVehicle(v.id)}>Map</Btn>}
      </div>
    </article>
  )
}

function NewOrderDialog({ open, places, onClose, onCreate }: {
  open: boolean
  places: { key: string; name: string }[]
  onClose: () => void
  onCreate: (o: { pickup: string; dropoff: string; weight: number; cargo?: string; priority: string }) => Promise<boolean>
}) {
  const [f, setF] = useState({ pickup: '', dropoff: '', weight: '1000', cargo: '', priority: 'normal' })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value }))
  const w = Number(f.weight)
  const valid = f.pickup && f.dropoff && f.pickup !== f.dropoff && w >= 1 && w <= 40000
  const field = 'min-h-11 rounded-[14px] border border-line bg-chip px-3 text-[15px] text-ink outline-none focus-visible:border-amber'
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="glass max-w-[520px] rounded-[22px] border-0 p-6 text-ink sm:max-w-[520px]">
        <DialogTitle className="text-[20px] font-extrabold tracking-[-0.3px]">New order</DialogTitle>
        <DialogDescription className="text-[13px] text-muted-ink">It goes into the queue and Dina suggests a vehicle straight away.</DialogDescription>
        <form className="grid grid-cols-2 gap-3" onSubmit={async e => {
          e.preventDefault()
          if (!valid) return
          setBusy(true)
          try {
            if (await onCreate({ pickup: f.pickup, dropoff: f.dropoff, weight: w, cargo: f.cargo.trim() || undefined, priority: f.priority }))
              setF(x => ({ ...x, cargo: '' }))
          } finally { setBusy(false) }
        }}>
          <label className="col-span-2 flex flex-col gap-1 text-[13px] font-bold sm:col-span-1">Pickup
            <select required value={f.pickup} onChange={set('pickup')} className={field}>
              <option value="">Choose…</option>
              {places.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[13px] font-bold sm:col-span-1">Drop-off
            <select required value={f.dropoff} onChange={set('dropoff')} className={field}>
              <option value="">Choose…</option>
              {places.filter(p => p.key !== f.pickup).map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold">Weight (kg)
            <input type="number" min={1} max={40000} required value={f.weight} onChange={set('weight')} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-bold">Priority
            <select value={f.priority} onChange={set('priority')} className={field}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-[13px] font-bold">Cargo (optional)
            <input value={f.cargo} maxLength={80} onChange={set('cargo')} placeholder="e.g. 12 pallets of timber" className={field} />
          </label>
          <Btn tone="primary" size="lg" type="submit" className="col-span-2" disabled={busy || !valid}>
            {busy ? 'Creating…' : 'Create order'}
          </Btn>
        </form>
      </DialogContent>
    </Dialog>
  )
}
