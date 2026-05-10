<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { RouteStop, RouteLeg } from '../api/agent'

const props = defineProps<{
  stops: RouteStop[]
  routeLegs?: RouteLeg[]
  startLocation?: string
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

const hasCoordinates = computed(() =>
  props.stops.some(s => s.location) || !!props.startLocation
)

// ── Amap loader ──

let amapScriptPromise: Promise<void> | null = null

function loadAmapScript(): Promise<void> {
  const key = (import.meta as any).env?.VITE_AMAP_KEY
  if (!key) {
    console.warn('[RouteMap] VITE_AMAP_KEY is not set — map disabled')
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

  // Start marker
  if (props.startLocation) {
    const c = parseCoord(props.startLocation)
    if (c) {
      coords.push(c)
      const m = createMarker({
        position: c,
        content: `<div style="background:#16a34a;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">起</div>`,
        offset: createPixel(-14, -14),
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
    const marker = createMarker({
      position: c,
      content: `<div style="background:#d4570a;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${i + 1}</div>`,
      offset: createPixel(-14, -14),
      zIndex: 100
    })
    marker.on('click', () => {
      const cost = stop.estimatedCost > 0 ? `约${stop.estimatedCost}元` : '免费'
      const extra = [stop.highlight, stop.costBreakdown, stop.bookingInfo].filter(Boolean).map(s => `<span style="color:#9b9590;font-size:11px">${s}</span>`).join('<br/>')
      const info = createInfoWindow({
        content: `<div style="font-size:13px;line-height:1.6;padding:4px 2px;max-width:220px"><strong>${stop.name}</strong><br/><span style="color:#9b9590">${stop.address ?? ''}</span><br/><span>${cost} · ${stop.estimatedStayMinutes}分钟</span>${extra ? '<br/>' + extra : ''}</div>`,
        offset: createPixel(0, -36)
      })
      info.open(mapInstance!, marker.getPosition())
    })
    marker.setMap(mapInstance)
    markers.push(marker)
  })

  // Polyline
  if (coords.length >= 2) {
    polyline = createPolyline({
      path: coords,
      strokeColor: '#d4570a',
      strokeWeight: 3,
      strokeOpacity: 0.7,
      strokeStyle: 'dashed',
      lineJoin: 'round',
      lineCap: 'round',
      geodesic: true,
      zIndex: 50
    })
    polyline.setMap(mapInstance)
  }

  // Route leg mid-point labels
  if (coords.length >= 2 && props.routeLegs?.length) {
    const modeLabel: Record<string, string> = { walk: '🚶', transit: '🚇', bicycling: '🚲' }
    for (let i = 0; i < props.routeLegs.length && i < coords.length - 1; i++) {
      const leg = props.routeLegs[i]
      const a = coords[i]
      const b = coords[i + 1]
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const dist = leg.distanceMeters >= 1000
        ? (leg.distanceMeters / 1000).toFixed(1) + 'km'
        : leg.distanceMeters + 'm'
      const labelMarker = createMarker({
        position: mid,
        content: `<div style="background:rgba(0,0,0,.55);color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;white-space:nowrap">${modeLabel[leg.mode] ?? '📍'} ${dist} ${leg.durationMinutes}min</div>`,
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
  // Ensure the container is actually visible before creating the map
  const rect = mapContainer.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return
  try {
    if (!amapScriptPromise) amapScriptPromise = loadAmapScript()
    await amapScriptPromise
    await nextTick()
    if (!mapContainer.value) return
    mapInstance = createMap(mapContainer.value, {
      zoom: 14,
      center: [118.784, 32.044],
      viewMode: '2D',
      resizeEnable: true
    })
    mapReady.value = true
    renderMap()
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

watch(() => [props.stops, props.routeLegs, props.startLocation], () => {
  if (mapInstance) {
    renderMap()
  } else if (hasCoordinates.value) {
    initMap()
    // Retry once after DOM paint in case container wasn't ready
    if (!mapInstance) {
      requestAnimationFrame(() => {
        if (!mapInstance && hasCoordinates.value) initMap()
      })
    }
  }
}, { flush: 'post' })
</script>

<template>
  <div class="route-map-container">
    <div v-if="!hasCoordinates" class="map-placeholder">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4">
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
        <circle cx="12" cy="10" r="3"/>
      </svg>
      <span>暂无地图坐标数据</span>
    </div>
    <div v-else-if="loadError" class="map-placeholder">
      <span>地图加载失败，请检查网络或 API Key 配置</span>
    </div>
    <div ref="mapContainer" class="map-canvas" v-show="hasCoordinates && !loadError"></div>
  </div>
</template>

<style scoped>
.route-map-container {
  width: 100%;
  height: 360px;
  border-radius: 10px;
  border: 1px solid var(--border);
  overflow: hidden;
  position: relative;
  margin-bottom: 20px;
}
.map-canvas {
  width: 100%;
  height: 100%;
}
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
