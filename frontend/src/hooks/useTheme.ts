import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

function saved(): Theme {
  try {
    const t = localStorage.getItem('fmTheme')
    if (t === 'light' || t === 'dark') return t
  } catch { /* storage blocked */ }
  return 'light'           // light mode by default (DESIGN.md)
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(saved)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
    try { localStorage.setItem('fmTheme', theme) } catch { /* not remembered */ }
  }, [theme])
  return { theme, toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')) }
}
