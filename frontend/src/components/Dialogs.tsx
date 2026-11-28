import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { TEAM, eur } from '@/lib/fleet'
import type { Approval } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge, Btn } from './fm'

const box = 'glass max-w-[520px] rounded-[22px] border-0 p-6 text-ink sm:max-w-[520px]'

export function ApprovalDialog({ approval, onClose, onDecide }: {
  approval: Approval | null
  onClose: () => void
  onDecide: (a: Approval, optionId: string, approve: boolean) => Promise<void>
}) {
  const [opt, setOpt] = useState<string>('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (approval) setOpt(approval.recommended) }, [approval])
  if (!approval) return null
  const a = approval
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className={box}>
        <DialogTitle className="text-[20px] font-extrabold tracking-[-0.3px]">{a.title}</DialogTitle>
        <DialogDescription className="text-[14px] leading-[1.5] text-muted-ink">{a.summary}</DialogDescription>
        {a.cost_eur != null && <div><Badge tone="neutral">Cost impact up to {eur(a.cost_eur)}</Badge></div>}
        <fieldset className="flex flex-col gap-2" disabled={!a.can_decide || busy}>
          <legend className="sr-only">Options</legend>
          {a.options.map(o => (
            <label key={o.id} className={cn('flex cursor-pointer gap-3 rounded-[16px] border p-3',
              opt === o.id ? 'border-amber bg-amber-tint/50' : 'border-line hover:bg-chip')}>
              <input type="radio" name="opt" value={o.id} checked={opt === o.id} onChange={() => setOpt(o.id)} className="mt-1 accent-[var(--fm-amber)]" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold">{o.label}
                  {o.id === a.recommended && <Badge tone="amber">Recommended</Badge>}</span>
                {o.detail && <span className="block text-[13px] text-muted-ink">{o.detail}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        {Object.keys(a.notes || {}).length > 0 && (
          <details className="text-[13px] text-muted-ink">
            <summary className="cursor-pointer font-bold text-ink">What the AI team said</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {Object.entries(a.notes).map(([agent, note]) => (
                <li key={agent}><b className="text-ink">{TEAM.find(t => t.agent === agent)?.name ?? agent}:</b> {note}</li>
              ))}
            </ul>
          </details>
        )}
        {a.can_decide ? (
          <div className="flex gap-2.5">
            <Btn size="lg" disabled={busy} onClick={async () => { setBusy(true); try { await onDecide(a, opt, false) } finally { setBusy(false) } }}>Reject</Btn>
            <Btn tone="primary" size="lg" className="flex-1" disabled={busy}
              onClick={async () => { setBusy(true); try { await onDecide(a, opt, true) } finally { setBusy(false) } }}>
              Approve: {a.options.find(o => o.id === opt)?.label ?? 'recommended'}
            </Btn>
          </div>
        ) : <p className="rounded-[14px] bg-chip p-3 text-[13px] font-semibold">{a.blocked_reason}</p>}
      </DialogContent>
    </Dialog>
  )
}

export function MessageDialog({ vehicle, driver, onClose, onSend }: {
  vehicle: string | null
  driver: string
  onClose: () => void
  onSend: (text: string) => Promise<void>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  if (!vehicle) return null
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className={box}>
        <DialogTitle className="text-[20px] font-extrabold tracking-[-0.3px]">Message {driver}</DialogTitle>
        <DialogDescription className="text-[13px] text-muted-ink">Shows up on the driver's phone page for {vehicle}.</DialogDescription>
        <form className="flex flex-col gap-3" onSubmit={async e => {
          e.preventDefault()
          if (!text.trim()) return
          setBusy(true)
          try { await onSend(text.trim()); setText('') } finally { setBusy(false) }
        }}>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={500} autoFocus
            placeholder="e.g. Use gate 4 at the Freeport, ramp 3 is closed."
            className="rounded-[14px] border border-line bg-chip p-3 text-[15px] text-ink outline-none focus-visible:border-amber" />
          <Btn tone="primary" size="lg" type="submit" disabled={busy || !text.trim()}>Send to {driver.split(' ')[0]}</Btn>
        </form>
      </DialogContent>
    </Dialog>
  )
}
