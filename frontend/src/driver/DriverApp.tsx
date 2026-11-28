// Driver phone page (design/reference/driver.reference.html), opened from a Telegram link, no install.
// Today: driving time left with break warning, current job (amber outline) with Navigate and the one
// button that fits the job state, later stops, Report a problem, Start break, LV / RU / EN.
// Delivery: photos, receiver, signature, damaged or missing, big amber Delivered. Works offline: actions
// wait on the phone and send when there is signal. The server checks the job state again every time.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, ChevronLeft, Navigation, WifiOff } from 'lucide-react'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { api, ApiError, logout, me, onLoginRequired } from '@/lib/api'
import type { User } from '@/lib/types'
import { Login } from '@/components/Login'
import { cn } from '@/lib/utils'
import { LANGS, LOCALE, savedLang, STRINGS, type Lang } from './i18n'

interface DriverView {
  vehicle: { id: string; label: string; driver: string; status: string; energy_pct: number; unit: 'L' | 'kWh'; range_km: number
    health: number; fault: string | null; drive_today_h: number; hours_left_h: number; since_break_h: number }
  job: { id: string; cargo: string; weight: number; priority: string; status: string; pickup: string; dropoff: string; deadline: string; hazmat: boolean } | null
  next_stop: { action: string; name: string; lat: number; lon: number } | null
  trip: { destination: string; remaining_km: number; eta: string; deadline?: string; on_time?: boolean; late_min?: number } | null
  allowed: { arrived: boolean; loaded: boolean; delivered: boolean; break: boolean }
  messages: { id: number; from: string; text: string; t: string }[]
  clock: string
}

interface Pending { action: 'arrived' | 'loaded' | 'delivered' | 'break'; proof?: Proof; at: number }
interface Proof { receiver: string; signed: boolean; photos: number; damaged: boolean; note: string }

const DAY_H = 9
const BREAK_AFTER_H = 4.5
const QUEUE_KEY = 'fmDriverQueue'

function readQueue(): Pending[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
function writeQueue(q: Pending[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)) } catch { /* not kept */ }
}

const place = (n: string) => n.replace(/\s*\(.*\)$/, '')
const hm = (h: number, t: typeof STRINGS.en) => `${Math.floor(h)} ${t.hoursUnit} ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`

