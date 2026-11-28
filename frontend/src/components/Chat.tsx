import { useEffect, useRef, useState } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Btn, Dots } from './fm'

interface Msg { me: boolean; text: string; model?: string }

/** "Ask the AI team": chat with Atlas (the Orchestrator) about the live fleet. */
export function Chat({ open, question, onClose }: { open: boolean; question: { text: string; key: number } | null; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([{ me: false, text: 'Ask me about the fleet. Try "Which jobs are at risk?", "How much did fuel cost?" or "What is LV-T03 doing?"' }])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  async function ask(text: string) {
    setMsgs(m => [...m, { me: true, text }])
    setBusy(true)
    try {
      const r = await api<{ answer: string; model: string }>('/api/chat', { message: text })
      setMsgs(m => [...m, { me: false, text: r.answer, model: r.model }])
    } catch (e) {
      setMsgs(m => [...m, { me: false, text: e instanceof Error ? e.message : "Couldn't reach the backend." }])
    } finally { setBusy(false) }
  }

  useEffect(() => { if (question) ask(question.text) }, [question?.key])     // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy])

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }}>
      <SheetContent side="right" className="glass flex w-full flex-col gap-0 border-0 p-0 text-ink sm:max-w-[420px]">
        <div className="border-b border-line p-5">
          <SheetTitle className="text-[20px] font-extrabold tracking-[-0.3px]">Ask the AI team</SheetTitle>
          <SheetDescription className="text-[13px] text-muted-ink">Atlas answers from the live fleet data.</SheetDescription>
        </div>
        <div className="scroll-thin flex flex-1 flex-col gap-2.5 overflow-y-auto p-5" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={cn('max-w-[88%] rounded-[16px] px-3.5 py-2.5 text-[14px] leading-[1.5]',
              m.me ? 'self-end bg-amber-tint text-ink' : 'self-start bg-chip')}>
              {m.text}
              {m.model && <div className="mt-1 text-[11px] text-muted-ink">{m.model}</div>}
            </div>
          ))}
          {busy && <div className="self-start rounded-[16px] bg-chip px-3.5 py-2.5 text-[14px]">Thinking <Dots /></div>}
          <div ref={end} />
        </div>
        <form className="flex gap-2 border-t border-line p-4" onSubmit={e => { e.preventDefault(); if (q.trim()) { ask(q.trim()); setQ('') } }}>
          <label htmlFor="chat-in" className="sr-only">Your question</label>
          <input id="chat-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Ask about the fleet" autoComplete="off"
            className="min-h-11 flex-1 rounded-[14px] bg-chip px-3 text-[15px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-amber" />
          <Btn tone="primary" type="submit" disabled={busy || !q.trim()}>Send</Btn>
        </form>
      </SheetContent>
    </Sheet>
  )
}
