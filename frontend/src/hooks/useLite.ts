import { useCallback, useEffect, useState } from 'react'

// Lite mode (design/DESIGN.md): solid panels, no blur, no gliding or trails, AI team as an icon rail.
// It switches on by itself on small screens, weak machines, a slow map, or reduced motion /
// transparency. The "Lite mode" toggle in the top bar overrides that and is remembered.

export type LiteOverride = 'on' | 'off' | null

const KEY = 'fmLite'
const SMALL = '(max-width: 1440px), (max-height: 800px)'
const PREFS = '(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce)'

function savedOverride(): LiteOverride {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'on' || v === 'off' ? v : null
  } catch { return null }
}

function weakDevice() {
  const n = navigator as Navigator & { deviceMemory?: number }
  return (n.hardwareConcurrency > 0 && n.hardwareConcurrency <= 4) || (n.deviceMemory != null && n.deviceMemory <= 4)
}

const matches = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches

/** Why lite mode would switch on by itself, or null if it wouldn't. */
function autoReason(slowMap: boolean): string | null {
  if (matches(PREFS)) return 'Your system asks for less motion or transparency'
  if (matches(SMALL)) return 'Small screen'
  if (weakDevice()) return 'This computer has few cores or little memory'
  if (slowMap) return 'The map was running below 30 frames a second'
  return null
}

export function useLite() {
  const [override, setOverrideState] = useState<LiteOverride>(savedOverride)
  const [slowMap, setSlowMap] = useState(false)
  const [, rerender] = useState(0)

  // screen size and system preferences can change while the page is open
  useEffect(() => {
    const lists = [SMALL, PREFS].filter(() => typeof matchMedia === 'function').map(q => matchMedia(q))
    const on = () => rerender(n => n + 1)
    lists.forEach(l => l.addEventListener('change', on))
    return () => lists.forEach(l => l.removeEventListener('change', on))
  }, [])

  const reason = autoReason(slowMap)
  const lite = override ? override === 'on' : reason != null

  useEffect(() => { document.documentElement.classList.toggle('lite', lite) }, [lite])

  const setOverride = useCallback((v: LiteOverride) => {
    setOverrideState(v)
    try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY) } catch { /* not remembered */ }
  }, [])

  /** The toggle: flip the current mode and remember it. */
  const toggle = useCallback(() => setOverride(lite ? 'off' : 'on'), [lite, setOverride])
  const reportSlow = useCallback(() => setSlowMap(true), [])

  return { lite, auto: override == null, reason, toggle, reset: () => setOverride(null), reportSlow }
}