export default function DriverApp() {
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)
  const [lang, setLangState] = useState<Lang>(savedLang)
  const t = STRINGS[lang]
  const [d, setD] = useState<DriverView | null>(null)
  const [offline, setOffline] = useState(false)
  const [queue, setQueue] = useState<Pending[]>(readQueue)
  const [screen, setScreen] = useState<'today' | 'delivery'>('today')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)   // null = form closed
  const flushing = useRef(false)

  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const setLang = (l: Lang) => { setLangState(l); try { localStorage.setItem('fmLang', l) } catch { /* not kept */ } }

  useEffect(() => {
    me().then(u => { setUser(u); setBooting(false) })
    return onLoginRequired(() => setUser(null))
  }, [])

  const refresh = useCallback(async () => {
    try {
      setD(await api<DriverView>('/api/driver/me'))
      setOffline(false)
    } catch (e) {
      if (!(e instanceof ApiError)) setOffline(true)
    }
  }, [])

  // send what waited on the phone, oldest first; the server re-checks each one
  const flush = useCallback(async () => {
    if (flushing.current) return
    const q = readQueue()
    if (!q.length) return
    flushing.current = true
    const left: Pending[] = []
    for (const p of q) {
      try { await api('/api/driver/action', { action: p.action, proof: p.proof }); toast.success(t.sent) }
      catch (e) {
        if (e instanceof ApiError) toast.error(e.message)      // refused: don't retry forever
        else left.push(p)
      }
    }
    writeQueue(left)
    setQueue(left)
    flushing.current = false
    refresh()
  }, [refresh, t.sent])

  useEffect(() => {
    if (!user || user.role !== 'driver') return
    refresh()
    flush()
    const timer = window.setInterval(() => { refresh(); flush() }, 3000)
    const online = () => { refresh(); flush() }
    window.addEventListener('online', online)
    return () => { window.clearInterval(timer); window.removeEventListener('online', online) }
  }, [user, refresh, flush])

  async function act(action: Pending['action'], proof?: Proof) {
    setBusy(true)
    try {
      await api('/api/driver/action', { action, proof })
      toast.success(t.sent)
      if (action === 'delivered') setScreen('today')
      refresh()
    } catch (e) {
      if (e instanceof ApiError) toast.error(e.message)
      else {
        const q = [...readQueue(), { action, proof, at: Date.now() }]
        writeQueue(q)
        setQueue(q)
        toast(t.savedOffline)
        if (action === 'delivered') setScreen('today')
      }
    } finally { setBusy(false) }
  }

  async function sendProblem() {
    setBusy(true)
    try {
      await api('/api/driver/problem', { note: problem ?? '' })
      toast.success(t.reported)
      setProblem(null)
      refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  if (booting) return null
  if (!user) return <Login onSignedIn={setUser} />
  if (user.role !== 'driver') {
    return (
      <Shell>
        <div className="m-4 rounded-[18px] bg-[var(--fm-solid)] p-5">
          <p className="text-[15px]">{t.notDriver}</p>
          <a href="index.html" className="mt-3 flex min-h-12 items-center justify-center rounded-[14px] bg-amber font-extrabold text-on-amber">{t.openDashboard}</a>
        </div>
      </Shell>
    )
  }

  const langBtn = (
    <div className="flex gap-1" role="group" aria-label="Language">
      {LANGS.map(l => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
          className={cn('h-[34px] min-w-[40px] rounded-full border px-2.5 text-[13px] font-extrabold uppercase',
            lang === l ? 'border-ink bg-ink text-[var(--fm-solid)]' : 'border-line bg-[var(--fm-solid)] text-ink')}>{l}</button>
      ))}
    </div>
  )

  if (!d) {
    return <Shell><Header title={t.loading} sub="" right={langBtn} />{offline && <OfflineNote t={t} queued={queue.length} />}</Shell>
  }

  const v = d.vehicle
  if (screen === 'delivery' && d.job) {
    return <Delivery d={d} t={t} busy={busy} offline={offline} onBack={() => setScreen('today')}
      onDelivered={proof => act('delivered', proof)} langBtn={langBtn} />
  }

  const date = new Date().toLocaleDateString(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'short' })
  const left = Math.max(0, v.hours_left_h)
  const breakIn = Math.max(0, BREAK_AFTER_H - v.since_break_h)
  const pending = (a: Pending['action']) => queue.some(q => q.action === a)
  const n = d.next_stop
  const j = d.job
  const mainBtn = d.allowed.delivered ? { label: t.handOver, run: () => setScreen('delivery') }
    : d.allowed.loaded ? { label: t.loaded, run: () => act('loaded') }
    : d.allowed.arrived ? { label: t.arrived, run: () => act('arrived') } : null

  const later: { what: string; note: string }[] = []
  if (j && ['assigned', 'loading'].includes(j.status) && v.status !== 'unloading') later.push({ what: `${t.deliverTo} ${place(j.dropoff)}`, note: `${t.arriveBy} ${j.deadline} · ${t.photosSignature}` })
  if (j || v.status === 'to_depot') later.push({ what: t.backToDepot, note: v.energy_pct < 20 ? t.fuelStop : '' })

  return (
    <Shell>
      <Header title={`${t.today}, ${v.id}`} sub={date} right={langBtn} />
      {offline && <OfflineNote t={t} queued={queue.length} />}

      <section className="mx-4 flex flex-col gap-2 rounded-[14px] bg-[var(--fm-solid)] px-3.5 py-3">
        <div className="flex justify-between gap-2 text-[14px]">
          <b>{hm(left, t)} {t.drivingLeft}</b>
          <span className={cn('text-muted-ink', breakIn < 0.5 && 'font-bold text-watch-text')}>
            {v.status === 'break' ? t.onBreak : breakIn < 0.25 ? t.breakNow : `${t.breakDueIn} ${hm(breakIn, t)}`}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded bg-chip" aria-hidden="true">
          <div className="h-2" style={{ width: `${Math.min(100, (left / DAY_H) * 100)}%`, background: left < 1 ? 'var(--fm-watch)' : 'var(--fm-good)' }} />
        </div>
      </section>

      <article className="mx-4 mt-3 flex flex-col gap-2 rounded-[18px] bg-[var(--fm-solid)] p-4 shadow-[inset_0_0_0_2px_var(--fm-amber)]">
        {j ? <>
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full bg-amber-tint px-2.5 py-1 text-[12px] font-extrabold text-amber-text">{t.now} · {j.id}</span>
            {j.priority === 'urgent' && <span className="rounded-full bg-act-tint px-2.5 py-1 text-[12px] font-extrabold text-act-text">{t.urgent}</span>}
            {j.hazmat && <span className="rounded-full bg-watch-tint px-2.5 py-1 text-[12px] font-extrabold text-watch-text">{t.hazmat}</span>}
          </div>
          <h2 className="text-[20px] leading-tight font-extrabold">{n ? `${n.action}: ${place(n.name)}` : `${place(j.pickup)} → ${place(j.dropoff)}`}</h2>
          <p className="text-[14px] leading-[1.5] text-[var(--fm-park-text)]">{j.cargo} · {j.weight.toLocaleString(LOCALE[lang])} kg · {place(j.pickup)} → {place(j.dropoff)}</p>
          {d.trip && (
            <p className="text-[14px]">
              <b>{d.trip.eta}</b> · {d.trip.remaining_km} {t.kmLeft}
              {d.trip.deadline && <> · {t.arriveBy} {d.trip.deadline} · <b className={d.trip.on_time === false ? 'text-act-text' : 'text-good-text'}>
                {d.trip.on_time === false ? `${d.trip.late_min} ${t.late}` : t.onTime}</b></>}
            </p>
          )}
          {v.fault && <p className="text-[14px] font-bold text-act-text">{v.fault}</p>}
          <div className="mt-1 flex gap-2">
            {n && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${n.lat},${n.lon}&travelmode=driving`} target="_blank" rel="noreferrer"
                className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-ink text-[16px] font-extrabold text-[var(--fm-solid)]">
                <Navigation className="size-4" />{t.navigate}
              </a>
            )}
            {mainBtn && (
              <button onClick={mainBtn.run} disabled={busy || (mainBtn.label !== t.handOver && pending(d.allowed.loaded ? 'loaded' : 'arrived'))}
                className="min-h-[52px] flex-1 rounded-[14px] bg-amber px-2 text-[16px] font-extrabold text-on-amber disabled:opacity-50">
                {mainBtn.label}
              </button>
            )}
          </div>
        </> : <>
          <h2 className="text-[20px] font-extrabold">{t.noJob}</h2>
          <p className="text-[14px] text-[var(--fm-park-text)]">{t.noJobBody}</p>
        </>}
      </article>

      {later.length > 0 && <>
        <h3 className="px-5 pt-4 pb-1.5 text-[15px] font-extrabold">{t.later}</h3>
        <ul className="mx-4 overflow-hidden rounded-[16px] bg-[var(--fm-solid)]">
          {later.map(l => (
            <li key={l.what} className="border-b border-[color-mix(in_srgb,var(--fm-line)_50%,transparent)] px-3.5 py-3 last:border-0">
              <span className="text-[14px] font-bold">{l.what}</span>{l.note && <><br /><span className="text-[12px] text-muted-ink">{l.note}</span></>}
            </li>
          ))}
        </ul>
      </>}

      {d.messages.length > 0 && <>
        <h3 className="px-5 pt-4 pb-1.5 text-[15px] font-extrabold">{t.fromDispatch}</h3>
        <ul className="mx-4 flex flex-col gap-2">
          {d.messages.slice().reverse().map(m => (
            <li key={m.id} className="rounded-[14px] bg-[var(--fm-solid)] p-3 text-[14px]">
              <div className="flex justify-between text-[12px] text-muted-ink"><b className="text-ink">{m.from}</b>{m.t.slice(-5)}</div>{m.text}
            </li>
          ))}
        </ul>
      </>}

      <div className="flex-1" />
      {problem !== null ? (
        <form className="mx-4 mt-4 flex flex-col gap-2 rounded-[16px] bg-[var(--fm-solid)] p-3" onSubmit={e => { e.preventDefault(); sendProblem() }}>
          <label className="text-[14px] font-bold">{t.whatsWrong}
            <textarea value={problem} onChange={e => setProblem(e.target.value)} rows={3} maxLength={300} autoFocus
              className="mt-1 w-full rounded-[12px] border border-line bg-chip p-2.5 text-[16px] font-normal outline-none focus-visible:border-amber" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setProblem(null)} className="min-h-[50px] flex-1 rounded-[14px] border border-line font-bold">{t.cancel}</button>
            <button type="submit" disabled={busy} className="min-h-[50px] flex-1 rounded-[14px] bg-act font-extrabold text-white disabled:opacity-50">{t.send}</button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2 px-4 pt-3 pb-7">
          <button onClick={() => setProblem('')} disabled={v.status === 'broken'}
            className="min-h-[50px] flex-1 rounded-[14px] border-2 border-act bg-[var(--fm-solid)] px-2 text-[15px] font-extrabold text-act-text disabled:border-line disabled:text-muted-ink">
            {v.status === 'broken' ? t.reported : t.report}
          </button>
          <button onClick={() => act('break')} disabled={busy || !d.allowed.break || pending('break')}
            className="min-h-[50px] flex-1 rounded-[14px] border border-line bg-[var(--fm-solid)] text-[15px] font-bold disabled:opacity-50">
            {v.status === 'break' ? t.onBreak : t.startBreak}
          </button>
        </div>
      )}
      <button onClick={async () => { await logout(); setUser(null) }} className="mx-auto mb-6 text-[13px] font-bold text-muted-ink underline">{t.signOut}</button>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-[480px] flex-col bg-[color-mix(in_srgb,var(--fm-ink)_4%,var(--fm-bg))] pt-[max(12px,env(safe-area-inset-top))] text-ink">
      {children}
      <Toaster position="top-center" />
    </div>
  )
}

function Header({ title, sub, right }: { title: string; sub: string; right?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-3 px-5 pt-2 pb-3">
      <div className="min-w-0">
        {sub && <div className="text-[13px] font-bold text-muted-ink first-letter:uppercase">{sub}</div>}
        <h1 className="text-[24px] leading-tight font-extrabold tracking-[-0.3px]">{title}</h1>
      </div>
      {right}
    </header>
  )
}

function OfflineNote({ t, queued }: { t: typeof STRINGS.en; queued: number }) {
  return (
    <div role="status" className="mx-4 mb-3 flex items-center gap-2 rounded-[14px] bg-[#18191C] px-3.5 py-2.5 text-[14px] font-bold text-[#F1EFEA]">
      <WifiOff className="size-4 shrink-0" />{t.offline}{queued > 0 && ` · ${queued} ${t.waiting}`}
    </div>
  )
}

function Delivery({ d, t, busy, offline, onBack, onDelivered, langBtn }: {
  d: DriverView
  t: typeof STRINGS.en
  busy: boolean
  offline: boolean
  onBack: () => void
  onDelivered: (p: Proof) => void
  langBtn: ReactNode
}) {
  const [photos, setPhotos] = useState<string[]>([])
  const [receiver, setReceiver] = useState('')
  const [signed, setSigned] = useState(false)
  const [damaged, setDamaged] = useState(false)
  const [note, setNote] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const file = useRef<HTMLInputElement>(null)

  const urls = useRef<string[]>([])
  useEffect(() => { urls.current = photos }, [photos])
  useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), [])   // free the previews on leaving

  // signature pad: pointer events, scaled for sharp lines on high-DPI phones
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    c.width = r.width * dpr
    c.height = r.height * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--fm-ink').trim() || '#18191C'
  }, [])
  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const }
  const down = (e: React.PointerEvent) => {
    const ctx = canvas.current!.getContext('2d')!
    drawing.current = true
    canvas.current!.setPointerCapture(e.pointerId)
    const [x, y] = pos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return
    const ctx = canvas.current!.getContext('2d')!
    const [x, y] = pos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setSigned(true)
  }
  const clear = () => {
    const c = canvas.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setSigned(false)
  }

  const ready = receiver.trim().length > 0 && signed
  const j = d.job!
  return (
    <div className="mx-auto flex min-h-full max-w-[480px] flex-col bg-[color-mix(in_srgb,var(--fm-ink)_4%,var(--fm-bg))] pt-[max(12px,env(safe-area-inset-top))] text-ink">
      <div className="flex items-center justify-between px-3">
        <button onClick={onBack} className="flex min-h-11 items-center gap-1 rounded-[12px] px-2 text-[15px] font-bold"><ChevronLeft className="size-5" />{t.back}</button>
        {langBtn}
      </div>
      <Header title={t.handOver} sub={`${place(j.dropoff)} · ${j.id}`} />
      {offline && <OfflineNote t={t} queued={0} />}
      <section className="mx-4 flex flex-col gap-3 rounded-[18px] bg-[var(--fm-solid)] p-4">
        <h2 className="text-[15px] font-extrabold">{t.photos}</h2>
        <div className="flex flex-wrap gap-2">
          {photos.map(u => <img key={u} src={u} alt="" className="size-24 rounded-[12px] object-cover" />)}
          <button onClick={() => file.current?.click()} aria-label={t.addPhoto}
            className="flex size-24 items-center justify-center rounded-[12px] border-2 border-dashed border-[var(--fm-park-dot)] text-muted-ink">
            <Camera className="size-7" />
          </button>
          <input ref={file} type="file" accept="image/*" capture="environment" multiple hidden
            onChange={e => { const fs = Array.from(e.target.files ?? []); setPhotos(p => [...p, ...fs.map(f => URL.createObjectURL(f))].slice(0, 20)); e.target.value = '' }} />
        </div>
        <label className="flex flex-col gap-1.5 text-[15px] font-extrabold">{t.receiver}
          <input value={receiver} onChange={e => setReceiver(e.target.value)} maxLength={80} placeholder={t.receiverPh} autoComplete="name"
            className="min-h-12 rounded-[12px] border border-line px-3.5 text-[16px] font-normal outline-none focus-visible:border-amber" />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-[15px] font-extrabold">{t.signature}</span>
          <div className="relative">
            <canvas ref={canvas} aria-label={t.signHere} role="img" onPointerDown={down} onPointerMove={move}
              onPointerUp={() => { drawing.current = false }} onPointerCancel={() => { drawing.current = false }}
              className="h-[130px] w-full touch-none rounded-[12px] border border-line" />
            {!signed && <span className="pointer-events-none absolute inset-0 grid place-items-center text-[14px] text-muted-ink">{t.signHere}</span>}
            <button onClick={clear} className="absolute top-2 right-2 min-h-8 rounded-[8px] px-2 text-[13px] font-bold text-muted-ink">{t.clear}</button>
          </div>
        </div>
        <label className="flex min-h-11 items-center gap-2.5 text-[14px] text-[var(--fm-park-text)]">
          <input type="checkbox" checked={damaged} onChange={e => setDamaged(e.target.checked)} className="size-[22px] accent-[var(--fm-act)]" />
          {t.damaged}
        </label>
        {damaged && (
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={300} placeholder={t.damagedPh}
            className="rounded-[12px] border border-line p-2.5 text-[16px] outline-none focus-visible:border-amber" />
        )}
      </section>
      <div className="flex-1" />
      <div className="px-4 pt-3 pb-7">
        <button disabled={busy || !ready || !d.allowed.delivered}
          onClick={() => onDelivered({ receiver: receiver.trim(), signed, photos: photos.length, damaged, note: note.trim() })}
          className="min-h-14 w-full rounded-[16px] bg-amber text-[17px] font-extrabold text-on-amber disabled:opacity-50">{t.delivered}</button>
        <p className="mt-2 text-center text-[13px] text-muted-ink">{ready ? t.worksOffline : t.needSign}</p>
      </div>
      <Toaster position="top-center" />
    </div>
  )
}
