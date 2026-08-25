<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue'
import { PhArrowClockwise, PhCheckCircle, PhDeviceMobile, PhMapPinLine, PhPaperPlaneTilt, PhPath } from '@phosphor-icons/vue'
import {
  apiGetActiveWalk, apiGetMobileRouteHandoff, apiListFavoriteRoutes, apiSendRouteToMobile,
  type FavoriteRoute, type MobileRouteHandoff
} from '../api/agent'
import type { useAuth } from '../composables/useAuth'
import type { ActiveWalk } from '../composables/useJournal'

const auth = inject<ReturnType<typeof useAuth>>('auth')!
const favorites = ref<FavoriteRoute[]>([])
const handoff = ref<MobileRouteHandoff | null>(null)
const activeWalk = ref<ActiveWalk | null>(null)
const loading = ref(true)
const sendingId = ref<string | null>(null)
const notice = ref('')
let pollTimer: number | undefined

const completed = computed(() => activeWalk.value?.stopProgress.filter(item => item.status === 'visited' || item.status === 'skipped').length ?? 0)

async function refresh() {
  const userId = auth.user.value?.id
  if (!userId) return
  const [favoriteResult, handoffResult, walkResult] = await Promise.allSettled([
    apiListFavoriteRoutes(userId), apiGetMobileRouteHandoff(), apiGetActiveWalk<ActiveWalk>()
  ])
  if (favoriteResult.status === 'fulfilled') favorites.value = favoriteResult.value.entries
  if (handoffResult.status === 'fulfilled') handoff.value = handoffResult.value.handoff
  if (walkResult.status === 'fulfilled') activeWalk.value = walkResult.value.session?.walk ?? null
  loading.value = false
}

async function send(favorite: FavoriteRoute) {
  if (sendingId.value) return
  sendingId.value = favorite.id
  notice.value = ''
  try {
    handoff.value = (await apiSendRouteToMobile(favorite.result)).handoff
    notice.value = '路线已经放进手机接力站，打开 Android 客户端即可接收。'
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '发送失败'
  } finally { sendingId.value = null }
}

onMounted(() => {
  void refresh()
  pollTimer = window.setInterval(() => void refresh(), 10_000)
})
onUnmounted(() => { if (pollTimer !== undefined) window.clearInterval(pollTimer) })
</script>

