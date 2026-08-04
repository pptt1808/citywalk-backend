<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { PhMapPinLine } from '@phosphor-icons/vue'
import type { RouteStop, RouteLeg } from '../api/agent'

const props = defineProps<{
  stops: RouteStop[]
  routeLegs?: RouteLeg[]
  startLocation?: string
  startName?: string
  currentLocation?: { lng: number; lat: number; accuracy?: number }
  momentPins?: Array<{ id: string; lng: number; lat: number; label: string; note?: string }>
}>()

const mapContainer = ref<HTMLElement>()
const mapReady = ref(false)
const loadError = ref(false)

let mapInstance: any = null
const markers: any[] = []
let polyline: any = null

// ── Helpers ──

function parseCoord(str: string): [number, number] | null {
  const parts = str.split(',')
  const lng = parseFloat(parts[0])
  const lat = parseFloat(parts[1])
  if (isNaN(lng) || isNaN(lat)) return null
  return [lng, lat]
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'\"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char] ?? char))
}

const hasCoordinates = computed(() =>
  props.stops.some(s => s.location) || !!props.startLocation || !!props.currentLocation
)

// ── Amap loader ──

let amapScriptPromise: Promise<void> | null = null

function loadAmapScript(): Promise<void> {
  const key = (import.meta as any).env?.VITE_AMAP_KEY
  if (!key) {
    console.warn('[RouteMap] VITE_AMAP_KEY is not set; map disabled')
    return Promise.reject(new Error('Missing AMap key'))
  }
  if ((window as any).AMap) return Promise.resolve()

  const security = (import.meta as any).env?.VITE_AMAP_SECURITY
  if (security) {
    (window as any)._AMapSecurityConfig = { securityJsCode: security }
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}`
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('AMap script load failed'))
    document.head.appendChild(script)
  })
}

// ── AMap helpers (access globals after script loaded) ──

function createMarker(opts: any) {
  return new (window as any).AMap.Marker(opts)
}

function createPolyline(opts: any) {
  return new (window as any).AMap.Polyline(opts)
}

function createPixel(x: number, y: number) {
  return new (window as any).AMap.Pixel(x, y)
}

function createInfoWindow(opts: any) {
  return new (window as any).AMap.InfoWindow(opts)
}

function createMap(container: HTMLElement, opts: any) {
  return new (window as any).AMap.Map(container, opts)
}

// ── Render ──

function renderMap() {
  if (!mapInstance || !mapContainer.value) return

  // Clear old
  markers.forEach((m: any) => m.setMap(null))
  markers.length = 0
  if (polyline) { polyline.setMap(null); polyline = null }

  const coords: [number, number][] = []
  const namedCoords = new Map<string, [number, number]>()

  // Start marker
  if (props.startLocation) {
    const c = parseCoord(props.startLocation)
    if (c) {
      coords.push(c)
      if (props.startName) namedCoords.set(props.startName, c)
      const m = createMarker({
        position: c,
        content: `<div style="background:#fff6f1;color:#9b3f21;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;border:1px solid #b86548;box-shadow:0 0 0 4px rgba(255,253,247,.86),0 4px 12px rgba(70,55,43,.18)">起</div>`,
        offset: createPixel(-16, -16),
        zIndex: 110
      })
      m.setMap(mapInstance)
      markers.push(m)
    }
  }

  // Stop markers
  props.stops.forEach((stop, i) => {
    if (!stop.location) return
    const c = parseCoord(stop.location)
    if (!c) return
    coords.push(c)
    namedCoords.set(stop.name, c)
    const marker = createMarker({
      position: c,
      content: `<div style="background:#9b3f21;color:#fffdf7;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;border:1px solid #fffdf7;box-shadow:0 0 0 3px rgba(155,63,33,.16),0 4px 10px rgba(70,55,43,.2)">${i + 1}</div>`,
      offset: createPixel(-15, -15),
      zIndex: 100
    })
    marker.on('click', () => {
      const cost = stop.estimatedCost > 0 ? `约${stop.estimatedCost}元` : '免费'
      const extra = [stop.highlight, stop.costBreakdown, stop.bookingInfo].filter(Boolean).map(s => `<span style="color:#79685e;font-size:12px">${escapeHtml(s)}</span>`).join('<br/>')
      const info = createInfoWindow({
        content: `<div style="font-size:13px;line-height:1.6;padding:4px 2px;max-width:220px"><strong>${escapeHtml(stop.name)}</strong><br/><span style="color:#9b9590">${escapeHtml(stop.address)}</span><br/><span>${escapeHtml(cost)} · ${stop.estimatedStayMinutes}分钟</span>${extra ? '<br/>' + extra : ''}</div>`,
        offset: createPixel(0, -36)
      })
      info.open(mapInstance!, marker.getPosition())
    })
    marker.setMap(mapInstance)
    markers.push(marker)
  })

  // Recorded moments become numbered scrapbook pins on the route.
  props.momentPins?.forEach((pin) => {
    const c: [number, number] = [pin.lng, pin.lat]
    coords.push(c)
    const marker = createMarker({
      position: c,
      content: `<div style="background:#fff6f1;color:#9b3f21;min-width:31px;height:31px;padding:0 8px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;border:1px solid #b86548;box-shadow:0 0 0 3px rgba(255,250,240,.8),0 4px 10px rgba(70,55,43,.2)">记 ${escapeHtml(pin.label)}</div>`,
      offset: createPixel(-16, -16),
      zIndex: 135
    })
    marker.on('click', () => {
      const info = createInfoWindow({
        content: `<div style="font-size:12px;line-height:1.6;padding:3px;max-width:200px"><strong>沿途记录 ${escapeHtml(pin.label)}</strong><br/><span style="color:#765f53">${escapeHtml(pin.note || '这一刻已收进手账')}</span></div>`,
        offset: createPixel(0, -35)
      })
      info.open(mapInstance!, marker.getPosition())
    })
    marker.setMap(mapInstance)
    markers.push(marker)
  })

  // Live location sits above route and journal pins.
  if (props.currentLocation) {
    const c: [number, number] = [props.currentLocation.lng, props.currentLocation.lat]
    coords.push(c)
    const marker = createMarker({
      position: c,
      content: '<div style="width:20px;height:20px;border-radius:50%;background:#9b3f21;border:4px solid #fffdf7;box-shadow:0 0 0 7px rgba(155,63,33,.18),0 5px 12px rgba(70,55,43,.22)"></div>',
      offset: createPixel(-11, -11),
      zIndex: 160
    })
    marker.setMap(mapInstance)
    markers.push(marker)
  }

  // Draw each leg from its own coordinates so missing POI coordinates do not
  // shift every subsequent leg label. These are schematic lines; the metrics
  // still come from the routing API or the explicit fallback estimate.
  if (props.routeLegs?.length) {
    const modeLabel: Record<string, string> = { walk: '步行', transit: '公交', bicycling: '骑行' }
    for (const leg of props.routeLegs) {
      const a = parseCoord(leg.origin) ?? (leg.originName ? namedCoords.get(leg.originName) : undefined)
      const b = parseCoord(leg.destination) ?? (leg.destinationName ? namedCoords.get(leg.destinationName) : undefined)
      if (!a || !b) continue
      const line = createPolyline({
        path: [a, b],
        strokeColor: leg.mode === 'transit' ? '#70483a' : '#9b3f21',
        strokeWeight: 4,
        strokeOpacity: 0.72,
        strokeStyle: 'dashed',
        zIndex: 50
      })
      line.setMap(mapInstance)
      markers.push(line)
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const dist = leg.distanceMeters >= 1000
        ? (leg.distanceMeters / 1000).toFixed(1) + 'km'
        : leg.distanceMeters + 'm'
      const labelMarker = createMarker({
        position: mid,
        content: `<div style="background:rgba(255,253,247,.94);color:#665449;padding:5px 8px;border:1px solid rgba(102,84,73,.22);border-radius:8px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 3px 9px rgba(70,55,43,.12)">${modeLabel[leg.mode] ?? '路线'} · ${escapeHtml(dist)} · ${leg.durationMinutes}分</div>`,
        offset: createPixel(-30, -10),
        zIndex: 60
      })
      labelMarker.setMap(mapInstance)
      markers.push(labelMarker)
    }
  }

  // Fit view
  if (coords.length > 0) {
    mapInstance.setFitView(null, false, [80, 60, 80, 60])
  }
}

async function initMap() {
  if (mapInstance || !mapContainer.value || !hasCoordinates.value) return
  try {
    if (!amapScriptPromise) amapScriptPromise = loadAmapScript()
    await amapScriptPromise
    await nextTick()
    if (!mapContainer.value) return
    const initialCenter = (props.startLocation ? parseCoord(props.startLocation) : null)
      ?? props.stops.map(stop => stop.location ? parseCoord(stop.location) : null).find(Boolean)
      ?? (props.currentLocation ? [props.currentLocation.lng, props.currentLocation.lat] as [number, number] : undefined)
    mapInstance = createMap(mapContainer.value, {
      zoom: 14,
      center: initialCenter,
      viewMode: '2D',
      resizeEnable: true,
      mapStyle: (import.meta as any).env?.VITE_AMAP_STYLE || 'amap://styles/whitesmoke',
      features: ['bg', 'road', 'point'],
      showLabel: true
    })
    mapReady.value = true
    await nextTick()
    renderMap()
    // Force Amap to recalculate size after render
    mapInstance?.resize?.()
  } catch {
    loadError.value = true
  }
}

// ── Lifecycle ──

onMounted(() => { initMap() })

onUnmounted(() => {
  markers.forEach((m: any) => m.setMap(null))
  markers.length = 0
  if (polyline) { polyline.setMap(null); polyline = null }
  if (mapInstance) { mapInstance.destroy(); mapInstance = null }
})

watch(() => [props.stops, props.routeLegs, props.startLocation, props.currentLocation, props.momentPins], () => {
  if (mapInstance) {
    renderMap()
    setTimeout(() => mapInstance?.resize?.(), 150)
  } else if (hasCoordinates.value) {
    initMap()
    if (!mapInstance) {
      setTimeout(() => { if (!mapInstance && hasCoordinates.value) initMap() }, 250)
    }
  }
}, { flush: 'post' })
</script>

<template>
  <div class="route-map-container">
    <div v-if="!hasCoordinates" class="map-placeholder">
      <PhMapPinLine :size="22" style="opacity:.5" />
      <span>暂无地图坐标数据</span>
    </div>
    <div v-else-if="loadError" class="map-placeholder">
      <span>地图加载失败，请检查网络或 API Key 配置</span>
    </div>
    <div v-else ref="mapContainer" class="map-canvas">
      <span v-if="routeLegs?.length" class="map-note">虚线为路线示意，距离与耗时来自路径规划结果</span>
    </div>
  </div>
</template>

<style scoped>
.route-map-container {
  width: 100%;
  height: 400px;
  min-height: 400px;
  flex-shrink: 0;
  border-radius: var(--radius);
  border: 1px solid rgba(103,83,69,.2);
  overflow: hidden;
  position: relative;
  margin-bottom: 20px;
  background:#eee9dd;
}
.map-canvas {
  position: absolute;
  inset: 0;
  filter:saturate(.7) sepia(.06) contrast(.96);
}
.route-map-container::after{content:'';position:absolute;z-index:5;inset:0;pointer-events:none;background-image:radial-gradient(rgba(91,73,60,.08) .6px,transparent .6px),linear-gradient(105deg,rgba(255,250,237,.09),transparent 50%);background-size:15px 15px,100% 100%;mix-blend-mode:multiply;opacity:.38}
.map-note { position: absolute; right: 12px; bottom: 12px; z-index: 10; padding: 7px 10px; border: 1px solid rgba(103,83,69,.18); border-radius: var(--radius-sm); background: rgba(255,253,247,.92); color: #665449; font-size: 12px; pointer-events: none; box-shadow:0 4px 12px rgba(70,55,43,.1) }
.map-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 13px;
}
</style>
