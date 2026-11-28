// Dispatcher home, "My shift" (design/reference/dispatcher-shift.reference.html): their assigned trucks,
// Needs you with approvals up to their limit (bigger ones go to the company admin), and driver messages.
import { MessageSquare } from 'lucide-react'
import { attention, DOING, eur, hhmm, statusOf, VEHICLE_COLOR, type AttentionItem } from '@/lib/fleet'
import type { Approval, FleetState, LogEntry } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Btn, Panel, SampleTag, StatusChip } from '@/components/fm'

export function ShiftPage({ state, log, onSelectVehicle, onReview, onAttention, onMessage }: {
  state: FleetState
  log: LogEntry[]
  onSelectVehicle: (id: string) => void
  onReview: (a: Approval) => void
  onAttention: (it: AttentionItem) => void | Promise<void>
  onMessage: (vehicle: string) => void
}) {
  const mine = new Set(state.me.trucks ?? state.vehicles.map(v => v.id))
  const trucks = state.vehicles.filter(v => mine.has(v.id))
    .sort((a, b) => ['act', 'risk', 'loading', 'route', 'parked', 'nosignal'].indexOf(statusOf(a)) - ['act', 'risk', 'loading', 'route', 'parked', 'nosignal'].indexOf(statusOf(b)) || a.id.localeCompare(b.id))
  const limit = state.me.approval_limit_eur
  const admin = state.me.admin_name
  const about = (text: string) => [...mine].some(id => text.includes(id))
  const approvals = state.approvals.filter(a => about(`${a.title} ${a.summary}`) || a.can_decide)
  const others = attention(state, true).filter(it => it.action?.kind !== 'approval' && (!it.vehicle || mine.has(it.vehicle)))
  const msgs = log.filter(e => e.agent === 'Fleet manager' && /messaged the driver of|reported a problem on/.test(e.text) && about(e.text))
    .slice(-30).reverse()

  return (
    <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)_340px] lg:overflow-visible xl:grid-cols-[360px_minmax(0,1fr)_380px]">
      <Panel aria-label="My trucks" className="flex min-h-0 flex-col gap-2 rounded-[18px] bg-[var(--fm-solid)] p-[18px]">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[18px] font-extrabold">My trucks</h2>
          <span className="text-[13px] text-muted-ink">{trucks.length} of {state.vehicles.length}</span>
        </div>
        <p className="mb-1.5 text-[13px] text-muted-ink">Assigned to you. Ask {admin} to change them.</p>
        <ul className="scroll-thin -mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
          {trucks.length === 0 && <li className="py-3 text-[13px] text-muted-ink">No trucks assigned to you yet.</li>}
          {trucks.map(v => {
            const st = statusOf(v)
            return (
              <li key={v.id} className={cn('group flex items-center rounded-[10px] hover:bg-chip', st === 'act' && 'bg-[color-mix(in_srgb,var(--fm-act-tint)_55%,transparent)]')}>
                <button onClick={() => onSelectVehicle(v.id)} title={`Show ${v.id} on the map`}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-amber">
                  <span className="h-3 w-[22px] shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.15)]" style={{ background: VEHICLE_COLOR[v.type] }} />
                  <span className="w-16 shrink-0 text-[14px] font-extrabold">{v.id}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--fm-park-text)]">
                    {v.trip ? `${DOING[v.status] ?? v.status}, ${v.trip.destination}` : DOING[v.status] ?? v.status}
                  </span>
                  <StatusChip status={st} />
                </button>
                <button onClick={() => onMessage(v.id)} aria-label={`Message ${v.driver} (${v.id})`} title={`Message ${v.driver}`}
                  className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-[10px] text-muted-ink hover:bg-chip hover:text-ink focus-visible:outline-2 focus-visible:outline-amber">
                  <MessageSquare className="size-4" />
                </button>
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel aria-label="Needs you" className="flex min-h-0 flex-col gap-3 rounded-[18px] bg-[var(--fm-solid)] p-5">
        <div>
          <h1 className="text-[22px] font-extrabold">Needs you</h1>
          <p className="mt-1 text-[14px] text-muted-ink">
            {limit != null ? `You can approve changes up to ${eur(limit)} cost impact. Bigger ones go to ${admin}, the company admin.`
              : 'Decisions for a person, one clear button each.'}
          </p>
        </div>
        <div className="scroll-thin -mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1 pb-1">
          {approvals.length === 0 && others.length === 0 && (
            <p className="rounded-[14px] bg-chip p-4 text-[14px]"><b>All clear on your trucks.</b> <span className="text-muted-ink">Low-risk decisions are applied by the AI team.</span></p>
          )}
          {approvals.map((a, i) => {
            const pick = a.options.find(o => o.id === a.recommended)
            return (
              <article key={a.id} className={cn('rounded-[14px] p-4', i === 0 ? 'bg-[var(--fm-solid)] shadow-[inset_0_0_0_2px_var(--fm-act)]' : 'bg-chip')}>
                <div className="flex justify-between gap-3">
                  <div className="text-[16px] font-extrabold">{a.title}</div>
                  <span className="text-[12px] whitespace-nowrap text-muted-ink">{hhmm(a.created)}</span>
                </div>
                <p className="mt-1.5 text-[14px] leading-[1.5] text-[var(--fm-park-text)]">{a.summary}</p>
                <p className={cn('mt-2 text-[13px] font-bold', a.can_decide ? 'text-good-text' : 'text-watch-text')}>
                  {a.can_decide ? (a.cost_eur != null ? `Cost impact ${eur(a.cost_eur)}, within your limit` : 'Within your limit')
                    : a.blocked_reason ?? `Sent to ${admin} for approval`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {a.can_decide && <Btn tone="primary" onClick={() => onReview(a)}>{pick ? pick.label : 'Review'}</Btn>}
                  <Btn tone="outline" onClick={() => onReview(a)}>{a.can_decide ? 'See other options' : 'View'}</Btn>
                </div>
              </article>
            )
          })}
          {others.map(it => (
            <article key={it.key} className="flex items-start gap-3 rounded-[14px] bg-chip p-4">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: it.tone === 'act' ? 'var(--fm-act)' : it.tone === 'watch' ? 'var(--fm-watch)' : 'var(--fm-amber)' }} />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-extrabold">{it.title}</div>
                <p className="mt-0.5 text-[14px] text-[var(--fm-park-text)]">{it.detail}</p>
                {it.sample && <div className="mt-1"><SampleTag /></div>}
              </div>
              {it.action && <Btn tone="outline" className="self-center bg-[var(--fm-solid)]" onClick={() => onAttention(it)}>{it.action.label}</Btn>}
            </article>
          ))}
        </div>
      </Panel>

      <Panel aria-label="Driver messages" className="flex min-h-0 flex-col gap-2.5 rounded-[18px] bg-[var(--fm-solid)] p-[18px]">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[18px] font-extrabold">Driver messages</h2>
          <span className="text-[13px] text-muted-ink">your trucks</span>
        </div>
        <p className="text-[12px] text-muted-ink">Messages you sent and problems drivers reported from their phone page. Telegram isn’t connected yet.</p>
        <ul className="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {msgs.length === 0 && <li className="text-[13px] text-muted-ink">No messages yet this shift.</li>}
          {msgs.map(m => {
            const problem = m.text.includes('reported a problem')
            return (
              <li key={m.id} className={cn('rounded-[12px] p-3', problem ? 'bg-act-tint' : 'bg-chip')}>
                <div className="flex justify-between text-[13px]"><b>{problem ? 'Driver report' : 'You sent'}</b><span className="text-muted-ink">{hhmm(m.t)}</span></div>
                <p className="mt-1 text-[14px]">{m.text}</p>
              </li>
            )
          })}
        </ul>
        <p className="text-[12px] text-muted-ink">To message a driver, use the speech bubble next to their truck.</p>
      </Panel>
    </div>
  )
}