<template>
  <main class="mobile-companion paper-canvas">
    <header class="companion-heading">
      <div><small>MOBILE WALK COMPANION</small><h2>手机路线接力</h2><p>网页端负责规划与整理；定位、途中记录和实时改路已经交给 Android 客户端。</p></div>
      <button :disabled="loading" @click="refresh"><PhArrowClockwise :size="17" />刷新状态</button>
    </header>

    <section class="responsibility-note">
      <PhDeviceMobile :size="36" weight="duotone" />
      <div><strong>为什么网页不再直接开始漫步？</strong><p>步行过程需要持续定位、相机、锁屏后台记录和离线恢复。路线发到同一账号的手机后，完成的手账会自动回到网页书架继续 AI 排版。</p></div>
    </section>

    <p v-if="notice" class="notice">{{ notice }}</p>

    <section v-if="activeWalk" class="active-mobile-walk">
      <div class="live-dot"><i />LIVE ON ANDROID</div>
      <h3>{{ activeWalk.route.title }}</h3>
      <p>{{ activeWalk.route.stops.map(stop => stop.name).join(' → ') }}</p>
      <div class="walk-progress"><span :style="{ width: `${Math.max(7, completed / Math.max(1, activeWalk.stopProgress.length) * 100)}%` }" /></div>
      <footer><span><PhPath :size="16" />{{ completed }}/{{ activeWalk.stopProgress.length }} 站</span><span><PhMapPinLine :size="16" />{{ activeWalk.moments.length }} 枚图钉</span><small>手机更新于 {{ new Date(activeWalk.updatedAt).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' }) }}</small></footer>
    </section>

    <section v-else-if="handoff" class="handoff-waiting">
      <PhPaperPlaneTilt :size="30" weight="duotone" />
      <div><small>等待手机接收</small><strong>{{ handoff.route.title }}</strong><p>请在 Android 客户端的“路线”页下拉刷新并点击“接收并开始漫步”。</p></div>
    </section>

    <section v-else class="empty-status">
      <PhCheckCircle :size="30" /><div><strong>目前没有进行中的路线</strong><p>从下方收藏路线中选择一条发送到手机。</p></div>
    </section>

    <section class="send-list">
      <header><div><small>SAVED ROUTES</small><h3>发送一条收藏路线</h3></div><span>{{ favorites.length }} 条</span></header>
      <article v-for="favorite in favorites" :key="favorite.id">
        <span class="route-count">{{ favorite.result.stops.length }}站</span>
        <div><small>{{ favorite.result.routeOverview?.city || favorite.result.constraints.city }}</small><strong>{{ favorite.result.title }}</strong><p>{{ favorite.result.stops.map(stop => stop.name).join(' · ') }}</p></div>
        <button :disabled="Boolean(sendingId)" @click="send(favorite)"><PhPaperPlaneTilt :size="15" />{{ sendingId === favorite.id ? '发送中' : '发到手机' }}</button>
      </article>
      <p v-if="!loading && !favorites.length" class="no-routes">还没有收藏路线。回到 Agent 页生成路线并点击“收藏路线”。</p>
    </section>
  </main>
</template>

<style scoped>
.mobile-companion{flex:1;min-height:0;overflow-y:auto;padding:34px clamp(24px,6vw,82px) 80px;background:radial-gradient(circle at 88% 12%,rgba(229,235,211,.8),transparent 28%),var(--bg);color:var(--text)}
.companion-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;max-width:1050px;margin:0 auto}.companion-heading small,.send-list header small{color:var(--primary);font-size:12px;font-weight:900;letter-spacing:.08em}.companion-heading h2{margin:5px 0;color:var(--text-h);font:750 34px var(--font-display)}.companion-heading p{max-width:680px;color:var(--text-muted);font-size:15px;line-height:1.7}.companion-heading button,.send-list article button{display:flex;align-items:center;gap:6px;padding:9px 13px;border:1px solid var(--border);border-radius:var(--radius-control);background:var(--surface);color:var(--primary);font-weight:800;cursor:pointer;white-space:nowrap}
.responsibility-note,.active-mobile-walk,.handoff-waiting,.empty-status,.send-list{max-width:1050px;margin:22px auto 0;border:1px solid var(--border);border-radius:var(--radius);background:rgba(255,255,255,.72)}.responsibility-note{display:flex;align-items:center;gap:18px;padding:20px;color:var(--on-secondary-container);background:var(--secondary-container)}.responsibility-note strong{font-size:15px}.responsibility-note p{margin-top:4px;font-size:13px;line-height:1.65}.notice{max-width:1050px;margin:14px auto 0;padding:10px 13px;border-radius:10px;background:var(--primary-fixed);color:var(--primary);font-size:13px;font-weight:750}
.active-mobile-walk{padding:23px}.live-dot{display:flex;align-items:center;gap:7px;color:#53683d;font-size:11px;font-weight:900;letter-spacing:.09em}.live-dot i{width:8px;height:8px;border-radius:50%;background:#657b48;animation:pulse-dot 1.3s infinite}.active-mobile-walk h3{margin-top:8px;font:750 23px var(--font-display)}.active-mobile-walk>p{margin-top:5px;color:var(--text-muted);font-size:13px}.walk-progress{height:7px;margin-top:18px;border-radius:99px;background:var(--surface-container)}.walk-progress span{display:block;height:100%;border-radius:99px;background:var(--secondary);transition:width .3s}.active-mobile-walk footer{display:flex;align-items:center;gap:18px;margin-top:12px;color:var(--text-muted);font-size:12px}.active-mobile-walk footer span{display:flex;align-items:center;gap:5px;color:var(--text);font-weight:800}.active-mobile-walk footer small{margin-left:auto}
.handoff-waiting,.empty-status{display:flex;align-items:center;gap:16px;padding:21px}.handoff-waiting{color:var(--primary);background:var(--primary-fixed)}.handoff-waiting>div,.empty-status>div{display:grid;gap:3px}.handoff-waiting small{font-weight:900}.handoff-waiting strong,.empty-status strong{color:var(--text-h);font-size:17px}.handoff-waiting p,.empty-status p{color:var(--text-muted);font-size:13px}.empty-status svg{color:var(--secondary)}
.send-list{padding:21px}.send-list>header{display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:13px;border-bottom:1px solid var(--border)}.send-list h3{margin-top:3px;font:730 21px var(--font-display)}.send-list>header>span{color:var(--text-muted);font-size:12px}.send-list article{display:grid;grid-template-columns:48px minmax(0,1fr) auto;align-items:center;gap:13px;padding:15px 3px;border-bottom:1px dashed var(--border)}.route-count{width:44px;height:44px;display:grid;place-items:center;border:1px solid var(--accent-border);border-radius:50%;color:var(--primary);font-size:10px;font-weight:900}.send-list article>div{min-width:0;display:grid}.send-list article small{color:var(--secondary);font-size:11px;font-weight:800}.send-list article strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-h);font-size:15px}.send-list article p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:12px}.send-list article button{border-color:var(--primary);background:var(--primary);color:#fff}.send-list button:disabled,.companion-heading button:disabled{opacity:.45}.no-routes{padding:28px;text-align:center;color:var(--text-muted);font-size:13px}
@media(max-width:700px){.mobile-companion{padding:24px 16px 100px}.companion-heading{display:grid}.companion-heading button{width:fit-content}.responsibility-note{align-items:flex-start}.active-mobile-walk footer{align-items:flex-start;flex-wrap:wrap}.active-mobile-walk footer small{width:100%;margin-left:0}.send-list article{grid-template-columns:42px 1fr}.send-list article button{grid-column:2;width:fit-content}.companion-heading h2{font-size:29px}}
</style>
