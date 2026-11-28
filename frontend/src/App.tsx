import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { api, logout, me, onLoginRequired } from '@/lib/api'
import { can, type AttentionItem } from '@/lib/fleet'
import type { AiAction, Approval, User } from '@/lib/types'
import { useFleet } from '@/hooks/useFleet'
import { useTheme } from '@/hooks/useTheme'
import { useLite } from '@/hooks/useLite'
import { Login } from '@/components/Login'
import { TopBar, type Page } from '@/components/TopBar'
import { FleetMap, type MapFocus } from '@/components/map/FleetMap'
import { NeedsYou } from '@/components/NeedsYou'
import { AiTeam } from '@/components/AiTeam'
import { VehicleSheet } from '@/components/VehicleSheet'
import { ApprovalDialog, MessageDialog } from '@/components/Dialogs'
import { Chat } from '@/components/Chat'
import { VehicleSymbols } from '@/components/VehicleSymbols'
import { Panel } from '@/components/fm'
import { cn } from '@/lib/utils'
import { GtmPage } from '@/pages/Gtm'
import { ReportsPage } from '@/pages/Reports'
import { FleetPage } from '@/pages/Fleet'
import { ActivityPage } from '@/pages/Activity'

const PAGES: Page[] = ['map', 'fleet', 'orders', 'activity', 'reports', 'gtm']
const pageFromHash = (): Page => {
  const p = location.hash.replace(/^#\/?/, '') as Page
  return PAGES.includes(p) ? p : 'map'
}

function errText(e: unknown) { return e instanceof Error ? e.message : String(e) }

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [booting, setBooting] = useState(true)
  const { theme, toggle } = useTheme()
  const feed = useFleet(!!user && user.role !== 'driver')
  const s = feed.state
  const [page, setPageState] = useState<Page>(pageFromHash)
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<MapFocus | null>(null)
  const [approvalId, setApprovalId] = useState<string | null>(null)
  const [msgFor, setMsgFor] = useState<string | null>(null)
  const [chat, setChat] = useState<{ open: boolean; q: { text: string; key: number } | null }>({ open: false, q: null })
  const liteMode = useLite()
  const lite = liteMode.lite
  const top = useRef<HTMLDivElement>(null)
  const [topH, setTopH] = useState(76)

  // ---- sign-in ----
  useEffect(() => {
    me().then(u => { setUser(u); setBooting(false) })
    return onLoginRequired(() => setUser(null))
  }, [])
  useEffect(() => {
    if (user?.role === 'driver') location.replace('driver.html' + location.search)   // drivers get the phone page
  }, [user])

  // ---- simple hash routing: #/fleet, #/orders, ... ----
  const setPage = useCallback((p: Page) => {
    setPageState(p)
    history.replaceState(null, '', p === 'map' ? location.pathname + location.search : `#/${p}`)
  }, [])
  useEffect(() => {
    const on = () => setPageState(pageFromHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useLayoutEffect(() => {
    if (!top.current) return
    const ro = new ResizeObserver(() => setTopH(top.current?.offsetHeight ?? 76))
    ro.observe(top.current)
    return () => ro.disconnect()
  }, [user])

  const role = user?.role
  const canWrite = can.write(role)
  const vehicle = s && selected ? s.vehicles.find(v => v.id === selected) ?? null : null
  const approval = s && approvalId ? s.approvals.find(a => a.id === approvalId) ?? null : null
  const approvalFor = (id: string) => s?.approvals.find(a => `${a.title} ${a.summary}`.includes(id)) ?? null

  const selectVehicle = useCallback((id: string | null) => {
    setSelected(id)
    if (!id) return
    setPage('map')
    const v = feed.state?.vehicles.find(x => x.id === id)
    if (v) setFocus({ lon: v.lon, lat: v.lat, zoom: 10, key: Date.now() })
  }, [feed.state, setPage])

  async function write<T>(path: string, body: unknown, ok?: string): Promise<T | null> {
    try {
      const r = await api<T>(path, body)
      if (ok) toast.success(ok)
      feed.refresh()
      return r
    } catch (e) {
      toast.error(errText(e))
      return null
    }
  }

  async function onAttention(it: AttentionItem) {
    const a = it.action
    if (!a) return
    if (a.kind === 'approval') setApprovalId(a.id)
    else if (a.kind === 'vehicle') selectVehicle(a.id)
    else if (a.kind === 'energy') await write(`/api/vehicles/${encodeURIComponent(a.id)}/energy_stop`, {}, `Stop added for ${a.id}`)
    else if (a.kind === 'job') {
      const j = s?.jobs.find(x => x.id === a.id)
      if (j) setFocus({ lon: j.pickup.lon, lat: j.pickup.lat, zoom: 11, key: Date.now() })
    }
  }

  async function decide(a: Approval, optionId: string, approve: boolean) {
    const r = await write<{ ok: boolean; decided_by?: string; error?: string }>(`/api/approvals/${a.id}`, { option_id: optionId, approve })
    if (r?.ok) { toast.success(approve ? 'Approved. The AI team is on it.' : 'Rejected.'); setApprovalId(null) }
    else if (r && !r.ok) toast.error(r.error ?? 'Not applied')
  }

  async function undoAction(a: AiAction) {
    const r = await write<{ ok: boolean; instead?: string; error?: string }>(`/api/actions/${encodeURIComponent(a.id)}/undo`, {})
    if (r?.ok) toast.success(`Undone. ${r.instead ?? ''}`)
    return !!r?.ok
  }

  if (booting) return null
  if (!user) return <><VehicleSymbols /><Login onSignedIn={setUser} /></>
  if (user.role === 'driver') return null

  const sheetPad = vehicle ? (lite ? 120 : 260) : 40
  const gap = lite ? 12 : 20
  const panelTop = lite ? topH + 12 : topH + 20 + 16
  const panelStyle = { top: panelTop, maxHeight: `calc(100% - ${panelTop + gap}px)` }

  return (
    <TooltipProvider>
      <VehicleSymbols />
      <div className="relative h-full overflow-hidden bg-background text-ink max-[900px]:overflow-y-auto">
        <div className="absolute inset-0 max-[900px]:relative max-[900px]:h-[440px]" style={{ marginTop: 0 }}>
          <FleetMap state={s} theme={theme} lite={lite} selected={selected} onSelect={selectVehicle} focus={focus} bottomPad={sheetPad}
            onSlow={liteMode.reportSlow} offline={feed.offline} />
        </div>

        <div ref={top} className={cn('pointer-events-none absolute z-20',
          lite ? 'top-0 right-0 left-0' : 'top-5 right-5 left-5 max-[900px]:fixed max-[900px]:top-2 max-[900px]:right-2 max-[900px]:left-2')}>
          <TopBar state={s} user={user} page={page} onPage={setPage} onSelectVehicle={selectVehicle}
            lite={lite} liteAuto={liteMode.auto} liteReason={liteMode.reason} onLite={liteMode.toggle} onLiteReset={liteMode.reset}
            onAsk={q => setChat({ open: true, q: { text: q, key: Date.now() } })}
            onEvent={type => write('/api/event', { type, vehicle_id: selected }, 'Event started. Watch the AI team.')}
            onControl={(action, value) => write('/api/control', { action, value })}
            theme={theme} onTheme={toggle} onLogout={async () => { await logout(); setUser(null) }} />
        </div>

        {s && page === 'map' && (
          <>
            <NeedsYou state={s} canWrite={canWrite} compact={lite} onAction={onAttention}
              className={cn('absolute z-10 max-[900px]:static max-[900px]:m-3 max-[900px]:w-auto', lite ? 'left-3 w-[300px]' : 'left-5 w-[360px]')}
              style={panelStyle} />
            <AiTeam state={s} log={feed.log} showGtm={can.gtm(role)} rail={lite} style={panelStyle}
              className={lite ? 'absolute right-3 z-10 max-[900px]:hidden' : 'absolute right-5 z-10 w-[320px] max-[900px]:static max-[900px]:m-3 max-[900px]:w-auto'} />
            <AnimatePresence>
              {vehicle && (
                <VehicleSheet key={vehicle.id} v={vehicle} approval={approvalFor(vehicle.id)} canWrite={canWrite} compact={lite}
                  onClose={() => setSelected(null)} onMessage={() => setMsgFor(vehicle.id)}
                  onEnergy={async () => { await write(`/api/vehicles/${encodeURIComponent(vehicle.id)}/energy_stop`, {}, `Stop added for ${vehicle.id}`) }}
                  onReview={a => setApprovalId(a.id)}
                  className={cn('absolute z-20 max-[900px]:static max-[900px]:m-3 max-[900px]:w-auto max-[900px]:translate-x-0',
                    lite ? 'bottom-3 left-1/2 w-[min(560px,calc(100%-400px))] -translate-x-1/2' : 'right-[360px] bottom-5 left-[400px]')} />
              )}
            </AnimatePresence>
          </>
        )}

        {s && page !== 'map' && (
          <main className="absolute inset-0 z-10 flex flex-col bg-background px-5 pb-5" style={{ paddingTop: panelTop }}>
            {page === 'gtm' && can.gtm(role) && <GtmPage />}
            {page === 'reports' && can.history(role) && <ReportsPage state={s} />}
            {page === 'fleet' && <FleetPage state={s} log={feed.log} onSelect={selectVehicle} lastOk={feed.lastOk} />}
            {page === 'activity' && <ActivityPage state={s} log={feed.log} onSelectVehicle={selectVehicle} onUndo={undoAction} />}
            {page === 'orders' && (
              <Panel className="p-6">
                <h1 className="text-[20px] font-extrabold">Coming next</h1>
                <p className="mt-1 text-muted-ink">This screen is being rebuilt. The <a className="font-bold text-amber-text underline" href="classic.html">classic dashboard</a> still has it.</p>
              </Panel>
            )}
          </main>
        )}

        {!s && (
          <div className="absolute inset-0 z-10 grid place-items-center">
            <Panel className="p-6 text-muted-ink">{feed.error ? `Can't reach the backend: ${feed.error}` : 'Loading the fleet…'}</Panel>
          </div>
        )}
      </div>

      <ApprovalDialog approval={approval} onClose={() => setApprovalId(null)} onDecide={decide} />
      <MessageDialog vehicle={msgFor} driver={s?.vehicles.find(v => v.id === msgFor)?.driver ?? 'the driver'}
        onClose={() => setMsgFor(null)}
        onSend={async text => { const r = await write(`/api/vehicles/${encodeURIComponent(msgFor!)}/message`, { text }, 'Message sent'); if (r) setMsgFor(null) }} />
      {canWrite && <Chat open={chat.open} question={chat.q} onClose={() => setChat(c => ({ ...c, open: false }))} />}
      <Toaster position="bottom-center" />
    </TooltipProvider>
  )
}
