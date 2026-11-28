// Full-screen MapLibre map: OpenFreeMap vector tiles styled with the Baltic Amber map tokens,
// TomTom live traffic on top when the server has a key (through the /api/map/tile proxy),
// vehicles as the soft 3D truck / van symbols that rotate to their heading and glide between updates.
import { useEffect, useRef } from 'react'
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { STATUS, isMoving, isTruck, statusOf, VEHICLE_COLOR } from '@/lib/fleet'
import { tileUrl } from '@/lib/api'
import type { FleetState, Vehicle } from '@/lib/types'
import type { Theme } from '@/hooks/useTheme'

const TOKENS = {
  light: { bg: '#ECEDEF', water: '#D5E1EA', park: '#DFE8DD', road: '#FFFFFF', minor: '#F6F6F7', label: '#80848B',
    halo: '#ECEDEF', amber: '#F2A42B', act: '#D93A3A', ink: '#18191C' },
  dark: { bg: '#141517', water: '#1A2530', park: '#18221B', road: '#2A2C30', minor: '#202225', label: '#7C8088',
    halo: '#141517', amber: '#FFB547', act: '#FF5C5C', ink: '#F1EFEA' },
}

function baseStyle(theme: Theme): StyleSpecification {
  const t = TOKENS[theme]
  const roads = (classes: string[]) => ['match', ['get', 'class'], classes, true, false] as unknown as maplibregl.FilterSpecification
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': t.bg } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': t.park } },
      { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'],
        paint: { 'fill-color': t.park, 'fill-opacity': 0.6 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': t.water } },
      { id: 'river', type: 'line', source: 'omt', 'source-layer': 'waterway',
        paint: { 'line-color': t.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 4] } },
      { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9,
        filter: roads(['secondary', 'tertiary', 'minor', 'service']),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': t.minor, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 14, 5, 17, 12] } },
      { id: 'road-main', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: roads(['motorway', 'trunk', 'primary']),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': t.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 3.5, 14, 9, 17, 18] } },
      { id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place',
        filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false],
        layout: { 'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']], 'text-font': ['Noto Sans Bold'],
          'text-size': ['match', ['get', 'class'], 'city', 15, 'town', 13, 11] },
        paint: { 'text-color': t.label, 'text-halo-color': t.halo, 'text-halo-width': 1.4 } },
    ],
  }
}

function circle(lon: number, lat: number, km: number) {
  const pts: [number, number][] = []
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2
    pts.push([lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 110.57) * Math.sin(a)])
  }
  return pts
}

/** Screen angle (deg, clockwise, 0 = east) from a to b. */
function headingDeg(a: [number, number], b: [number, number]) {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180)
  const dy = b[1] - a[1]
  return (-Math.atan2(dy, dx) * 180) / Math.PI
}
const angleLerp = (a: number, b: number, f: number) => a + ((((b - a) % 360) + 540) % 360 - 180) * f

interface MarkerRec {
  m: maplibregl.Marker
  el: HTMLDivElement
  from: [number, number]
  to: [number, number]
  pos: [number, number]
  t0: number
  angle: number
  angleTo: number
  key: string
}

const SCALE = 0.72

function markerHtml(v: Vehicle, selected: boolean, lite: boolean) {
  const st = STATUS[statusOf(v)]
  const truck = isTruck(v)
  const r = Math.round((truck ? 28 : 24) * SCALE)
  const trail = !lite && isMoving(v)
  // truck symbol box 68x28 (van 42x24) around the centre, trail behind it, like the reference
  const box = truck ? { x: -80, y: -16, w: 116, h: 32, uw: 68, uh: 28, tx: -78, tw: 44, th: 10 }
    : { x: -58, y: -14, w: 82, h: 28, uw: 42, uh: 24, tx: -56, tw: 34, th: 8 }
  const halo = selected
    ? `<div class="halo" style="width:${r * 2 + 6}px;height:${r * 2 + 6}px;background:color-mix(in srgb, var(--fm-amber) 18%, transparent);border:2.5px solid var(--fm-amber)"></div>`
    : `<div class="halo" style="width:${r * 2}px;height:${r * 2}px;background:color-mix(in srgb, ${st.dot} 15%, transparent)${statusOf(v) === 'act' ? `;border:2px solid color-mix(in srgb, ${st.dot} 50%, transparent)` : ''}"></div>`
  const pulse = statusOf(v) === 'act' && !lite
    ? `<div class="halo pulse" style="width:${r * 2 + 8}px;height:${r * 2 + 8}px;background:${st.dot}"></div>` : ''
  return `${pulse}${halo}
    <div class="body"><svg width="${box.w * SCALE}" height="${box.h * SCALE}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}"
      style="position:absolute;left:${box.x * SCALE}px;top:${box.y * SCALE}px;overflow:visible" aria-hidden="true">
      ${trail ? `<rect x="${box.tx}" y="${-box.th / 2}" width="${box.tw}" height="${box.th}" rx="${box.th / 2}" fill="url(#fm-trail)"/>` : ''}
      <use href="${truck ? '#fm-truck' : '#fm-van'}" x="${-box.uw / 2}" y="${-box.uh / 2}" width="${box.uw}" height="${box.uh}" style="color:${VEHICLE_COLOR[v.type]}"/>
    </svg></div>
    <div class="plate">${v.id}</div>`
}

