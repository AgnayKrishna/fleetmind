// AI activity (design/reference/ai-activity.reference.html): what the AI team decided by itself today.
// Undo calls POST /api/actions/{id}/undo, which really reverts the action in the backend and logs it.
// Things that can't be reversed (customer messages already sent) have no Undo.
import { useMemo, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { personOf, TEAM, hhmm } from '@/lib/fleet'
import type { AiAction, FleetState, LogEntry } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Btn, Panel } from '@/components/fm'

function simMinutes(clock: string) {
  const m = /Day (\d+) (\d\d):(\d\d)/.exec(clock)
  return m ? (Number(m[1]) - 1) * 1440 + Number(m[2]) * 60 + Number(m[3]) : 0
}

/** Agent log lines about the same vehicles within 20 minutes before the action: the "why". */
function related(a: AiAction, log: LogEntry[]) {
  const t = simMinutes(a.t)
  return log.filter(e => {
    const dt = t - simMinutes(e.t)
    return dt >= 0 && dt <= 20 && e.agent !== 'GTM Agent' && a.vehicles.some(v => e.text.includes(v))
  }).slice(-6)
}

function undoHint(a: AiAction, role: string) {
  if (!a.reversible) return 'Already done for real (for example a message that was sent), so it can’t be undone.'
  if (a.state === 'undone') return null
  if (a.can_undo) return null
  if (role === 'employee') return 'You can undo AI actions on your own trucks only.'
  if (role === 'guest') return 'Guests can look but not change anything.'
  if (role === 'superadmin') return 'Super admins support companies but never undo their decisions.'
  return 'Not allowed for your role.'
}

