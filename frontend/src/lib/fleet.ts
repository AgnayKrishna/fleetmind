// Shared rules: the six vehicle statuses from DESIGN.md, agent names, roles, money formatting.
import type { FleetState, Role, Vehicle } from './types'

export type StatusKey = 'route' | 'loading' | 'parked' | 'risk' | 'act' | 'nosignal'

export const STATUS: Record<StatusKey, { label: string; dot: string; tint: string; text: string }> = {
  route: { label: 'On route', dot: 'var(--fm-good)', tint: 'var(--fm-good-tint)', text: 'var(--fm-good-text)' },
  loading: { label: 'Loading', dot: 'var(--fm-load)', tint: 'var(--fm-load-tint)', text: 'var(--fm-load-text)' },
  parked: { label: 'Parked', dot: 'var(--fm-park-dot)', tint: 'var(--fm-park-tint)', text: 'var(--fm-park-text)' },
  risk: { label: 'Delay risk', dot: 'var(--fm-watch)', tint: 'var(--fm-watch-tint)', text: 'var(--fm-watch-text)' },
  act: { label: 'Act now', dot: 'var(--fm-act)', tint: 'var(--fm-act-tint)', text: 'var(--fm-act-text)' },
  nosignal: { label: 'No signal', dot: 'var(--fm-muted)', tint: 'transparent', text: 'var(--fm-park-text)' },
}
export const STATUS_ORDER: StatusKey[] = ['act', 'risk', 'route', 'loading', 'parked', 'nosignal']

const MOVING = ['to_pickup', 'to_dropoff', 'to_depot', 'to_fuel', 'routing']

export function statusOf(v: Vehicle): StatusKey {
  if (v.status === 'broken') return 'act'
  if (v.trip && v.trip.cargo && v.trip.on_time === false) return 'risk'
  if (v.status === 'loading' || v.status === 'unloading') return 'loading'
  if (MOVING.includes(v.status)) return 'route'
  return 'parked'
}

export const isMoving = (v: Vehicle) => MOVING.includes(v.status) && v.status !== 'routing'

/** What the vehicle is doing, in plain words. */
export const DOING: Record<string, string> = {
  to_pickup: 'Driving to pickup', to_dropoff: 'Delivering', to_depot: 'Back to depot', to_fuel: 'To fuel or charger',
  routing: 'Planning route', loading: 'Loading', unloading: 'Unloading', idle: 'Free', break: 'Driver break',
  refuel: 'Refuelling or charging', broken: 'Broken down', service: 'In service',
}

export const VEHICLE_COLOR: Record<Vehicle['type'], string> = {
  truck_diesel: 'var(--fm-v-diesel)', van_diesel: 'var(--fm-v-van)',
  truck_ev: 'var(--fm-v-ev-truck)', van_ev: 'var(--fm-v-ev-van)',
}
export const isTruck = (v: Pick<Vehicle, 'type'>) => v.type.startsWith('truck')

/** The AI team: backend agent name -> person in the UI. */
export const TEAM: { agent: string; name: string; role: string; superOnly?: boolean }[] = [
  { agent: 'Orchestrator', name: 'Atlas', role: 'Lead' },
  { agent: 'Dispatch Agent', name: 'Dina', role: 'Dispatch' },
  { agent: 'Maintenance Agent', name: 'Max', role: 'Maintenance' },
  { agent: 'Route Agent', name: 'Ruta', role: 'Routes' },
  { agent: 'Fuel & Cost Agent', name: 'Leo', role: 'Fuel and cost' },
  { agent: 'GTM Agent', name: 'Gita', role: 'Sales outreach', superOnly: true },
]
export const personOf = (agent: string) => TEAM.find(t => t.agent === agent)?.name ?? (agent === 'Fleet manager' ? 'You' : agent)

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: 'Super admin', logistics_admin: 'Company admin', employee: 'Dispatcher', driver: 'Driver', guest: 'Guest',
}

export const can = {
  write: (r?: Role) => r === 'logistics_admin' || r === 'employee',
  admin: (r?: Role) => r === 'logistics_admin',
  sim: (r?: Role) => r === 'logistics_admin' || r === 'superadmin',
  history: (r?: Role) => r === 'logistics_admin' || r === 'superadmin' || r === 'guest',
  gtm: (r?: Role) => r === 'superadmin',
}

export const eur = (v: number | null | undefined, digits = 0) =>
  v == null ? '—' : '€' + v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export const hhmm = (clock: string) => clock.slice(-5)

export const LOW_ENERGY_PCT = 20

export interface AttentionItem {
  key: string
  tone: 'act' | 'watch' | 'amber'
  title: string
  detail: string
  action?: { label: string; kind: 'approval' | 'energy' | 'vehicle' | 'job'; id: string }
  sample?: boolean
  vehicle?: string
}

/** "Needs you": only things a human should look at, each with one clear action. */
export function attention(s: FleetState, canWrite: boolean): AttentionItem[] {
  const out: AttentionItem[] = []
  for (const a of s.approvals)
    out.push({ key: 'a' + a.id, tone: 'act', title: a.title, detail: a.summary,
      action: { label: a.can_decide ? 'Review' : 'View', kind: 'approval', id: a.id } })
  const inApproval = (id: string) => s.approvals.some(a => `${a.title} ${a.summary}`.includes(id))
  for (const v of s.vehicles) {
    if (v.status === 'broken' && !inApproval(v.id))
      out.push({ key: 'b' + v.id, tone: 'act', title: `${v.id} broke down`, detail: v.fault ?? 'Waiting for repair.',
        action: { label: 'Show', kind: 'vehicle', id: v.id }, vehicle: v.id })
    const t = v.trip
    if (t && t.cargo && t.on_time === false)
      out.push({ key: 'l' + v.id, tone: 'watch', title: `${v.job_id} running ${t.late_min} min late`,
        detail: `${v.id} to ${t.dropoff}, deadline ${t.deadline}.`, action: { label: 'Show', kind: 'vehicle', id: v.id },
        vehicle: v.id })
    if (v.energy_pct < LOW_ENERGY_PCT && !v.fuel_stop && !['refuel', 'broken', 'service'].includes(v.status)) {
      const st = canWrite && v.mine ? v.energy_stop : null
      const ev = v.unit === 'kWh'
      out.push({ key: 'e' + v.id, tone: 'amber', title: `${v.id} low on ${ev ? 'charge' : 'fuel'}`,
        detail: st ? `${v.energy_pct}% left. ${st.name}, +${st.detour_km} km` + (ev ? `, ${st.kw} kW.`
          : `, €${st.price_eur_l?.toFixed(2)}/L${(st.saving_eur ?? 0) > 0 ? `, saves €${st.saving_eur}` : ''}.`)
          : `${v.energy_pct}% left, about ${v.range_km} km.`,
        action: st ? { label: ev ? `Charge now · ${st.minutes} min` : 'Refuel now', kind: 'energy', id: v.id }
          : { label: 'Show', kind: 'vehicle', id: v.id }, sample: !!st?.sample, vehicle: v.id })
    }
  }
  for (const j of s.jobs)
    if (j.status === 'pending' && j.window_end < s.sim)
      out.push({ key: 'o' + j.id, tone: 'watch', title: `${j.id} not picked up`,
        detail: `${j.pickup.name}, was due ${j.window_end_str}.`, action: { label: 'Show', kind: 'job', id: j.id } })
  return out
}
