// Super admin overview (design/reference/super-admin.reference.html). Real data where the backend has
// it (this company, its vehicles, AI decisions and undos, AI usage cost, routing / weather / AI health,
// users, company settings). Everything else is clearly labelled sample data.
// Super admins support companies; they never approve or undo a company's decisions.
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { eur } from '@/lib/fleet'
import type { FleetState } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Panel, SampleTag } from '@/components/fm'

type Health = 'ok' | 'watch' | 'act' | 'trial'
const HEALTH: Record<Health, { label: string; tint: string; text: string; dot: string }> = {
  ok: { label: 'Healthy', tint: 'var(--fm-good-tint)', text: 'var(--fm-good-text)', dot: 'var(--fm-good)' },
  watch: { label: 'Watch', tint: 'var(--fm-watch-tint)', text: 'var(--fm-watch-text)', dot: 'var(--fm-watch)' },
  act: { label: 'Act now', tint: 'var(--fm-act-tint)', text: 'var(--fm-act-text)', dot: 'var(--fm-act)' },
  trial: { label: 'Trial', tint: 'var(--fm-load-tint)', text: 'var(--fm-load-text)', dot: 'var(--fm-load)' },
}

interface CompanyRow {
  name: string; city: string; users: number | string; plan: string; vehicles: number; monthly: string
  source: string; decisions: number; ai: string; health: Health; sample: boolean
}

// Made-up customers so the table shows what a real platform looks like. Labelled "Sample data".
const SAMPLE_COMPANIES: CompanyRow[] = [
  { name: 'Kurzeme Logistika', city: 'Liepaja', users: 4, plan: 'Full', vehicles: 22, monthly: '€770', source: 'Mapon API', decisions: 98, ai: '€33', health: 'ok', sample: true },
  { name: 'Daugava Trans', city: 'Daugavpils', users: 3, plan: 'On Mapon', vehicles: 18, monthly: '€450', source: 'Mapon API', decisions: 61, ai: '€22', health: 'watch', sample: true },
  { name: 'Vidzeme Piegade', city: 'Valmiera', users: 2, plan: 'Full', vehicles: 9, monthly: '€315', source: 'Phone app', decisions: 40, ai: '€12', health: 'ok', sample: true },
  { name: 'Riga Fresh Vans', city: 'Riga', users: 3, plan: 'Trial', vehicles: 12, monthly: '€0', source: 'Phone app', decisions: 55, ai: '€9', health: 'trial', sample: true },
  { name: 'Ogre Buvmateriali', city: 'Ogre', users: 2, plan: 'Founding', vehicles: 14, monthly: '€350', source: 'Navirec API', decisions: 47, ai: '€15', health: 'ok', sample: true },
]

interface Settings { approval_limit_eur: number; company_name: string }
interface UserRow { username: string; name: string; role: string; trucks: string[] | null }

function providerNote(s: FleetState, p: 'tomtom' | 'here' | 'osrm') {
  const ok = s.routing[`${p}_ok`] ?? 0, fail = s.routing[`${p}_fail`] ?? 0
  const inChain = s.map.chain?.includes(p)
  if (!inChain) return { note: 'No key set', dot: 'var(--fm-park-dot)' }
  if (!ok && !fail) return { note: s.map.chain?.[0] === p ? 'Ready, no routes yet' : 'Standby', dot: 'var(--fm-park-dot)' }
  const rate = fail / (ok + fail)
  return { note: `${ok} ok, ${fail} failed`, dot: rate > 0.3 ? 'var(--fm-act)' : rate > 0.05 ? 'var(--fm-watch)' : 'var(--fm-good)' }
}