export function ActivityPage({ state, log, onUndo, onSelectVehicle }: {
  state: FleetState
  log: LogEntry[]
  onUndo: (a: AiAction) => Promise<boolean>
  onSelectVehicle: (id: string) => void
}) {
  const actions = state.actions
  const [selId, setSelId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const sel = actions.find(a => a.id === selId) ?? actions[0] ?? null
  const undone = actions.filter(a => a.state === 'undone').length
  const why = useMemo(() => (sel ? related(sel, log) : []), [sel, log])
  const k = state.kpi

  async function undo(a: AiAction) {
    setBusy(a.id)
    try { await onUndo(a) } finally { setBusy(null) }
  }

  const initial = (agent: string) => personOf(agent)[0]

  return (
    <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_460px]">
      <Panel aria-label="What the AI team did today" className="flex min-h-0 flex-col overflow-hidden rounded-[18px] bg-[var(--fm-solid)]">
        <div className="border-b border-line px-[22px] pt-5 pb-3.5">
          <h1 className="text-[24px] font-extrabold tracking-[-0.3px]">What your AI team did today</h1>
          <p className="mt-1.5 text-[14px] text-muted-ink">
            {k.auto_decisions} decisions made by itself
            {k.fuel_savings != null && k.fuel_savings > 0 ? `, €${Math.round(k.fuel_savings)} saved at cheaper stations` : ''}
            , {undone} undone by people. Small, low-risk changes only; anything bigger waits for you.
          </p>
        </div>
        <ol className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          {actions.length === 0 && (
            <li className="px-[22px] py-10 text-center text-muted-ink">
              Nothing yet today. When the AI team assigns, reroutes or books something by itself, it shows up here with an Undo.
            </li>
          )}
          {actions.map(a => {
            const u = a.state === 'undone'
            const on = sel?.id === a.id
            return (
              <li key={a.id}
                className={cn('grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-[color-mix(in_srgb,var(--fm-line)_50%,transparent)] px-[22px] py-3.5 transition-colors hover:bg-chip',
                  on && 'bg-[color-mix(in_srgb,var(--fm-amber-tint)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--fm-amber-tint)_70%,transparent)]')}>
                <div aria-hidden="true" className="flex size-10 items-center justify-center rounded-[12px] bg-chip text-[15px] font-extrabold">{initial(a.agent)}</div>
                <div className="min-w-0">
                  <div className={cn('text-[15px] font-bold', u && 'text-muted-ink line-through')}>{a.text}</div>
                  <div className="mt-0.5 text-[13px] text-muted-ink">{personOf(a.agent)}, {hhmm(a.t)}{a.vehicles.length ? ` · ${a.vehicles.join(', ')}` : ''}</div>
                  {u ? <div className="mt-1 text-[13px] font-bold text-muted-ink">Undone by {a.undone_by?.split(' (')[0] ?? 'you'}: {a.instead}</div>
                    : !a.reversible && <div className="mt-1 text-[13px] font-bold text-[var(--fm-park-text)]">Already done, can’t be undone</div>}
                </div>
                <div className="flex gap-2">
                  <Btn size="sm" className="min-h-10" onClick={() => setSelId(a.id)} aria-pressed={on}>Details</Btn>
                  {a.reversible && !u && (
                    <Btn size="sm" tone="outline" className="min-h-10 bg-[var(--fm-solid)] font-extrabold" disabled={!a.can_undo || busy === a.id}
                      title={undoHint(a, state.me.role) ?? `Undo: ${a.text}`} onClick={() => undo(a)}>
                      {busy === a.id ? 'Undoing…' : 'Undo'}
                    </Btn>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </Panel>

      <Panel aria-label="Decision details" className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-[18px] bg-[var(--fm-solid)] p-[22px] scroll-thin">
        {!sel ? <p className="text-muted-ink">Pick a decision to see why it was made.</p> : (
          <>
            <div className="flex items-center gap-3">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-amber-tint text-[18px] font-extrabold text-amber-text">{initial(sel.agent)}</div>
              <div className="min-w-0">
                <div className="text-[13px] font-bold text-muted-ink">
                  {personOf(sel.agent)} ({TEAM.find(t => t.agent === sel.agent)?.role ?? sel.agent}), {hhmm(sel.t)}
                </div>
                <h2 className={cn('text-[18px] font-extrabold', sel.state === 'undone' && 'text-muted-ink line-through')}>{sel.text}</h2>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sel.state === 'undone' ? <Badge>Undone</Badge> : <Badge tone="good">Applied</Badge>}
              {sel.reversible ? <Badge tone="neutral">Can be undone</Badge> : <Badge tone="neutral">Can’t be undone</Badge>}
              {sel.job && <Badge tone="neutral">Order {sel.job}</Badge>}
            </div>
            <section>
              <h3 className="mb-2 text-[14px] font-extrabold">Why</h3>
              {why.length ? (
                <ul className="flex flex-col gap-2">
                  {why.map(e => (
                    <li key={e.id} className="text-[14px] leading-[1.55] text-[var(--fm-park-text)]">
                      <b className="text-ink">{personOf(e.agent)}</b> <span className="text-[12px] text-muted-ink">{hhmm(e.t)}</span><br />{e.text}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[14px] leading-[1.55] text-muted-ink">The team’s notes from just before this decision are no longer in this browser’s log. Reports → AI decisions keeps them all.</p>}
            </section>
            {sel.vehicles.length > 0 && (
              <section>
                <h3 className="mb-2 text-[14px] font-extrabold">Vehicles</h3>
                <div className="flex flex-wrap gap-2">
                  {sel.vehicles.map(v => <Btn key={v} size="sm" onClick={() => onSelectVehicle(v)}>Show {v} on the map</Btn>)}
                </div>
              </section>
            )}
            {sel.state === 'undone' && (
              <p className="rounded-[12px] bg-chip p-3 text-[14px]"><b>Undone by {sel.undone_by}</b> at {sel.undone_at && hhmm(sel.undone_at)}. {sel.instead}</p>
            )}
            <div className="flex-1" />
            {sel.reversible && sel.state === 'done' && (
              <div className="flex flex-col gap-2">
                <button disabled={!sel.can_undo || busy === sel.id} onClick={() => undo(sel)}
                  className="flex min-h-[46px] items-center justify-center gap-2 rounded-[12px] bg-ink text-[15px] font-extrabold text-[var(--fm-solid)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber disabled:opacity-45">
                  <Undo2 className="size-4" />{busy === sel.id ? 'Undoing…' : 'Undo'}
                </button>
                {undoHint(sel, state.me.role) && <p className="text-[13px] text-muted-ink">{undoHint(sel, state.me.role)}</p>}
              </div>
            )}
            {!sel.reversible && <p className="text-[13px] text-muted-ink">{undoHint(sel, state.me.role)}</p>}
          </>
        )}
      </Panel>
    </div>
  )
}
