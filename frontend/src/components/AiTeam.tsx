import { useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'
import { TEAM, hhmm } from '@/lib/fleet'
import type { FleetState, LogEntry } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Dots, Panel } from './fm'

function simMinutes(clock: string) {   // "Day 2 07:15" -> minutes since day 1 00:00
  const m = /Day (\d+) (\d\d):(\d\d)/.exec(clock)
  return m ? (Number(m[1]) - 1) * 1440 + Number(m[2]) * 60 + Number(m[3]) : 0
}

const short = (t: string, n = 64) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t)

/** Right panel: Atlas, Dina, Max, Ruta and Leo with a live one-line status, then their activity. */
export function AiTeam({ state, log, showGtm, rail, className, style }: {
  state: FleetState
  log: LogEntry[]
  showGtm: boolean
  rail: boolean            // lite mode: a 56 px icon rail with status dots
  className?: string
  style?: CSSProperties
}) {
  const [filter, setFilter] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const team = TEAM.filter(t => !t.superOnly || showGtm)
  const now = state.sim
  const last = useMemo(() => {
    const m = new Map<string, LogEntry>()
    for (const e of log) m.set(e.agent, e)
    return m
  }, [log])
  const status = (agent: string) => {
    const e = last.get(agent)
    if (agent === 'Orchestrator' && state.approvals.length)
      return { text: state.approvals.length === 1 ? 'Waiting for your approval' : `${state.approvals.length} decisions waiting for you`, amber: true, busy: false }
    if (!e) return { text: 'Watching the fleet', amber: false, busy: false }
    return { text: short(e.text), amber: false, busy: now - simMinutes(e.t) <= 3 }
  }
  const feed = log.filter(e => !filter || e.agent === filter).slice(-60).reverse()

  if (rail) {
    return (
      <Panel aria-label="Your AI team" style={style} className={cn('flex w-14 flex-col items-center gap-2 rounded-[14px] py-2', className)}>
        {team.map(t => {
          const s = status(t.agent)
          return (
            <div key={t.agent} role="img" aria-label={`${t.name}, ${s.text}`} title={`${t.name} (${t.role}): ${s.text}`}
              className="relative flex size-10 items-center justify-center rounded-[12px] bg-chip text-[14px] font-extrabold">
              {t.name[0]}
              {/* waiting for you = violet ("needs watching"); amber never shows a status */}
              <span className="absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-[var(--fm-solid)]"
                style={{ background: s.amber ? 'var(--fm-watch)' : s.busy ? 'var(--fm-good)' : 'var(--fm-park-dot)' }} />
            </div>
          )
        })}
      </Panel>
    )
  }

  return (
    <Panel aria-label="Your AI team" style={style} className={cn('flex min-h-0 flex-col gap-3.5 p-[18px]', className)}>
      <h2 className="px-1 text-[20px] font-extrabold tracking-[-0.3px]">Your AI team</h2>
      <ul className="flex flex-col gap-3.5">
        {team.map(t => {
          const s = status(t.agent)
          const on = filter === t.agent
          return (
            <li key={t.agent}>
              <button onClick={() => { setFilter(on ? null : t.agent); setOpen(true) }} aria-pressed={on}
                title={on ? 'Show everyone' : `Show only ${t.name}'s activity`}
                className={cn('flex w-full items-center gap-3 rounded-[14px] text-left transition-opacity',
                  filter && !on && 'opacity-55', 'focus-visible:outline-2 focus-visible:outline-amber')}>
                <div className={cn('flex size-[38px] shrink-0 items-center justify-center rounded-full font-extrabold',
                  t.name === 'Atlas' ? 'bg-amber text-on-amber' : 'bg-chip', on && t.name !== 'Atlas' && 'bg-amber-tint text-amber-text')}>{t.name[0]}</div>
                <div className="min-w-0">
                  <div className="text-[14px] font-bold">{t.name} <span className="font-medium text-muted-ink">{t.role}</span></div>
                  <div className={cn('truncate text-[13px]', s.amber ? 'font-semibold text-amber-text' : 'text-muted-ink')}>
                    {s.text}{s.busy && <> <Dots /></>}
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col border-t border-line pt-2">
        <button onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="flex min-h-9 items-center justify-between rounded-[10px] px-1 text-[13px] font-bold text-muted-ink hover:text-ink">
          <span>{filter ? `${TEAM.find(t => t.agent === filter)?.name}'s activity` : 'Activity'}</span>
          <span className="flex items-center gap-2">
            {filter && <span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); setFilter(null) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setFilter(null) } }}
              className="rounded-full bg-chip px-2 py-0.5 text-[12px] text-ink">All agents</span>}
            <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />
          </span>
        </button>
        {open && (
          <ol className="scroll-thin flex min-h-0 flex-col gap-2 overflow-y-auto px-1 pt-1" aria-live="polite">
            {feed.length === 0 && <li className="text-[13px] text-muted-ink">Nothing yet. New entries show up here.</li>}
            {feed.map(e => (
              <li key={e.id} className="text-[13px] leading-[1.45]">
                <span className="font-bold">{TEAM.find(t => t.agent === e.agent)?.name ?? (e.agent === 'Fleet manager' ? 'People' : e.agent)}</span>
                <span className="ml-1.5 text-[12px] text-muted-ink">{hhmm(e.t)}</span>
                <p className={cn('text-muted-ink', e.kind === 'alert' && 'text-act-text')}>{e.text}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  )
}
