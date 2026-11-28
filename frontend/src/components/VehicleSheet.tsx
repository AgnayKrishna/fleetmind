import { motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { DOING, statusOf } from '@/lib/fleet'
import type { Approval, Vehicle } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Btn, Panel, SampleTag, StatusChip } from './fm'
import { VehicleGlyph } from './VehicleSymbols'

/** Bolt-style bottom sheet for the selected vehicle, with one full-width amber primary action. */
export function VehicleSheet({ v, approval, canWrite, compact, onClose, onMessage, onEnergy, onReview, className }: {
  v: Vehicle
  approval: Approval | null          // a pending decision about this vehicle
  canWrite: boolean
  compact: boolean
  onClose: () => void
  onMessage: () => void
  onEnergy: () => Promise<void>
  onReview: (a: Approval) => void
  className?: string
}) {
  const reduce = useReducedMotion()
  const t = v.trip
  const first = v.driver.split(' ')[0]
  const energyBtn = canWrite && v.mine && v.energy_stop
  const st = v.energy_stop
  let primary: { label: string; run: () => void } | null = null
  if (approval && approval.can_decide) primary = { label: `Review: ${approval.title}`, run: () => onReview(approval) }
  else if (energyBtn && st) primary = { label: v.unit === 'kWh' ? `Charge at ${st.name} · ${st.minutes} min` : `Refuel at ${st.name} · €${st.price_eur_l?.toFixed(2)}/L`, run: () => { onEnergy() } }
  else if (canWrite) primary = { label: `Message ${first}`, run: onMessage }

  return (
    <motion.div initial={reduce ? false : { y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }} className={className}>
      <Panel aria-label={`Selected vehicle ${v.id}`} className={cn('flex flex-col gap-3.5 rounded-[26px] px-[22px] pt-3 pb-5', compact && 'gap-2.5 pb-4')}>
        <div className="mx-auto h-[5px] w-10 rounded-full bg-[var(--fm-line)]" aria-hidden="true" />
        <div className="flex flex-wrap items-center gap-[18px]">
          {!compact && <VehicleGlyph v={v} size="lg" />}
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[22px] font-extrabold tracking-[-0.4px]">{v.id}</span>
              <StatusChip status={statusOf(v)} />
              {t?.cargo && (t.on_time ? <Badge tone="good">Arrives on time</Badge> : <Badge tone="watch">Late by {t.late_min} min</Badge>)}
              {t?.priority === 'urgent' && <Badge tone="act">Urgent</Badge>}
            </div>
            <div className="mt-1 text-[14px] text-muted-ink">
              {v.driver} · {v.label} · {DOING[v.status] ?? v.status}
              {t ? ` · ${t.remaining_km} km to ${t.destination}` : ''} · {Math.max(0, 9 - v.drive_today_h).toFixed(1)} h driving left today
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-ink">
              <span>{v.unit === 'kWh' ? 'Battery' : 'Fuel'} <b className={cn('text-ink', v.energy_pct < 20 && 'text-act-text')}>{v.energy_pct}%</b> · {v.range_km} km</span>
              <span>Health <b className="text-ink">{v.health}%</b></span>
              {t?.cargo && <span>{t.cargo} · {t.weight?.toLocaleString()} kg</span>}
              {v.fault && <span className="font-semibold text-act-text">{v.fault}</span>}
              {v.fuel_stop && <span>Stop at {v.fuel_stop} {v.fuel_stop_sample && <SampleTag />}</span>}
            </div>
          </div>
          {t && (
            <div className="text-right">
              <div className="num text-[26px]">{t.eta}</div>
              <div className="text-[13px] text-muted-ink">{t.deadline ? `deadline ${t.deadline}` : 'arrival'}</div>
            </div>
          )}
          <button onClick={onClose} aria-label="Close" className="flex size-10 items-center justify-center self-start rounded-[12px] text-muted-ink hover:bg-chip">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {canWrite && primary?.run !== onMessage && <Btn size="lg" onClick={onMessage}>Message {first}</Btn>}
          {energyBtn && primary?.label.startsWith('Review') && (
            <Btn size="lg" onClick={() => { onEnergy() }}>{v.unit === 'kWh' ? 'Charge now' : 'Refuel now'}</Btn>
          )}
          {approval && !approval.can_decide && <p className="self-center text-[13px] text-muted-ink">{approval.blocked_reason}</p>}
          {primary && <Btn tone="primary" size="lg" className="flex-[1_1_220px] text-[16px]" onClick={primary.run}>{primary.label}</Btn>}
        </div>
      </Panel>
    </motion.div>
  )
}