export interface MapFocus { lon: number; lat: number; zoom?: number; key: number }

export function FleetMap({ state, theme, lite, selected, onSelect, focus, bottomPad }: {
  state: FleetState | null
  theme: Theme
  lite: boolean
  selected: string | null
  onSelect: (id: string | null) => void
  focus: MapFocus | null
  bottomPad: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markers = useRef(new Map<string, MarkerRec>())
  const ready = useRef(false)
  const reveal = useRef<{ id: string | null; t0: number }>({ id: null, t0: 0 })
  const latest = useRef({ state, selected, lite, onSelect })
  latest.current = { state, selected, lite, onSelect }

  // ---- create the map once ----
  useEffect(() => {
    if (!box.current) return
    const m = new maplibregl.Map({
      container: box.current, style: baseStyle(theme), center: [24.3, 56.95], zoom: 7.6, minZoom: 5, maxZoom: 17,
      dragRotate: false, pitchWithRotate: false, attributionControl: { compact: true },
    })
    m.touchZoomRotate.disableRotation()
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    m.on('style.load', () => { addOverlays(m); ready.current = true; drawData() })
    m.on('click', e => {
      const hit = (e.originalEvent.target as HTMLElement | null)?.closest?.('.fm-veh')
      if (!hit) latest.current.onSelect(null)
    })
    map.current = m
    let raf = 0
    const tick = () => { animate(); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); markers.current.forEach(r => r.m.remove()); markers.current.clear(); m.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- light / dark: swap the basemap, keep our layers ----
  useEffect(() => {
    const m = map.current
    if (!m) return
    ready.current = false
    m.setStyle(baseStyle(theme))
  }, [theme])

  useEffect(() => { drawData() })   // every new state, selection or lite change

  useEffect(() => {
    const m = map.current
    if (m && focus) m.easeTo({ center: [focus.lon, focus.lat], zoom: Math.max(m.getZoom(), focus.zoom ?? 10),
      padding: { top: 90, bottom: bottomPad, left: 0, right: 0 }, duration: lite ? 0 : 700 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key])

  function addOverlays(m: maplibregl.Map) {
    const t = TOKENS[document.documentElement.classList.contains('dark') ? 'dark' : 'light']
    const empty = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection
    m.addSource('zones', { type: 'geojson', data: empty })
    m.addLayer({ id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': t.act, 'fill-opacity': 0.1 } })
    m.addLayer({ id: 'zones-line', type: 'line', source: 'zones',
      paint: { 'line-color': t.act, 'line-width': 1.5, 'line-dasharray': [3, 3], 'line-opacity': 0.7 } })
    m.addSource('sel-route', { type: 'geojson', data: empty })
    m.addLayer({ id: 'sel-route-casing', type: 'line', source: 'sel-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': t.halo, 'line-width': 9, 'line-opacity': 0.8 } })
    m.addLayer({ id: 'sel-route', type: 'line', source: 'sel-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': t.amber, 'line-width': 5 } })
    m.addSource('jobs', { type: 'geojson', data: empty })
    m.addLayer({ id: 'jobs', type: 'circle', source: 'jobs',
      paint: { 'circle-radius': 5, 'circle-color': ['case', ['get', 'urgent'], t.act, t.ink],
        'circle-stroke-color': t.halo, 'circle-stroke-width': 2 } })
  }

  function drawData() {
    const m = map.current
    const { state: s, selected: sel, lite: isLite } = latest.current
    if (!m || !s) return
    // vehicles
    const seen = new Set<string>()
    const now = performance.now()
    for (const v of s.vehicles) {
      seen.add(v.id)
      const pos: [number, number] = [v.lon, v.lat]
      let rec = markers.current.get(v.id)
      if (!rec) {
        const el = document.createElement('div')
        el.className = 'fm-veh'
        el.tabIndex = 0
        el.setAttribute('role', 'button')
        el.addEventListener('click', e => { e.stopPropagation(); latest.current.onSelect(v.id) })
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); latest.current.onSelect(v.id) } })
        const mk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(pos).addTo(m)
        const a = v.route.length > 1 ? headingDeg(pos, [v.route[Math.min(3, v.route.length - 1)][1], v.route[Math.min(3, v.route.length - 1)][0]]) : 0
        rec = { m: mk, el, from: pos, to: pos, pos, t0: now, angle: a, angleTo: a, key: '' }
        markers.current.set(v.id, rec)
      }
      if (pos[0] !== rec.to[0] || pos[1] !== rec.to[1]) {
        const moved = Math.hypot(pos[0] - rec.pos[0], pos[1] - rec.pos[1])
        if (moved > 0.00005) rec.angleTo = headingDeg(rec.pos, pos)
        rec.from = rec.pos
        rec.to = pos
        rec.t0 = now
        if (isLite) { rec.pos = pos; rec.angle = rec.angleTo; rec.m.setLngLat(pos) }
      } else if (v.route.length > 1 && isMoving(v) && rec.from === rec.to) {
        const ahead = v.route[Math.min(3, v.route.length - 1)]
        rec.angleTo = headingDeg(pos, [ahead[1], ahead[0]])
      }
      const key = `${v.status}|${statusOf(v)}|${sel === v.id}|${isLite}|${v.type}`
      if (rec.key !== key) {
        rec.el.innerHTML = markerHtml(v, sel === v.id, isLite)
        rec.el.classList.toggle('sel', sel === v.id)
        rec.el.setAttribute('aria-label', `${v.id}, ${STATUS[statusOf(v)].label}`)
        rec.el.style.zIndex = sel === v.id ? '3' : statusOf(v) === 'act' ? '2' : '1'
        rec.key = key
        const body = rec.el.querySelector<HTMLDivElement>('.body')
        if (body) body.style.transform = `rotate(${rec.angle}deg)`
      }
    }
    for (const [id, rec] of markers.current) if (!seen.has(id)) { rec.m.remove(); markers.current.delete(id) }
    if (!ready.current) return
    // TomTom live traffic flow under our own layers, only when the server has a TomTom key
    if (s.map.tomtom_tiles && !m.getSource('traffic')) {
      m.addSource('traffic', { type: 'raster', tiles: [tileUrl('traffic')], tileSize: 256,
        attribution: 'Live traffic © <a href="https://www.tomtom.com" target="_blank">TomTom</a>' })
      m.addLayer({ id: 'traffic', type: 'raster', source: 'traffic', paint: { 'raster-opacity': 0.8 } }, 'zones-fill')
    }
    // selected route: amber, drawn in over 1.6 s when the selection changes
    const v = sel ? s.vehicles.find(x => x.id === sel) : null
    if (reveal.current.id !== sel) reveal.current = { id: sel, t0: now }
    const src = m.getSource('sel-route') as GeoJSONSource | undefined
    if (src && (!v || v.route.length < 2)) src.setData({ type: 'FeatureCollection', features: [] })
    ;(m.getSource('zones') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: s.zones.map(z => ({ type: 'Feature', properties: { label: z.label },
        geometry: { type: 'Polygon', coordinates: [circle(z.lon, z.lat, z.radius_km)] } })),
    })
    ;(m.getSource('jobs') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: s.jobs.filter(j => j.status === 'pending').map(j => ({ type: 'Feature',
        properties: { id: j.id, urgent: j.priority === 'urgent' },
        geometry: { type: 'Point', coordinates: [j.pickup.lon, j.pickup.lat] } })),
    })
  }

  function animate() {
    const m = map.current
    const { state: s, selected: sel, lite: isLite } = latest.current
    if (!m) return
    const now = performance.now()
    if (!isLite) {
      for (const rec of markers.current.values()) {
        const f = Math.min(1, (now - rec.t0) / 1500)
        if (f < 1 || rec.pos !== rec.to) {
          rec.pos = f >= 1 ? rec.to : [rec.from[0] + (rec.to[0] - rec.from[0]) * f, rec.from[1] + (rec.to[1] - rec.from[1]) * f]
          rec.m.setLngLat(rec.pos)
        }
        if (Math.abs(rec.angleTo - rec.angle) > 0.5) {
          rec.angle = angleLerp(rec.angle, rec.angleTo, 0.12)
          const body = rec.el.querySelector<HTMLDivElement>('.body')
          if (body) body.style.transform = `rotate(${rec.angle}deg)`
        }
      }
    }
    // route reveal
    if (!ready.current || !s || !sel) return
    const v = s.vehicles.find(x => x.id === sel)
    const src = m.getSource('sel-route') as GeoJSONSource | undefined
    if (!v || !src || v.route.length < 2) return
    const f = isLite ? 1 : Math.min(1, (now - reveal.current.t0) / 1600)
    const eased = 1 - Math.pow(1 - f, 3)
    const n = Math.max(2, Math.ceil(v.route.length * eased))
    const coords = v.route.slice(0, n).map(p => [p[1], p[0]])
    const rec = markers.current.get(v.id)
    if (rec) coords[0] = rec.pos
    const sig = `${sel}|${n}|${v.route.length}|${v.route[v.route.length - 1]}|${coords[0]}`
    if ((src as unknown as { _fmSig?: string })._fmSig === sig) return
    ;(src as unknown as { _fmSig?: string })._fmSig = sig
    src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } })
  }

  return <div ref={box} className="absolute inset-0" aria-label="Live map of the fleet" role="region" />
}
