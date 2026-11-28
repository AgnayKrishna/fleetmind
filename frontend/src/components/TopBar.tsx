import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { FlaskConical, LogOut, Moon, Search, Sparkles, Sun, Pause, Play, Gauge } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { can, eur, ROLE_LABEL, STATUS, statusOf, type StatusKey } from '@/lib/fleet'
import type { FleetState, User } from '@/lib/types'
import { Logo, Panel } from './fm'
import { VehicleGlyph } from './VehicleSymbols'

export type Page = 'shift' | 'map' | 'fleet' | 'orders' | 'activity' | 'reports' | 'gtm'

const NAV: { id: Page; label: string; show?: (u: User) => boolean }[] = [
  { id: 'shift', label: 'My shift', show: u => u.role === 'employee' },
  { id: 'map', label: 'Map' }, { id: 'fleet', label: 'Fleet' }, { id: 'orders', label: 'Orders' },
  { id: 'activity', label: 'AI activity' }, { id: 'reports', label: 'Reports', show: u => can.history(u.role) },
  { id: 'gtm', label: 'GTM', show: u => can.gtm(u.role) },
]

const EVENTS = [
  { type: 'traffic', label: 'Traffic jam', hint: 'Ruta reroutes around it' },
  { type: 'weather', label: 'Snowstorm', hint: 'Live weather plus an escalation' },
  { type: 'breakdown', label: 'Breakdown', hint: 'Needs a decision' },
  { type: 'urgent_order', label: 'Urgent order', hint: 'Dina re-plans' },
]

function StatusPills({ state }: { state: FleetState }) {
  const n = { route: 0, risk: 0, act: 0 }
  for (const v of state.vehicles) {
    const s = statusOf(v)
    if (s === 'route' || s === 'risk' || s === 'act') n[s]++
  }
  const pills: [StatusKey, string][] = [['route', `${n.route} on route`], ['risk', `${n.risk} delay risk`], ['act', `${n.act} act now`]]
  return (
    <div className="hidden gap-1.5 lg:flex" aria-label="Fleet status">
      {pills.map(([k, label]) => (
        <span key={k} className="rounded-full px-2.5 py-1.5 text-[13px] font-bold whitespace-nowrap"
          style={{ background: STATUS[k].tint, color: STATUS[k].text }}>{label}</span>
      ))}
    </div>
  )
}

