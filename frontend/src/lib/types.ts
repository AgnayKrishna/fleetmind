// Shapes returned by the FastAPI backend (backend/app.py, backend/sim.py).

export type Role = 'superadmin' | 'logistics_admin' | 'employee' | 'driver' | 'guest'

export interface User {
  username: string
  name: string
  role: Role
  vehicle_id?: string | null
}

export interface Place { key?: string; name: string; lat: number; lon: number }

export interface Trip {
  destination: string
  remaining_km: number
  eta: string
  deadline?: string
  on_time?: boolean
  late_min?: number
  cargo?: string
  weight?: number
  priority?: string
  pickup?: string
  dropoff?: string
  customer_notified?: boolean
}

export interface EnergyStop {
  id: string
  name: string
  lat: number
  lon: number
  detour_km: number
  near_route: boolean
  sample: boolean
  minutes: number
  cost_eur: number
  price_eur_l?: number
  litres?: number
  saving_eur?: number
  kw?: number
  kwh?: number
  price_eur_kwh?: number
}

export interface Vehicle {
  id: string
  type: 'truck_diesel' | 'van_diesel' | 'truck_ev' | 'van_ev'
  label: string
  driver: string
  status: string
  job_id: string | null
  health: number
  capacity: number
  unit: 'L' | 'kWh'
  fault: string | null
  lat: number
  lon: number
  energy_pct: number
  range_km: number
  service_due_km: number
  drive_today_h: number
  since_break_h: number
  odometer: number
  route: [number, number][]
  trip: Trip | null
  energy_stop: EnergyStop | null
  fuel_stop: string | null
  fuel_stop_sample: boolean
  route_source: string | null
  traffic_delay_min: number
  dims: { height_m: number; width_m: number; length_m: number; weight_kg: number; axles: number }
  speed_factor: number | null
  mine: boolean
}

export interface Job {
  id: string
  pickup: Place
  dropoff: Place
  weight: number
  cargo: string
  priority: 'urgent' | 'normal'
  status: 'pending' | 'assigned' | 'loading' | 'in_transit' | 'delivered'
  vehicle: string | null
  created: number
  window_end: number
  window_end_str: string
  est_km: number
  late: boolean
  customer_notified: boolean
  hazmat?: boolean
  hold?: boolean
  price_eur?: number
  created_by?: string
}

export interface ApprovalOption { id: string; label: string; detail?: string; cost_eur?: number }

export interface Approval {
  id: string
  event: string
  title: string
  summary: string
  options: ApprovalOption[]
  recommended: string
  state: string
  created: string
  notes: Record<string, string>
  cost_eur?: number
  can_decide: boolean
  blocked_reason: string | null
}

export interface LogEntry {
  id: number
  t: string
  agent: string
  kind: string
  text: string
  model: string | null
}

export interface AiAction {
  id: string
  agent: string
  text: string
  t: string
  vehicles: string[]
  job: string | null
  state: 'done' | 'undone'
  reversible: boolean
  can_undo: boolean
  undone_by?: string
  instead?: string
  undone_at?: string
}

export interface Kpi {
  delivered: number
  late: number
  km: number
  diesel_l: number
  kwh: number
  fuel_cost: number | null
  energy_cost: number | null
  co2_kg: number
  penalties: number | null
  repairs: number | null
  fuel_savings: number | null
  auto_decisions: number
  approvals_done: number
  llm_decisions: number
  on_time_pct: number
  total_cost: number | null
  cost_per_km: number | null
  revenue?: number
  profit?: number
}

export interface AgentStatus {
  mode: 'claude' | 'api' | 'rules'
  models: { orchestrator: string; specialist: string }
  calls: number
  errors: number
  last_error?: string | null
  usage?: { input_tokens: number; output_tokens: number; cost_usd: number }
}

export interface FleetState {
  clock: string
  sim: number
  speed: number
  paused: boolean
  vehicles: Vehicle[]
  jobs: Job[]
  kpi: Kpi
  status_counts: Record<string, number>
  weather: { text: string; temp_c: number | null; wind_kmh: number | null; source: string }
  storm: { label: string; until: number } | null
  zones: { id: string; lat: number; lon: number; radius_km: number; label: string }[]
  approvals: Approval[]
  log: LogEntry[]
  history: { t: string; cost?: number; delivered: number; late: number }[]
  prices: Record<string, number | string>
  routing: Record<string, number>
  map: { tomtom_tiles: boolean; attribution: string; provider: string }
  agents: AgentStatus
  agent_roles: Record<string, string>
  key_required: boolean
  user: User
  me: { role: Role; trucks: string[] | null; approval_limit_eur: number | null; can_write: boolean; admin_name: string }
  company: { name: string }
  actions: AiAction[]
  gtm_kpi: { leads: number; sent: number; replies: number; opens: number } | null
}