export function OverviewPage({ state }: { state: FleetState }) {
  const [filter, setFilter] = useState<'all' | 'ok' | 'watch' | 'trial'>('all')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [users, setUsers] = useState<UserRow[] | null>(null)
  useEffect(() => {
    api<{ settings: Settings }>('/api/settings').then(d => setSettings(d.settings)).catch(() => {})
    api<{ users: UserRow[] }>('/api/users').then(d => setUsers(d.users)).catch(() => {})
  }, [])

  const k = state.kpi
  const undone = state.actions.filter(a => a.state === 'undone').length
  const decisions = k.auto_decisions + k.approvals_done
  const usage = state.agents.usage
  const aiCost = state.agents.mode === 'api' && usage ? `$${usage.cost_usd.toFixed(2)}` : '$0'
  const broken = state.vehicles.filter(v => v.status === 'broken').length
  const basicRoutes = state.vehicles.filter(v => v.route_source === 'fallback').length
  const aiDown = state.agents.mode !== 'rules' && state.agents.errors > 0 && !!state.agents.last_error
  const ownHealth: Health = aiDown || basicRoutes > 2 ? 'act' : broken || state.approvals.length > 2 ? 'watch' : 'ok'

  const own: CompanyRow = {
    name: state.company.name, city: 'Riga', users: users ? users.filter(u => u.role !== 'superadmin').length : '…', plan: 'Demo',
    vehicles: state.vehicles.length, monthly: '—', source: 'Simulator', decisions, ai: aiCost, health: ownHealth, sample: false,
  }
  const rows = [own, ...SAMPLE_COMPANIES].filter(c => filter === 'all' || (filter === 'watch' ? c.health === 'watch' || c.health === 'act' : c.health === filter))

  const tiles: { label: string; value: string; note: string; tone?: 'good' | 'watch'; sample?: boolean }[] = [
    { label: 'Companies', value: '1', note: `plus ${SAMPLE_COMPANIES.length} sample rows below` },
    { label: 'Vehicles connected', value: String(state.vehicles.length), note: broken ? `${broken} broken down now` : 'all reporting', tone: broken ? 'watch' : 'good' },
    { label: 'Monthly revenue', value: '€4,960', note: '+€1,120 vs last month', tone: 'good', sample: true },
    { label: 'AI cost since start', value: aiCost, note: state.agents.mode === 'api' ? `${state.agents.calls} Claude API calls` : state.agents.mode === 'rules' ? 'rules mode, no API cost' : 'Claude Code mode' },
    { label: 'AI decisions today', value: String(decisions), note: `${undone} undone by users` },
    { label: 'Uptime, 30 days', value: '99.96%', note: '1 incident', sample: true },
  ]

  const services = useMemo(() => {
    const out: { name: string; note: string; dot: string; sample?: boolean }[] = [
      { name: 'TomTom routing', ...providerNote(state, 'tomtom') },
      { name: 'HERE (backup)', ...providerNote(state, 'here') },
      { name: 'OSRM (basic roads)', ...providerNote(state, 'osrm') },
      { name: 'Open-Meteo weather', note: state.weather.source === 'offline default' ? 'Not answering, using a default' : `OK, ${state.weather.text}`,
        dot: state.weather.source === 'offline default' ? 'var(--fm-watch)' : 'var(--fm-good)' },
      { name: 'Claude', note: state.agents.mode === 'rules' ? 'Off, rules engine only' : aiDown ? `Errors: ${state.agents.errors}` : `OK, ${state.agents.calls} calls`,
        dot: state.agents.mode === 'rules' ? 'var(--fm-park-dot)' : aiDown ? 'var(--fm-act)' : 'var(--fm-good)' },
      { name: 'Telegram bot', note: 'Not connected yet', dot: 'var(--fm-park-dot)' },
    ]
    return out
  }, [state, aiDown])

  const alerts: { title: string; body: string; tone: 'act' | 'watch' | 'plain'; sample?: boolean }[] = []
  if (aiDown) alerts.push({ title: `${state.company.name}: the AI team isn’t answering`, body: `${state.agents.last_error}. Rules keep running.`, tone: 'act' })
  if (basicRoutes) alerts.push({ title: `${basicRoutes} routes are straight-line estimates`, body: 'No routing service answered for them. Drivers should check bridge heights.', tone: 'watch' })
  if (state.approvals.length) alerts.push({ title: `${state.approvals.length} decision${state.approvals.length === 1 ? '' : 's'} waiting at ${state.company.name}`,
    body: `For ${state.me.admin_name} or their dispatchers. You can look but not decide.`, tone: 'plain' })
  if (k.auto_decisions >= 10 && undone / k.auto_decisions > 0.15)
    alerts.push({ title: `${state.company.name} undo rate is ${Math.round((100 * undone) / k.auto_decisions)}%`, body: 'Usual is under 6%. Their dispatcher may want different limits.', tone: 'plain' })
  alerts.push({ title: 'Riga Fresh Vans trial ends in 3 days', body: '55 decisions a day, 4 undone. Good moment to call them.', tone: 'plain', sample: true })

  const tone = { act: 'bg-act-tint text-act-text', watch: 'bg-watch-tint text-watch-text', plain: 'bg-chip text-ink' }
  const COLS = 'grid-cols-[1.6fr_0.8fr_0.7fr_0.8fr_1fr_0.9fr_0.9fr_1fr]'

  return (
    <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[auto_minmax(0,1fr)] xl:overflow-visible">
      <section aria-label="Platform totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-2 xl:grid-cols-6">
        {tiles.map(t => (
          <Panel key={t.label} className="rounded-[14px] bg-[var(--fm-solid)] px-4 py-3.5">
            <div className="flex items-center justify-between gap-2 text-[13px] font-bold text-muted-ink">{t.label}{t.sample && <SampleTag />}</div>
            <div className="num mt-1 text-[24px]">{t.value}</div>
            <div className={cn('mt-0.5 text-[12px] font-bold', t.tone === 'good' ? 'text-good-text' : t.tone === 'watch' ? 'text-watch-text' : 'text-[var(--fm-park-text)]')}>{t.note}</div>
          </Panel>
        ))}
      </section>

      <Panel aria-label="Customer companies" className="flex min-h-[360px] flex-col overflow-hidden rounded-[18px] bg-[var(--fm-solid)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
          <h1 className="text-[20px] font-extrabold">Companies</h1>
          <div role="group" aria-label="Filter companies" className="flex flex-wrap gap-1.5">
            {([['all', 'All'], ['ok', 'Healthy'], ['watch', 'Needs a look'], ['trial', 'Trials']] as const).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)} aria-pressed={filter === key}
                className={cn('h-8 rounded-full px-3 text-[13px] font-bold', filter === key ? 'bg-ink text-[var(--fm-solid)]' : 'bg-[var(--fm-solid)] text-ink shadow-[inset_0_0_0_1px_var(--fm-line)]')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          <div role="table" aria-label="Companies" className="min-w-[860px]">
            <div role="row" className={cn('grid h-10 items-center gap-2.5 border-b border-line bg-[color-mix(in_srgb,var(--fm-solid),var(--fm-ink)_2%)] px-5 text-[12px] font-bold text-muted-ink', COLS)}>
              {['Company', 'Plan', 'Vehicles', 'Monthly', 'Tracker data', 'AI decisions today', 'AI cost', 'Health'].map(h => <span role="columnheader" key={h}>{h}</span>)}
            </div>
            {rows.map(r => {
              const h = HEALTH[r.health]
              return (
                <div role="row" key={r.name} className={cn('grid min-h-[54px] items-center gap-2.5 border-b border-[color-mix(in_srgb,var(--fm-line)_50%,transparent)] px-5 py-1.5 text-[14px]', COLS, r.sample && 'text-[var(--fm-park-text)]')}>
                  <span role="cell"><b className="text-ink">{r.name}</b>{r.sample && <> <SampleTag /></>}<br /><span className="text-[12px] text-muted-ink">{r.city} · {r.users} users</span></span>
                  <span role="cell"><span className={cn('rounded-full px-2 py-0.5 text-[12px] font-bold', r.plan === 'Founding' ? 'bg-amber-tint text-amber-text' : r.plan === 'Trial' ? 'bg-load-tint text-load-text' : 'bg-chip')}>{r.plan}</span></span>
                  <span role="cell" className="font-bold">{r.vehicles}</span>
                  <span role="cell">{r.monthly}</span>
                  <span role="cell">{r.source}</span>
                  <span role="cell">{r.decisions}</span>
                  <span role="cell">{r.ai}</span>
                  <span role="cell"><span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold" style={{ background: h.tint, color: h.text }}>
                    <span className="size-[7px] rounded-full" style={{ background: h.dot }} />{h.label}</span></span>
                </div>
              )
            })}
          </div>
        </div>
        {settings && (
          <div className="border-t border-line px-5 py-3 text-[13px] text-muted-ink">
            <b className="text-ink">{settings.company_name} settings (read only, for support):</b> dispatcher approval limit {eur(settings.approval_limit_eur)}
            {users && <>, {users.filter(u => u.role === 'employee').map(u => `${u.name} looks after ${u.trucks?.length ?? 0} trucks`).join('; ')}</>}.
          </div>
        )}
      </Panel>

      <aside className="flex min-h-0 flex-col gap-4">
        <Panel aria-label="Integrations" className="rounded-[18px] bg-[var(--fm-solid)] p-[18px]">
          <h2 className="mb-3 text-[16px] font-extrabold">Integrations</h2>
          <ul>
            {services.map(sv => (
              <li key={sv.name} className="flex items-center gap-2.5 border-b border-[color-mix(in_srgb,var(--fm-line)_50%,transparent)] py-2 text-[14px] last:border-0">
                <span className="size-2 shrink-0 rounded-full" style={{ background: sv.dot }} />
                <span className="flex-1 font-bold">{sv.name}</span>
                <span className="text-right text-[13px] text-muted-ink">{sv.note}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel aria-label="Needs your attention" className="flex min-h-0 flex-1 flex-col gap-2.5 rounded-[18px] bg-[var(--fm-solid)] p-[18px]">
          <h2 className="text-[16px] font-extrabold">Needs your attention</h2>
          <ul className="scroll-thin flex min-h-0 flex-col gap-2.5 overflow-y-auto">
            {alerts.map(a => (
              <li key={a.title} className={cn('rounded-[12px] p-3', tone[a.tone])}>
                <div className="flex items-center justify-between gap-2 text-[14px] font-extrabold">{a.title}{a.sample && <SampleTag />}</div>
                <div className="mt-0.5 text-[13px] text-[var(--fm-park-text)]">{a.body}</div>
              </li>
            ))}
          </ul>
        </Panel>
      </aside>
    </div>
  )
}
