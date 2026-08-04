<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  PhArrowRight, PhCamera, PhCheck, PhCompass, PhMapPinLine,
  PhPlay, PhPlus,
} from '@phosphor-icons/vue'
import { apiListFavoriteRoutes, type FavoriteRoute, type PlanningResult } from '../api/agent'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { GeoPoint, JournalController } from '../composables/useJournal'
import type { NavigateWorkspace } from '../workspace'
import { getMemoryUserId } from '../utils/identity'
import RouteMap from './RouteMap.vue'

const journal = inject<JournalController>('journal')!
const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const navigate = inject<NavigateWorkspace>('navigate')!
const favorites = ref<FavoriteRoute[]>([])
const now = ref(Date.now())
const note = ref('')
const files = ref<File[]>([])
const previewUrls = ref<string[]>([])
const savingMoment = ref(false)
const geoStatus = ref<'idle' | 'locating' | 'active' | 'denied' | 'unavailable'>('idle')
const journalNotice = ref('')
let geoWatchId: number | undefined
let timerId: number | undefined

const walk = computed(() => journal.activeWalk.value)
const route = computed(() => walk.value?.route)
const elapsedSeconds = computed(() => {
  if (!walk.value) return 0
  return Math.max(0, Math.floor((now.value - new Date(walk.value.startedAt).getTime() - walk.value.pausedMs) / 1000))
})
const elapsedLabel = computed(() => {
  const seconds = elapsedSeconds.value
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
})
const plannedDistance = computed(() => (route.value?.routeLegs ?? []).reduce((sum, leg) => sum + leg.distanceMeters, 0))
const distanceLabel = computed(() => plannedDistance.value >= 1000 ? `${(plannedDistance.value / 1000).toFixed(1)} km` : `${plannedDistance.value} m`)
const currentLocation = computed(() => walk.value?.currentLocation)
const momentPins = computed(() => (walk.value?.moments ?? []).flatMap((moment, index) => moment.location ? [{
  id: moment.id, lng: moment.location.lng, lat: moment.location.lat, label: String(index + 1), note: moment.note || moment.stopName || '沿途记录'
}] : []))
const currentStop = computed(() => {
  const point = currentLocation.value
  if (!point || !route.value) return route.value?.stops[0]
  return route.value.stops.map((stop, index) => ({ stop, index, point: parseCoord(stop.location) }))
    .filter((item): item is { stop: PlanningResult['stops'][number]; index: number; point: GeoPoint } => Boolean(item.point))
    .map(item => ({ ...item, distance: distance(point, item.point) })).sort((a, b) => a.distance - b.distance)[0]?.stop
})

function parseCoord(value?: string): GeoPoint | undefined {
  if (!value) return undefined
  const [lng, lat] = value.split(',').map(Number)
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : undefined
}

function distance(a: GeoPoint, b: GeoPoint): number {
  const x = (b.lng - a.lng) * Math.cos((a.lat + b.lat) * Math.PI / 360)
  const y = (b.lat - a.lat)
  return Math.sqrt(x * x + y * y) * 111320
}

function startRoute(selected: PlanningResult) {
  journal.startWalk(selected)
  beginTracking()
}

function routeKey(selected: PlanningResult) {
  return selected.historyId ?? `${selected.title}:${selected.stops.map(stop => stop.name).join('|')}`
}

function isRouteInJournal(selected: PlanningResult) {
  const key = routeKey(selected)
  return journal.entries.value.some(entry => entry.route && routeKey(entry.route) === key)
}

function addRouteToJournal(selected: PlanningResult) {
  if (!isRouteInJournal(selected)) journal.createEntry(selected)
  journalNotice.value = `“${selected.title}”已加入手账书架`
  window.setTimeout(() => { journalNotice.value = '' }, 1800)
}

function beginTracking() {
  if (!navigator.geolocation || geoWatchId !== undefined || !walk.value) {
    if (!navigator.geolocation) geoStatus.value = 'unavailable'
    return
  }
  geoStatus.value = 'locating'
  geoWatchId = navigator.geolocation.watchPosition(position => {
    geoStatus.value = 'active'
    journal.updateLocation({ lng: position.coords.longitude, lat: position.coords.latitude, accuracy: position.coords.accuracy })
  }, error => {
    geoStatus.value = error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'
  }, { enableHighAccuracy: true, maximumAge: 8000, timeout: 15000 })
}

function selectFiles(event: Event) {
  previewUrls.value.forEach(URL.revokeObjectURL)
  files.value = Array.from((event.target as HTMLInputElement).files ?? [])
  previewUrls.value = files.value.map(file => URL.createObjectURL(file))
}

