import { useEffect, useState } from 'react'
import { Eye } from 'lucide-react'
import { API, api, login, loginGuest } from '@/lib/api'
import { ROLE_LABEL } from '@/lib/fleet'
import type { Role, User } from '@/lib/types'
import { Btn, Logo, Panel } from './fm'

interface DemoAccount { username: string; password: string; name: string; role: Role; vehicle_id: string | null }

export function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [accounts, setAccounts] = useState<DemoAccount[] | null>(null)
  const [guestOk, setGuestOk] = useState(false)

  useEffect(() => {
    api<{ accounts: DemoAccount[]; guest?: boolean }>('/api/auth/demo-accounts')
      .then(d => { setAccounts(d.accounts); setGuestOk(!!d.guest) })
      .catch(() => setErr(`Can't reach the FleetMind backend at ${API || location.origin}.`))
  }, [])

  async function run(fn: () => Promise<User>) {
    setBusy(true)
    setErr(null)
    try { onSignedIn(await fn()) }
    catch (e) { setErr(e instanceof Error && e.message !== 'Failed to fetch' ? e.message : "Can't reach the backend.") }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-auto p-4"
      style={{ background: 'color-mix(in srgb, var(--fm-bg) 55%, transparent)' }}>
      <Panel className="w-full max-w-[440px] p-6" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <h1 id="login-title" className="text-[20px] font-extrabold tracking-[-0.3px]">Sign in to FleetMind</h1>
            <p className="text-[13px] text-muted-ink">Your fleet and its AI team, on one map.</p>
          </div>
        </div>
        <form className="mt-5 flex flex-col gap-3" onSubmit={e => { e.preventDefault(); run(() => login(username.trim(), password)) }}>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted-ink">Username
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required autoFocus
              className="min-h-11 rounded-[14px] border border-line bg-chip px-3 text-[16px] font-medium text-ink outline-none focus-visible:border-amber" />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-semibold text-muted-ink">Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required
              className="min-h-11 rounded-[14px] border border-line bg-chip px-3 text-[16px] font-medium text-ink outline-none focus-visible:border-amber" />
          </label>
          {err && <p role="alert" className="text-[13px] font-semibold text-act-text">{err}</p>}
          <Btn tone="primary" size="lg" type="submit" disabled={busy}>Sign in</Btn>
          {guestOk && (
            <Btn type="button" size="lg" disabled={busy} onClick={() => run(loginGuest)}>
              <Eye className="size-4" /> View as guest <span className="font-medium text-muted-ink">read only</span>
            </Btn>
          )}
        </form>
        {accounts && accounts.length > 0 && (
          <div className="mt-6">
            <h2 className="text-[15px] font-extrabold">Demo accounts</h2>
            <p className="mb-2 text-[13px] text-muted-ink">Tap one to sign in. These demo passwords are public.</p>
            <div className="grid grid-cols-2 gap-2">
              {accounts.map(a => (
                <button key={a.username} type="button" disabled={busy}
                  onClick={() => { setUsername(a.username); setPassword(a.password); run(() => login(a.username, a.password)) }}
                  className="flex min-h-11 flex-col items-start rounded-[14px] bg-chip px-3 py-2 text-left hover:bg-amber-tint focus-visible:outline-2 focus-visible:outline-amber">
                  <span className="text-[13px] font-bold">{ROLE_LABEL[a.role]}</span>
                  <span className="text-[12px] text-muted-ink">{a.name}{a.vehicle_id ? ` · ${a.vehicle_id}` : ''}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  )
}
