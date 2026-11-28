import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { FleetState, LogEntry } from '@/lib/types'

const POLL_MS = 1500
const KEEP_LOG = 400

export interface FleetFeed {
  state: FleetState | null
  log: LogEntry[]                // whole agent log since the page opened (the API sends only new lines)
  offline: boolean
  lastOk: Date | null
  error: string | null
  refresh: () => void
}

/** Live data from /api/state, every 1.5 s. Offline after 3 failed polls in a row. */
export function useFleet(enabled: boolean): FleetFeed {
  const [state, setState] = useState<FleetState | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [offline, setOffline] = useState(false)
  const [lastOk, setLastOk] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastLog = useRef(0)
  const failures = useRef(0)
  const busy = useRef(false)

  const poll = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const s = await api<FleetState>(`/api/state?since=${lastLog.current}`)
      failures.current = 0
      setOffline(false)
      setError(null)
      setLastOk(new Date())
      if (s.log.length) {
        lastLog.current = s.log[s.log.length - 1].id
        setLog(prev => [...prev, ...s.log].slice(-KEEP_LOG))
      }
      setState(s)
    } catch (e) {
      failures.current += 1
      if (failures.current > 2) setOffline(true)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      busy.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    lastLog.current = 0
    setLog([])
    poll()
    const t = window.setInterval(poll, POLL_MS)
    return () => window.clearInterval(t)
  }, [enabled, poll])

  return { state, log, offline, lastOk, error, refresh: poll }
}
