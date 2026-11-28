// The soft 3D top-down truck and van from design/reference/control-centre.reference.html, kept as they are.
// Rendered once; every icon on the page points at them with <use href="#fm-truck">.
import { VEHICLE_COLOR, isTruck } from '@/lib/fleet'
import type { Vehicle } from '@/lib/types'

export function VehicleSymbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fm-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id="fm-trail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--fm-amber)' }} stopOpacity="0" />
          <stop offset="1" style={{ stopColor: 'var(--fm-amber)' }} stopOpacity="0.55" />
        </linearGradient>
        <symbol id="fm-truck" viewBox="-40 -16 80 32" overflow="visible">
          <ellipse cx="3" cy="4" rx="34" ry="11" fill="#000" opacity="0.22" />
          <rect x="-32" y="-10" width="44" height="20" rx="3" fill="currentColor" />
          <rect x="-32" y="-10" width="44" height="20" rx="3" fill="url(#fm-shade)" />
          <path d="M-24 -10v20M-16 -10v20M-8 -10v20M0 -10v20" stroke="#000" strokeOpacity="0.07" />
          <rect x="12" y="-3" width="4" height="6" fill="#2A2C30" />
          <rect x="15" y="-10" width="17" height="20" rx="5" fill="currentColor" />
          <rect x="15" y="-10" width="17" height="20" rx="5" fill="url(#fm-shade)" />
          <rect x="25" y="-8" width="5" height="16" rx="2" fill="#18222B" />
          <rect x="23" y="-12.5" width="3" height="2.5" rx="1" fill="#2A2C30" />
          <rect x="23" y="10" width="3" height="2.5" rx="1" fill="#2A2C30" />
        </symbol>
        <symbol id="fm-van" viewBox="-24 -14 48 28" overflow="visible">
          <ellipse cx="2" cy="3" rx="20" ry="10" fill="#000" opacity="0.22" />
          <rect x="-18" y="-9" width="36" height="18" rx="6" fill="currentColor" />
          <rect x="-18" y="-9" width="36" height="18" rx="6" fill="url(#fm-shade)" />
          <rect x="-13" y="-6" width="17" height="12" rx="3" fill="#fff" opacity="0.16" />
          <rect x="8" y="-7" width="6" height="14" rx="2.5" fill="#18222B" />
        </symbol>
      </defs>
    </svg>
  )
}

/** A vehicle drawn for panels and tables (not the map). */
export function VehicleGlyph({ v, size = 'md', angle = -12 }: { v: Pick<Vehicle, 'type'>; size?: 'sm' | 'md' | 'lg'; angle?: number }) {
  const truck = isTruck(v)
  const w = { sm: 44, md: 72, lg: 120 }[size]
  const h = Math.round(w * 0.53)
  const iw = truck ? w * 0.87 : w * 0.6
  const ih = truck ? iw * 0.41 : iw * 0.57
  return (
    <svg width={w} height={h} viewBox={`${-w / 2} ${-h / 2} ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <g transform={`rotate(${angle})`}>
        <use href={truck ? '#fm-truck' : '#fm-van'} x={-iw / 2} y={-ih / 2} width={iw} height={ih}
          style={{ color: VEHICLE_COLOR[v.type] }} />
      </g>
    </svg>
  )
}