async function saveMoment() {
  if (!walk.value || savingMoment.value || (!note.value.trim() && !files.value.length)) return
  savingMoment.value = true
  try {
    await journal.addMoment(note.value, files.value)
    note.value = ''
    files.value = []
    previewUrls.value.forEach(URL.revokeObjectURL)
    previewUrls.value = []
  } finally { savingMoment.value = false }
}

function finish() {
  if (!walk.value) return
  journal.finishWalk()
  stopTracking()
  navigate('scrapbook')
}

function stopTracking() {
  if (geoWatchId !== undefined) navigator.geolocation.clearWatch(geoWatchId)
  geoWatchId = undefined
}

watch(() => Boolean(walk.value), active => { if (active) beginTracking(); else stopTracking() })

onMounted(async () => {
  timerId = window.setInterval(() => { now.value = Date.now() }, 1000)
  if (walk.value) beginTracking()
  const userId = getMemoryUserId()
  if (userId) {
    try { favorites.value = (await apiListFavoriteRoutes(userId)).entries } catch { /* 不阻断随身记录 */ }
  }
})

onUnmounted(() => {
  if (timerId !== undefined) window.clearInterval(timerId)
  stopTracking()
  previewUrls.value.forEach(URL.revokeObjectURL)
})
</script>

<template>
  <main class="walk-page paper-canvas">
    <section v-if="!walk" class="route-launcher">
      <div class="launch-note"><span><PhCompass :size="32" weight="duotone" /></span><small>随时可以出发</small><h2>挑一条路线，带着它去走走</h2><p>开始后会持续读取当前位置，在路线图上标出你的脚步；照片和文字会自动附着到附近地点。</p></div>
      <div class="launch-routes">
        <article v-if="agent.result.value?.responseKind === 'route'" class="launch-route-card"><span class="route-no">新路线</span><div class="launch-route-copy"><small>刚刚生成</small><strong>{{ agent.result.value.title }}</strong><p>{{ agent.result.value.stops.map(stop => stop.name).join(' → ') }}</p></div><div class="launch-actions"><button class="add-journal" @click="addRouteToJournal(agent.result.value)"><PhCheck v-if="isRouteInJournal(agent.result.value)" :size="15" /><PhPlus v-else :size="15" />{{ isRouteInJournal(agent.result.value) ? '已在手账' : '添加到手账' }}</button><button class="start-route" @click="startRoute(agent.result.value)"><PhPlay :size="15" weight="fill" /> 开始</button></div></article>
        <article v-for="favorite in favorites" :key="favorite.id" class="launch-route-card"><span class="route-no">{{ favorite.result.stops.length }}站</span><div class="launch-route-copy"><small>{{ favorite.result.routeOverview?.city || '已收藏路线' }}</small><strong>{{ favorite.result.title }}</strong><p>{{ favorite.result.stops.map(stop => stop.name).join(' → ') }}</p></div><div class="launch-actions"><button class="add-journal" @click="addRouteToJournal(favorite.result)"><PhCheck v-if="isRouteInJournal(favorite.result)" :size="15" /><PhPlus v-else :size="15" />{{ isRouteInJournal(favorite.result) ? '已在手账' : '添加到手账' }}</button><button class="start-route" @click="startRoute(favorite.result)"><PhPlay :size="15" weight="fill" /> 开始</button></div></article>
        <p v-if="journalNotice" class="journal-notice">{{ journalNotice }}</p>
        <p v-if="agent.result.value?.responseKind !== 'route' && !favorites.length" class="no-route">还没有可出发的路线。先去 Agent 页面生成一条路线。</p>
      </div>
    </section>

    <template v-else>
      <section class="walk-map">
        <RouteMap
          :stops="walk.route.stops"
          :routeLegs="walk.route.routeLegs"
          :startLocation="walk.route.startLocation"
          :startName="walk.route.routeOverview?.startPoint"
          :currentLocation="currentLocation"
          :momentPins="momentPins"
        />
        <div class="map-paper-label"><span :class="geoStatus">●</span>{{ geoStatus === 'active' ? '定位跟随中' : geoStatus === 'locating' ? '正在获取定位' : geoStatus === 'denied' ? '定位权限未开启' : '路线记录中' }}</div>
        <div class="walk-summary">
          <header><span>漫步进行中</span><i /></header>
          <button class="active-add-journal" @click="addRouteToJournal(walk.route)"><PhCheck v-if="isRouteInJournal(walk.route)" :size="15" /><PhPlus v-else :size="15" />{{ isRouteInJournal(walk.route) ? '路线已在手账' : '将路线添加到手账' }}</button>
          <div class="walk-metrics"><div><small>已漫步</small><strong>{{ elapsedLabel }}</strong></div><div><small>路线距离</small><strong>{{ distanceLabel }}</strong></div></div>
          <div class="current-place"><small>当前位置附近</small><strong>{{ currentStop?.name || '正在寻找附近地点...' }}</strong><p>{{ currentStop?.address }}</p></div>
          <div class="walk-progress"><span :style="{ width: `${Math.min(100, Math.max(8, (walk.moments.length + 1) / Math.max(1, walk.route.stops.length) * 100))}%` }" /></div>
          <p>{{ walk.moments.length }} 枚沿途图钉 · 计划 {{ walk.route.stops.length }} 站</p>
        </div>
      </section>

      <aside class="capture-tray">
        <div class="tray-heading"><div><small>记录这一刻</small><h3>此刻，想记下什么？</h3></div><button class="finish-btn" @click="finish">完成并上传 <PhArrowRight :size="14" /></button></div>
        <div class="capture-form">
          <label class="camera-button"><input type="file" accept="image/*" multiple capture="environment" @change="selectFiles"/><span><PhCamera :size="26" /></span><b>拍照 / 上传</b></label>
          <div class="moment-note"><textarea v-model="note" placeholder="比如：风从城墙边吹过来，桂花味很轻..."/><div class="location-chip"><PhMapPinLine :size="13" /> {{ currentStop?.name || '等待定位' }}</div></div>
          <div v-if="previewUrls.length" class="preview-strip"><img v-for="url in previewUrls" :key="url" :src="url"/></div>
          <button class="save-pin" :disabled="savingMoment || (!note.trim() && !files.length)" @click="saveMoment"><PhMapPinLine :size="16" />{{ savingMoment ? '正在保存...' : '生成沿途图钉' }}</button>
        </div>
        <div v-if="walk.moments.length" class="moment-stream">
          <article v-for="(moment, index) in [...walk.moments].reverse()" :key="moment.id">
            <span class="pin-number">{{ walk.moments.length - index }}</span>
            <img v-if="moment.photos[0]" :src="moment.photos[0].url"/>
            <div><small>{{ new Date(moment.createdAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) }} · {{ moment.stopName || '沿途' }}</small><p>{{ moment.note || '用一张照片记下这一刻。' }}</p></div>
          </article>
        </div>
      </aside>
    </template>
  </main>