export function TopBar({ state, user, page, onPage, onSelectVehicle, onAsk, onEvent, onControl, theme, onTheme, onLogout, extra,
  lite, liteAuto, liteReason, onLite, onLiteReset }: {
  state: FleetState | null
  user: User
  page: Page
  onPage: (p: Page) => void
  onSelectVehicle: (id: string) => void
  onAsk: (q: string) => void
  onEvent: (type: string) => void
  onControl: (action: string, value?: number) => void
  theme: 'light' | 'dark'
  onTheme: () => void
  onLogout: () => void
  extra?: ReactNode
  lite: boolean
  liteAuto: boolean
  liteReason: string | null
  onLite: () => void
  onLiteReset: () => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t || !state) return []
    return state.vehicles.filter(v => v.id.toLowerCase().includes(t) || v.id.toLowerCase().replace('lv-', '') === t
      || v.driver.toLowerCase().includes(t) || (v.job_id ?? '').toLowerCase() === t).slice(0, 6)
  }, [q, state])
  const options = [...matches.map(v => ({ kind: 'v' as const, id: v.id })), ...(q.trim() && can.write(user.role) ? [{ kind: 'ask' as const, id: q.trim() }] : [])]

  function choose(i: number) {
    const o = options[i]
    if (!o) return
    if (o.kind === 'v') onSelectVehicle(o.id)
    else onAsk(o.id)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  const k = state?.kpi
  const c = state?.status_counts ?? {}
  const onRoad = (c.to_pickup || 0) + (c.to_dropoff || 0) + (c.to_depot || 0) + (c.to_fuel || 0)
  const stats: [string, string][] = state && k ? [
    [`${onRoad}`, `/${state.vehicles.length} on the road`],
    [`${k.on_time_pct}%`, ' on time'],
    ...(k.fuel_cost != null ? [[eur((k.fuel_cost ?? 0) + (k.energy_cost ?? 0)), ' fuel today'] as [string, string]] : []),
    [`${k.delivered}`, ' delivered'],
  ] : []
  const initials = user.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <Panel className={cn('pointer-events-auto flex flex-wrap items-center gap-2 lg:gap-3',
      lite ? 'min-h-14 rounded-none border-x-0 border-t-0 px-4 py-1.5' : 'py-2.5 pr-3 pl-4')}>
      <div className="flex items-center gap-2.5">
        <Logo />
        <span className="text-[18px] font-extrabold tracking-[-0.3px]">FleetMind</span>
        {user.role === 'superadmin' && <span className="rounded-full bg-amber px-2.5 py-0.5 text-[12px] font-extrabold text-on-amber">Super admin</span>}
        {user.role === 'employee' && <span className="hidden rounded-full bg-load-tint px-2.5 py-0.5 text-[12px] font-extrabold text-load-text 2xl:inline">Dispatcher</span>}
        {user.role === 'guest' && <span className="rounded-full bg-chip px-2.5 py-0.5 text-[12px] font-bold text-muted-ink">Guest · read only</span>}
      </div>

      <nav aria-label="Screens" className="flex gap-0.5 rounded-[14px] bg-chip p-1">
        {NAV.filter(n => !n.show || n.show(user)).map(n => (
          <button key={n.id} onClick={() => onPage(n.id)} aria-current={page === n.id ? 'page' : undefined}
            className={cn('min-h-9 rounded-[10px] px-3 text-[13px] font-bold transition-colors',
              page === n.id ? 'bg-solid text-ink shadow-[0_1px_2px_rgba(24,25,28,.08)]' : 'text-muted-ink hover:text-ink')}>
            {n.label}
          </button>
        ))}
      </nav>

      <div className="relative min-w-[200px] flex-[1_1_220px] max-w-[420px]">
        <label htmlFor="cmd" className="sr-only">Search trucks or ask the AI team</label>
        <div className="flex items-center gap-2.5 rounded-[14px] bg-chip px-3.5 py-2.5">
          <Search className="size-4 text-muted-ink" aria-hidden="true" />
          <input id="cmd" ref={input} value={q} autoComplete="off" role="combobox" aria-expanded={open && options.length > 0}
            aria-controls="cmd-list" placeholder={can.write(user.role) ? 'Search trucks or ask the AI team' : 'Search trucks and drivers'}
            onChange={e => { setQ(e.target.value); setOpen(true); setHi(0) }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, options.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); choose(hi) }
              else if (e.key === 'Escape') { setQ(''); input.current?.blur() }
            }}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-muted-ink" />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 text-[12px] font-bold text-muted-ink">Ctrl K</kbd>
        </div>
        {open && options.length > 0 && (
          <ul id="cmd-list" role="listbox" className="glass absolute top-[calc(100%+6px)] right-0 left-0 z-30 rounded-[16px] p-1.5">
            {options.map((o, i) => {
              const v = o.kind === 'v' ? state?.vehicles.find(x => x.id === o.id) : null
              return (
                <li key={o.kind + o.id} role="option" aria-selected={i === hi}
                  onMouseDown={e => { e.preventDefault(); choose(i) }} onMouseEnter={() => setHi(i)}
                  className={cn('flex cursor-pointer items-center gap-3 rounded-[12px] px-2.5 py-2', i === hi && 'bg-chip')}>
                  {v ? <><VehicleGlyph v={v} size="sm" angle={0} /><span className="font-bold">{v.id}</span>
                    <span className="truncate text-[13px] text-muted-ink">{v.driver} · {v.label}</span></>
                    : <><Sparkles className="size-4 text-amber-text" /><span className="truncate">Ask the AI team: <b>{o.id}</b></span></>}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="hidden flex-1 lg:block" />
      {lite ? state && <StatusPills state={state} /> : (
        <div className="hidden gap-1.5 xl:flex" aria-label="Key numbers">
          {stats.map(([b, t]) => (
            <span key={t} className="rounded-[12px] bg-chip px-3 py-2 text-[13px] whitespace-nowrap">
              <b className="num text-[15px]">{b}</b><span className="text-muted-ink">{t}</span>
            </span>
          ))}
        </div>
      )}

      {extra}

      <Tooltip>
        <TooltipTrigger asChild>
          <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] border border-line px-3 text-[13px] font-bold select-none">
            <Switch checked={lite} onCheckedChange={onLite} aria-label="Lite mode" />
            <span className="hidden sm:inline">Lite mode</span>
          </label>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          {liteAuto
            ? (liteReason ? `On by itself: ${liteReason.toLowerCase()}.` : 'Off: this screen and computer can run the full map.')
            : 'You set this. To let FleetMind decide again, use the account menu.'}
        </TooltipContent>
      </Tooltip>

      {(can.admin(user.role) || can.sim(user.role)) && (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Simulate events and speed"
            className="flex size-10 items-center justify-center rounded-[12px] bg-chip text-ink outline-none focus-visible:outline-2 focus-visible:outline-amber">
            <FlaskConical className="size-[18px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 rounded-[16px] p-1.5">
            {can.admin(user.role) && <>
              <DropdownMenuLabel>Simulate an event</DropdownMenuLabel>
              {EVENTS.map(e => (
                <DropdownMenuItem key={e.type} onSelect={() => onEvent(e.type)} className="flex-col items-start gap-0 rounded-[10px] py-2">
                  <span className="font-bold">{e.label}</span><span className="text-[12px] text-muted-ink">{e.hint}</span>
                </DropdownMenuItem>
              ))}
            </>}
            {can.sim(user.role) && <>
              {can.admin(user.role) && <DropdownMenuSeparator />}
              <DropdownMenuLabel>Demo clock {state ? `· ${state.clock}` : ''}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => onControl(state?.paused ? 'resume' : 'pause')} className="rounded-[10px]">
                {state?.paused ? <Play className="size-4" /> : <Pause className="size-4" />}{state?.paused ? 'Resume' : 'Pause'}
              </DropdownMenuItem>
              {[1, 2, 5].map(x => (
                <DropdownMenuItem key={x} onSelect={() => onControl('speed', x)} className="rounded-[10px]">
                  <Gauge className="size-4" />{x}× speed{state?.speed === x ? ' ✓' : ''}
                </DropdownMenuItem>
              ))}
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <button onClick={onTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        className="flex size-10 items-center justify-center rounded-[12px] bg-chip text-ink focus-visible:outline-2 focus-visible:outline-amber">
        {theme === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger aria-label={`Account: ${user.name}`}
          className="flex size-10 items-center justify-center rounded-full bg-amber-tint text-[14px] font-extrabold text-amber-text outline-none focus-visible:outline-2 focus-visible:outline-amber">
          {initials}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60 rounded-[16px] p-1.5">
          <DropdownMenuLabel className="flex flex-col">
            <span className="text-[14px] font-bold text-ink">{user.name}</span>
            <span className="text-[12px] font-medium text-muted-ink">{ROLE_LABEL[user.role]}{state?.company ? ` · ${state.company.name}` : ''}</span>
            {state?.me.approval_limit_eur != null && <span className="text-[12px] font-medium text-muted-ink">You approve up to €{state.me.approval_limit_eur}</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {!liteAuto && <DropdownMenuItem onSelect={onLiteReset} className="rounded-[10px]"><Gauge className="size-4" />Lite mode: let FleetMind decide</DropdownMenuItem>}
          <DropdownMenuItem onSelect={onLogout} className="rounded-[10px]"><LogOut className="size-4" />Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Panel>
  )
}
