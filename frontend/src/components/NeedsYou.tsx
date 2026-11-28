import { useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { attention, type AttentionItem } from '@/lib/fleet'
import type { FleetState } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Panel, SampleTag } from './fm'

const DOT = { act: 'var(--fm-act)', watch: 'var(--fm-watch)', amber: 'var(--fm-amber)' }

/** Left panel: only the things a human should decide or look at, one clear button each. */
export function NeedsYou({ state, canWrite, compact, onAction, className, style }: {
  state: FleetState
  canWrite: boolean
  compact: boolean          // lite mode: top 2 and "Show N more"
  onAction: (item: AttentionItem) => void | Promise<void>
  className?: string
  style?: CSSProperties
}) {
  const items = attention(state, canWrite)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const reduce = useReducedMotion()
  const shown = compact && !expanded ? items.slice(0, 2) : items
  const k = state.kpi
  const today = k.auto_decisions + k.approvals_done + state.approvals.length

  return (
    <Panel aria-label="Needs you" style={style}
      className={cn('flex min-h-0 flex-col gap-1.5', compact ? 'rounded-[14px] p-3.5' : 'p-[18px]', className)}>
      {compact ? (
        <div className="flex items-center justify-between px-1 pb-1">
          <h2 className="text-[16px] font-extrabold">Needs you</h2>
          {items.length > 0 && <span className="rounded-full bg-act-tint px-2.5 py-0.5 text-[12px] font-extrabold text-act-text">{items.length}</span>}
        </div>
      ) : (
        <div className="flex items-baseline justify-between px-1 pb-2">
          <h2 className="text-[20px] font-extrabold tracking-[-0.3px]">Needs you</h2>
          <span className="text-[13px] text-muted-ink">{items.length ? `${items.length} of ${today} decisions today` : `${today} decisions today`}</span>
        </div>
      )}
      {items.length === 0 && (
        <div className="rounded-[16px] bg-[var(--fm-card)] p-4">
          <p className="text-[15px] font-bold">All clear</p>
          <p className="mt-0.5 text-[13px] leading-[1.45] text-muted-ink">Nothing needs you right now. Low-risk decisions are applied by the AI team.</p>
        </div>
      )}
      <div className="scroll-thin -mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto px-1">
        <AnimatePresence initial={false}>
          {shown.map((it, i) => (
            <motion.div key={it.key} layout={!reduce} initial={reduce ? false : { opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }} transition={{ duration: 0.22 }}
              className={cn('flex gap-3',
                compact ? cn('rounded-[10px] p-2.5', it.tone === 'act' ? 'bg-act-tint' : 'bg-chip') : 'rounded-[16px] p-3',
                !compact && i === 0 && 'bg-[var(--fm-card)]')}>
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full"
                style={{ background: DOT[it.tone], boxShadow: i === 0 && it.tone === 'act' ? '0 0 0 5px var(--fm-act-tint)' : undefined }} />
              <div className="min-w-0 flex-1">
                <div className={cn('font-bold leading-snug', compact ? 'text-[14px]' : 'text-[15px]',
                  compact && it.tone === 'act' && 'font-extrabold text-act-text')}>{it.title}</div>
                <div className={cn('mt-0.5 line-clamp-2 leading-[1.45] text-muted-ink', compact ? 'text-[12px]' : 'text-[13px]')}>{it.detail}</div>
                {it.sample && <div className="mt-1"><SampleTag /></div>}
              </div>
              {it.action && (
                <button disabled={busy === it.key}
                  onClick={async () => { setBusy(it.key); try { await onAction(it) } finally { setBusy(null) } }}
                  className="min-h-9 self-center rounded-[10px] border border-line px-3 text-[13px] font-bold whitespace-nowrap text-ink hover:bg-chip focus-visible:outline-2 focus-visible:outline-amber disabled:opacity-50">
                  {busy === it.key ? 'Working…' : it.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {compact && items.length > 2 && (
        <button onClick={() => setExpanded(e => !e)} className="mt-1 min-h-9 rounded-[10px] bg-chip text-[13px] font-bold text-ink hover:brightness-95">
          {expanded ? 'Show less' : `Show ${items.length - 2} more`}
        </button>
      )}
    </Panel>
  )
}