</template>

<style scoped>
.walk-page { flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 380px;overflow:hidden;position:relative }.walk-map{min-width:0;min-height:0;position:relative;padding:22px}.walk-map :deep(.route-map-container){height:100%;min-height:520px;margin:0;border-radius:28px 8px 28px 8px;border:1px solid rgba(138,114,102,.22);box-shadow:0 18px 40px rgba(86,67,56,.14)}
.map-paper-label{position:absolute;top:40px;left:42px;z-index:12;padding:9px 14px;border-radius:999px;background:rgba(252,249,240,.88);border:1px solid rgba(138,114,102,.2);box-shadow:var(--shadow-paper);color:var(--text);font-size:12px;font-weight:700;backdrop-filter:blur(10px)}.map-paper-label span{margin-right:6px;color:#648900}.map-paper-label span.denied,.map-paper-label span.unavailable{color:#ba1a1a}.map-paper-label span.locating{color:#bb5808;animation:pulse-dot 1s infinite}
.walk-summary{position:absolute;top:44px;right:44px;z-index:12;width:320px;padding:25px;border-radius:24px 8px 24px 8px;background:rgba(255,255,255,.9);border:1px solid rgba(138,114,102,.18);box-shadow:0 17px 40px rgba(86,67,56,.16);backdrop-filter:blur(14px);transform:rotate(.4deg)}.walk-summary header{display:flex;justify-content:space-between;color:var(--primary);font-size:11px;font-weight:900;letter-spacing:.17em}.walk-summary header i{width:9px;height:9px;border-radius:50%;background:#648900;box-shadow:0 0 8px #648900;animation:pulse-dot 1.3s infinite}.active-add-journal{width:100%;margin-top:13px;padding:8px;border:1px solid rgba(73,104,0,.25);border-radius:999px;background:var(--secondary-container);color:var(--on-secondary-container);font-size:11px;font-weight:800;cursor:pointer}.walk-metrics{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:18px 0;padding-bottom:18px;border-bottom:1px dashed rgba(138,114,102,.26)}.walk-metrics div{display:grid}.walk-metrics small,.current-place small{color:var(--text-muted);font-size:10px;font-weight:800;letter-spacing:.11em}.walk-metrics strong{color:var(--text-h);font:700 25px var(--font-display)}.current-place{display:grid;gap:3px}.current-place strong{color:var(--primary);font:700 18px var(--font-display)}.current-place p{height:20px;overflow:hidden;color:var(--text-muted);font-size:12px}.walk-progress{height:7px;margin-top:17px;border-radius:999px;background:var(--surface-container)}.walk-progress span{display:block;height:100%;border-radius:999px;background:var(--secondary);transition:width .4s}.walk-summary>p{margin-top:7px;color:var(--text-muted);font-size:11px}
.capture-tray{min-width:0;min-height:0;display:flex;flex-direction:column;padding:25px 22px 80px;background:rgba(252,249,240,.92);border-left:1px solid rgba(138,114,102,.18);overflow-y:auto;box-shadow:-15px 0 40px rgba(86,67,56,.08)}.tray-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:17px}.tray-heading small{color:var(--primary);font-size:8px;font-weight:900;letter-spacing:.18em}.tray-heading h3{font:700 19px var(--font-display)}.finish-btn{max-width:135px;padding:8px 10px;border:0;border-radius:999px;background:var(--secondary);color:#fff;font:700 9px/1.35 var(--font-sans);cursor:pointer}.capture-form{display:grid;grid-template-columns:74px 1fr;gap:10px;padding:13px;border-radius:18px;background:rgba(255,255,255,.65);border:1px solid rgba(138,114,102,.16);box-shadow:var(--shadow-paper)}.camera-button{display:grid;place-items:center;align-content:center;gap:2px;border:1px dashed rgba(151,68,0,.36);border-radius:14px;color:var(--primary);cursor:pointer}.camera-button input{display:none}.camera-button span{font-size:25px}.camera-button b{font-size:9px}.moment-note textarea{width:100%;height:62px;padding:8px;border:0;outline:0;resize:none;background:repeating-linear-gradient(transparent,transparent 21px,rgba(138,114,102,.15) 22px);color:var(--text);font:14px/22px var(--font-hand)}.location-chip{width:fit-content;padding:3px 7px;border-radius:999px;background:var(--secondary-container);color:var(--on-secondary-container);font-size:8px}.preview-strip{grid-column:1/-1;display:flex;gap:7px;overflow-x:auto}.preview-strip img{width:60px;height:60px;object-fit:cover;border:4px solid #fff;box-shadow:0 3px 9px rgba(86,67,56,.15);transform:rotate(-2deg)}.preview-strip img:nth-child(even){transform:rotate(2deg)}.save-pin{grid-column:1/-1;padding:10px;border:0;border-radius:999px;background:var(--primary);color:#fff;font-weight:800;cursor:pointer}.save-pin:disabled{opacity:.35;cursor:not-allowed}
.moment-stream{display:grid;gap:13px;margin-top:21px}.moment-stream article{display:grid;grid-template-columns:24px auto 1fr;align-items:center;gap:9px;padding:10px;border-bottom:1px dashed rgba(138,114,102,.24);position:relative}.pin-number{width:23px;height:23px;display:grid;place-items:center;border-radius:50%;background:var(--primary);color:#fff;font:800 9px var(--font-sans);box-shadow:0 0 0 3px #fff,0 0 0 4px rgba(151,68,0,.24)}.moment-stream img{width:54px;height:54px;object-fit:cover;border:4px solid #fff;box-shadow:0 4px 10px rgba(86,67,56,.14);transform:rotate(-2deg)}.moment-stream small{color:var(--text-muted);font-size:8px}.moment-stream p{margin-top:3px;color:var(--text);font:13px/1.4 var(--font-hand)}
.route-launcher{grid-column:1/-1;min-height:100%;display:grid;grid-template-columns:minmax(300px,460px) minmax(440px,720px);place-content:center;gap:60px;padding:50px}.launch-note>span{display:grid;place-items:center;width:70px;height:70px;border:3px double var(--primary);border-radius:50%;color:var(--primary);font-size:28px;transform:rotate(-8deg)}.launch-note small{display:block;margin-top:24px;color:var(--primary);font-size:11px;font-weight:900;letter-spacing:.18em}.launch-note h2{margin:7px 0 14px;color:var(--primary);font:800 clamp(38px,5vw,62px)/1.05 var(--font-display)}.launch-note p{max-width:430px;color:var(--text);font:17px/1.75 var(--font-display)}.launch-routes{display:grid;gap:12px;align-content:center}.launch-route-card{display:grid;grid-template-columns:52px minmax(0,1fr) auto;align-items:center;gap:14px;padding:17px;border:1px solid rgba(138,114,102,.18);border-radius:18px;background:rgba(255,255,255,.68);box-shadow:var(--shadow-paper);transition:.2s}.launch-route-card:hover{transform:translateX(4px);border-color:rgba(151,68,0,.38)}.route-no{width:48px;height:48px;display:grid;place-items:center;border:2px double var(--primary);border-radius:50%;color:var(--primary);font:800 10px var(--font-sans)}.launch-route-copy{min-width:0;display:grid}.launch-route-copy small{color:var(--text-muted);font-size:10px}.launch-route-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-h);font:700 17px var(--font-display)}.launch-route-copy p{color:var(--text-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.launch-actions{display:flex;gap:7px;align-items:center}.launch-actions button{padding:8px 11px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap;cursor:pointer}.add-journal{border:1px solid rgba(73,104,0,.28);background:var(--secondary-container);color:var(--on-secondary-container)}.start-route{border:1px solid var(--primary);background:var(--primary);color:#fff}.journal-notice{padding:9px 13px;border-radius:10px;background:var(--secondary-container);color:var(--on-secondary-container);font-size:12px;font-weight:800;text-align:center}.no-route{padding:28px;color:var(--text-muted);font-size:13px;border:1px dashed rgba(138,114,102,.25);text-align:center}

@media(max-width:1100px){.walk-page{grid-template-columns:1fr 330px}.walk-summary{width:270px;right:34px}.walk-map{padding:15px}.capture-tray{padding-left:15px;padding-right:15px}.route-launcher{gap:30px;padding:35px}}
@media(max-width:780px){.walk-page{display:block;overflow-y:auto;padding-bottom:70px}.walk-map{height:65vh;min-height:540px}.walk-map :deep(.route-map-container){min-height:100%}.walk-summary{left:28px;right:28px;top:auto;bottom:35px;width:auto}.map-paper-label{left:28px;top:28px}.capture-tray{overflow:visible;padding-bottom:40px}.route-launcher{min-height:calc(100vh - 132px);display:block;padding:30px 20px 100px}.launch-note{text-align:center}.launch-note>span{margin:auto}.launch-note p{margin:0 auto 28px}.launch-route-card{grid-template-columns:45px 1fr}.launch-actions{grid-column:2;justify-content:flex-start;flex-wrap:wrap}}

/* Taste Skill redesign layer. */
.walk-map :deep(.route-map-container){border-radius:var(--radius);border-color:var(--border)}
.walk-summary{border-radius:var(--radius);border-color:var(--border);transform:none}.walk-summary header{font-size:12px;letter-spacing:.03em}.walk-summary header i{box-shadow:none}
.active-add-journal,.launch-actions button,.finish-btn,.save-pin{display:flex;align-items:center;justify-content:center;gap:6px}
.active-add-journal{border-color:var(--accent-border);background:var(--primary-fixed);color:var(--primary);font-size:12px}
.walk-metrics small,.current-place small{font-size:12px;letter-spacing:.03em}.walk-summary>p{font-size:12px}.current-place p{font-size:13px}.walk-progress span{background:var(--primary)}
.capture-tray{border-color:var(--border-subtle);box-shadow:-15px 0 40px rgba(68,48,38,.07)}.tray-heading small{font-size:12px;letter-spacing:0}.tray-heading h3{font-size:20px}.finish-btn{max-width:none;font-size:11px;background:var(--primary)}
.capture-form{border-radius:var(--radius);border-color:var(--border-subtle);box-shadow:none}.camera-button{border-color:var(--accent-border);border-radius:var(--radius-control)}.camera-button b{font-size:11px}.location-chip{display:flex;align-items:center;gap:4px;background:var(--primary-fixed);color:var(--primary);font-size:11px}.moment-stream small{font-size:11px}.moment-stream p{font-size:14px}.pin-number{background:var(--primary)}
.route-launcher{min-height:100%}.launch-note small{font-size:12px;letter-spacing:0}.launch-note h2{font-size:clamp(38px,5vw,58px);text-wrap:balance}.launch-note p{font-size:17px;text-wrap:pretty}
.launch-route-card{border-color:var(--border-subtle);border-radius:var(--radius);box-shadow:none}.launch-route-card:hover{border-color:var(--accent-border)}.route-no{border-color:var(--primary);font-size:11px}.launch-route-copy small,.launch-route-copy p{font-size:12px}.launch-actions button{font-size:12px}.add-journal{border-color:var(--accent-border);background:var(--primary-fixed);color:var(--primary)}
</style>
