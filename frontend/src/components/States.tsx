// Empty, offline and error states (design/reference/states.reference.html). The screen never goes
// blank: it says what fell back and what to watch out for.
import { RefreshCw, WifiOff } from 'lucide-react'
import { toast } from 'sonner'
import type { FleetState } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Btn, Panel } from './fm'

export interface QueuedChange { path: string; body: unknown; label: string }

/** Dark banner while the backend can't be reached. Writes queue up and send on reconnect. */
export function OfflineBanner({ since, queued, onRetry, className }: {
  since: string | null
  queued: QueuedChange[]
  onRetry: () => void
  className?: string
}) {
  return (
    <div role="status" className={cn('pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[16px] bg-[#18191C] px-4 py-3 text-[14px] font-bold text-[#F1EFEA] shadow-[var(--fm-shadow)] dark:bg-[#F1EFEA] dark:text-[#18191C]', className)}>
      <WifiOff className="size-[18px] shrink-0" aria-hidden="true" />
      <span>You're offline.{since ? ` Positions are from ${since}.` : ''}</span>
      {queued.length > 0 && (
        <span className="font-semibold opacity-80" title={queued.map(q => q.label).join(', ')}>
          {queued.length} {queued.length === 1 ? 'change' : 'changes'} waiting to send: {queued.map(q => q.label).slice(0, 3).join(', ')}{queued.length > 3 ? '…' : ''}
        </span>
      )}
      <span className="flex-1" />
      <button onClick={onRetry}
        className="flex min-h-9 items-center gap-1.5 rounded-[10px] border border-current/25 px-3 text-[13px] font-extrabold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-amber">
        <RefreshCw className="size-3.5" />Try to reconnect
      </button>
    </div>
  )
}

export interface ServiceAlert { key: string; title: string; text: string; tone: 'watch' | 'act' }

const MOVING = ['to_pickup', 'to_dropoff', 'to_depot', 'to_fuel']

/** What fell back, from the live data: routing provider, AI team, live weather. */
export function serviceAlerts(s: FleetState): ServiceAlert[] {
  const out: ServiceAlert[] = []
  const moving = s.vehicles.filter(v => MOVING.includes(v.status) && v.route_source)
  const basic = moving.filter(v => v.route_source === 'fallback')
  const wantsTruckRouting = s.map.chain?.some(p => p === 'tomtom' || p === 'here')
  const osrm = moving.filter(v => v.route_source === 'osrm')
  if (basic.length) {
    out.push({ key: 'route-basic', tone: 'watch', title: 'Truck routing is unavailable',
      text: `No routing service is answering, so ${basic.length === 1 ? `${basic[0].id}'s route is a` : `${basic.length} routes are`} straight-line estimate${basic.length === 1 ? '' : 's'} for now. Check bridge heights and weight limits before sending trucks.` })
  } else if (wantsTruckRouting && osrm.length) {
    out.push({ key: 'route-osrm', tone: 'watch', title: 'Truck routing fell back to basic roads',
      text: `${s.map.chain?.includes('tomtom') ? 'TomTom' : 'HERE'} isn't responding, so ${osrm.length} route${osrm.length === 1 ? '' : 's'} use OpenStreetMap roads without truck limits or live traffic.` })
  }
  const a = s.agents
  if (a.mode !== 'rules' && a.errors > 0 && a.last_error) {
    out.push({ key: 'ai', tone: 'watch', title: 'The AI team isn’t answering',
      text: 'The rules engine keeps dispatching and rerouting. Anything bigger waits for you in Needs you.' })
  }
  if (s.weather.source === 'offline default') {
    out.push({ key: 'weather', tone: 'watch', title: 'Live weather is unavailable',
      text: 'Weather shows a default. Snow and storm warnings won’t come in by themselves until it’s back.' })
  }
  return out
}

export function ServiceAlerts({ alerts, onDismiss, className }: { alerts: ServiceAlert[]; onDismiss: (key: string) => void; className?: string }) {
  if (!alerts.length) return null
  return (
    <div className={cn('pointer-events-auto flex flex-col gap-2', className)}>
      {alerts.map(a => (
        <Panel key={a.key} role="alert" className="flex items-start gap-3 rounded-[14px] p-3.5 text-[14px]">
          <span className="mt-[5px] size-2.5 shrink-0 rounded-full" style={{ background: a.tone === 'act' ? 'var(--fm-act)' : 'var(--fm-watch)' }} />
          <div className="min-w-0 flex-1"><b>{a.title}</b><br /><span className="text-[var(--fm-park-text)]">{a.text}</span></div>
          <button onClick={() => onDismiss(a.key)} className="min-h-8 rounded-[8px] px-2 text-[13px] font-bold text-muted-ink hover:bg-chip">Got it</button>
        </Panel>
      ))}
    </div>
  )
}

/** No vehicles yet: three ways to connect one. */
export function EmptyFleet({ className }: { className?: string }) {
  const ways: [string, string][] = [
    ['Tracker in the truck', 'Teltonika or similar, plugs into the FMS port'],
    ['Your current GPS system', 'Mapon, or the truck maker’s own portal'],
    ['Driver’s phone', 'The driver page from a Telegram link, nothing to install'],
  ]
  return (
    <Panel aria-label="No trucks connected yet" className={cn('flex w-[420px] max-w-[calc(100%-24px)] flex-col overflow-hidden rounded-[22px]', className)}>
      <div className="flex h-[180px] items-center justify-center bg-[var(--fm-bg)]" aria-hidden="true">
        <svg width="100%" height="180" viewBox="0 0 440 180">
          <g stroke="var(--fm-road)" strokeWidth="10" fill="none" strokeLinecap="round"><path d="M0 90H440" /><path d="M150 0V180" /><path d="M0 20L440 170" /></g>
          <g transform="translate(220 90)">
            <circle r="34" fill="none" stroke="var(--fm-park-dot)" strokeWidth="2" strokeDasharray="5 5" />
            <rect x="-20" y="-9" width="40" height="18" rx="4" fill="none" stroke="var(--fm-park-dot)" strokeWidth="2" strokeDasharray="4 3" />
          </g>
        </svg>
      </div>
      <div className="flex flex-col gap-3.5 p-6">
        <h2 className="text-[22px] font-extrabold">Connect your first truck</h2>
        <p className="text-[15px] leading-[1.5] text-[var(--fm-park-text)]">Your map fills in as soon as one vehicle sends its position. Pick the way that fits your fleet:</p>
        <ul className="flex flex-col gap-2 text-[14px]">
          {ways.map(([t, d]) => <li key={t} className="rounded-[12px] bg-chip p-3"><b>{t}</b><br /><span className="text-muted-ink">{d}</span></li>)}
        </ul>
        <Btn tone="primary" size="lg" className="text-[16px]"
          onClick={() => toast('Connecting real trackers isn’t built yet. This demo runs a simulated fleet.')}>Connect a truck</Btn>
      </div>
    </Panel>
  )
}

/** The first load failed: never a blank screen. */
export function LoadError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <Panel role="alert" className="flex w-[420px] max-w-[calc(100%-24px)] flex-col gap-3 p-6">
      <h2 className="text-[20px] font-extrabold">{error ? 'Can’t reach FleetMind' : 'Loading the fleet…'}</h2>
      {error && <>
        <p className="text-[14px] leading-[1.5] text-[var(--fm-park-text)]">
          The server didn’t answer ({error}). If it was asleep it can take up to a minute to wake up. The AI team keeps working on the server.
        </p>
        <Btn tone="outline" size="lg" onClick={onRetry}><RefreshCw className="size-4" />Try again</Btn>
      </>}
    </Panel>
  )
}
