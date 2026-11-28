import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Badge, Btn, Panel } from '@/components/fm'

interface Lead {
  id: string; name: string; city: string; email: string; website: string; status: 'draft' | 'approved' | 'sent' | 'replied'
  opens: number; last_open: string | null
  draft: { score: number; reason: string; subject: string; body: string; model: string; site_read?: boolean } | null
}
interface GtmData { leads: Lead[]; kpi: { leads: number; sent: number; replies: number; opens: number }; progress: { running: boolean; done: number; todo: number } }

const TONE = { draft: 'neutral', approved: 'amber', sent: 'load', replied: 'good' } as const

const gmail = (l: Lead) => 'https://mail.google.com/mail/?view=cm&to=' + encodeURIComponent(l.email) +
  '&su=' + encodeURIComponent(l.draft?.subject ?? '') + '&body=' + encodeURIComponent(l.draft?.body ?? '')

/** GTM outreach (superadmin only): pilot leads and the drafted emails. Nothing is ever sent automatically. */
export function GtmPage() {
  const [data, setData] = useState<GtmData | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = () => api<GtmData>('/api/gtm').then(setData).catch(() => {})
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t) }, [])
  const setStatus = async (id: string, status: string) => { await api(`/api/gtm/${id}/status`, { status }); load() }

  if (!data) return <Panel className="p-6 text-muted-ink">Loading leads…</Panel>
  const n = (s: string) => data.leads.filter(l => l.status === s).length
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Panel className="flex flex-wrap items-baseline gap-x-6 gap-y-1 p-5">
        <h1 className="text-[20px] font-extrabold tracking-[-0.3px]">Pilot leads</h1>
        <span className="text-[13px] text-muted-ink">
          Draft {n('draft')} · Approved {n('approved')} · Sent {n('sent')} · Replied {n('replied')} · Demo opens {data.kpi.opens}
          {data.progress.running && ` · researching ${data.progress.done}/${data.progress.todo}…`}
        </span>
      </Panel>
      <Panel className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col">
          {data.leads.map(l => {
            const d = l.draft
            const isOpen = open === l.id
            return (
              <li key={l.id} className="border-b border-line p-3 last:border-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={cn('num flex size-10 items-center justify-center rounded-full bg-chip text-[15px]',
                    d && d.score >= 8 && 'bg-good-tint text-good-text')} title="Fit score">{d ? d.score : '…'}</span>
                  <div className="min-w-[200px] flex-1">
                    <div className="text-[15px] font-bold">{l.name}</div>
                    <div className="text-[13px] text-muted-ink">{l.city}{l.opens ? ` · ${l.opens} demo open${l.opens > 1 ? 's' : ''}` : ''}</div>
                  </div>
                  <Badge tone={TONE[l.status]}>{l.status}</Badge>
                  <Btn size="sm" disabled={!d} onClick={() => setOpen(isOpen ? null : l.id)}>{isOpen ? 'Hide email' : 'View email'}</Btn>
                  {d && <a href={gmail(l)} target="_blank" rel="noopener"
                    onClick={() => { if (l.status === 'draft') setStatus(l.id, 'approved') }}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] bg-amber px-3 text-[13px] font-extrabold text-on-amber">
                    Open in Gmail <ExternalLink className="size-3.5" /></a>}
                  <Btn size="sm" disabled={l.status === 'sent' || l.status === 'replied'} onClick={() => setStatus(l.id, 'sent')}>Mark sent</Btn>
                  <Btn size="sm" disabled={l.status === 'replied'} onClick={() => setStatus(l.id, 'replied')}>Mark replied</Btn>
                </div>
                {isOpen && d && (
                  <div className="mt-3 flex flex-col gap-2 rounded-[16px] bg-chip p-4 text-[13px]">
                    <p className="text-muted-ink">{d.reason} <span className="text-[12px]">({d.model}{d.site_read ? ', website read' : ''})</span></p>
                    <p><span className="text-muted-ink">To</span> {l.email}</p>
                    <p><span className="text-muted-ink">Subject</span> <b>{d.subject}</b></p>
                    <pre className="font-sans text-[13px] leading-[1.5] whitespace-pre-wrap">{d.body}</pre>
                    <div className="flex flex-wrap gap-2">
                      <Btn size="sm" onClick={async () => {
                        try { await navigator.clipboard.writeText(`To: ${l.email}\nSubject: ${d.subject}\n\n${d.body}`); setCopied(l.id) } catch { setCopied(null) }
                        setTimeout(() => setCopied(null), 1500)
                      }}>{copied === l.id ? 'Copied' : 'Copy'}</Btn>
                      {l.status === 'draft' ? <Btn size="sm" onClick={() => setStatus(l.id, 'approved')}>Approve</Btn>
                        : <Btn size="sm" onClick={() => setStatus(l.id, 'draft')}>Back to draft</Btn>}
                      <a className="inline-flex min-h-9 items-center rounded-[10px] px-3 font-bold hover:bg-chip" href={l.website} target="_blank" rel="noopener">Website</a>
                    </div>
                    <p className="text-[12px] text-muted-ink">Nothing is sent automatically. Send it yourself from Gmail, then mark it sent.</p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </Panel>
    </div>
  )
}
