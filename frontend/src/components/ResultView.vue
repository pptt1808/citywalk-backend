<script setup lang="ts">
import { inject, computed, ref, watch } from 'vue'
import { PhArrowSquareOut, PhHeart, PhMapPinLine, PhMapTrifold, PhNavigationArrow, PhPath } from '@phosphor-icons/vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import { CAT_LABEL } from '../constants'
import { apiFavoriteRoute, apiListFavoriteRoutes, apiSendRouteToMobile, apiUnfavoriteRoute, type PlanningResult, type RouteLeg } from '../api/agent'
import { getMemoryUserId } from '../utils/identity'
import RouteMap from './RouteMap.vue'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const props = defineProps<{ value?: PlanningResult }>()
const result = computed(() => props.value ?? agent.result.value)
const isRoute = computed(() => (result.value?.responseKind ?? 'route') === 'route')
const favoriteUserId = getMemoryUserId()
const favoriteId = ref<string | null>(null)
const favoriteBusy = ref(false)
const favoriteError = ref<string | null>(null)
const copiedTone = ref<string | null>(null)
const handoffBusy = ref(false)
const handoffSent = ref(false)

watch(result, async (value) => {
  favoriteId.value = null
  handoffSent.value = false
  if (!value || !isRoute.value || !favoriteUserId) return
  try {
    const data = await apiListFavoriteRoutes(favoriteUserId)
    const key = JSON.stringify({ title: value.title, stops: value.stops.map(stop => stop.name) })
    favoriteId.value = data.entries.find(item => item.result.historyId === value.historyId
      || JSON.stringify({ title: item.result.title, stops: item.result.stops.map(stop => stop.name) }) === key)?.id ?? null
  } catch { /* 收藏状态读取失败不影响结果展示 */ }
}, { immediate: true })

async function toggleFavorite() {
  if (!result.value || !isRoute.value || !favoriteUserId || favoriteBusy.value) return
  if (!result.value.historyId) {
    favoriteError.value = '这条路线没有服务端历史编号，请重新生成后再收藏'
    return
  }
  favoriteBusy.value = true
  favoriteError.value = null
  try {
    if (favoriteId.value) {
      await apiUnfavoriteRoute(favoriteId.value, favoriteUserId)
      favoriteId.value = null
    } else {
      const saved = await apiFavoriteRoute(favoriteUserId, result.value.historyId)
      favoriteId.value = saved.id
    }
    window.dispatchEvent(new CustomEvent('citywalk:favorites-changed'))
  } catch (error) {
    favoriteError.value = error instanceof Error ? error.message : '收藏操作失败，请稍后重试'
  } finally {
    favoriteBusy.value = false
  }
}

async function sendToMobile() {
  if (!result.value || !isRoute.value || handoffBusy.value) return
  handoffBusy.value = true
  favoriteError.value = null
  try {
    await apiSendRouteToMobile(result.value)
    handoffSent.value = true
  } catch (error) {
    favoriteError.value = error instanceof Error ? error.message : '路线发送到手机失败'
  } finally {
    handoffBusy.value = false
  }
}

async function copyVariant(tone: string, text: string, hashtags: string[]) {
  const content = `${text} ${hashtags.map(tag => `#${tag}`).join(' ')}`
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(content)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = content
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }
    copiedTone.value = tone
    window.setTimeout(() => { if (copiedTone.value === tone) copiedTone.value = null }, 1600)
  } catch {
    copiedTone.value = null
  }
}

const weatherInfo = computed(() => {
  const r = result.value?.routeOverview?.weather.risk ?? result.value?.weatherRisk
  if (r === 'low') return { text: '适合漫步', cls: 'wt-low' }
  if (r === 'medium') return { text: '留意变化', cls: 'wt-mid' }
  if (r === 'high') return { text: '需要备选', cls: 'wt-high' }
  return { text: '等待数据', cls: '' }
})

function transportLabel(mode?: RouteLeg['mode']): string {
  return mode === 'transit' ? '公交地铁' : mode === 'bicycling' ? '骑行' : '步行'
}

const routeMins = computed(() => (result.value?.routeLegs ?? []).reduce((s, l) => s + l.durationMinutes, 0))
const stayMins  = computed(() => (result.value?.stops ?? []).reduce((s, st) => s + st.estimatedStayMinutes, 0))
const routeTradeoffs = computed(() => result.value?.tradeoffs ?? result.value?.routeOverview?.tradeoffs ?? [])
const visibleImportantNotes = computed(() => {
  const notes = result.value?.routeOverview?.importantNotes ?? []
  return routeTradeoffs.value.length ? notes.filter(note => !note.startsWith('取舍说明：')) : notes
})

function tradeoffLabel(kind: 'conflict' | 'uncertainty', severity: 'info' | 'warning' | 'critical'): string {
  if (severity === 'critical') return '需要选择'
  return kind === 'uncertainty' ? '需要核验' : severity === 'warning' ? '已做取舍' : '优化取舍'
}

function fmtTime(m: number): string {
  const h = Math.floor(m / 60), r = m % 60
  return h === 0 ? `${r} 分钟` : r > 0 ? `${h} 小时 ${r} 分钟` : `${h} 小时`
}
function fmtDist(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m'
}
function fmtClock(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
    : ''
}

function legForStop(index: number): RouteLeg | undefined {
  const stop = result.value?.stops[index]
  return result.value?.routeLegs?.find((leg) => leg.destinationName === stop?.name)
    ?? result.value?.routeLegs?.[index]
}

const intentLabel = computed(() => ({
  comparison: '路线比较', information: '信息查询', memory: '记忆与历史', social_copy: '分享文案', chat: 'CityWalk Agent', route: '路线规划'
} as Record<string, string>)[result.value?.responseKind ?? 'information'] ?? '回答结果')
</script>

<template>
  <div class="result-view" v-if="result">
    <section v-if="result.skillExecutions?.length" class="skill-execution-summary" aria-label="Skill 执行结果">
      <div class="skill-execution-heading"><strong>本轮已应用能力</strong><small>当前用户要求优先；冲突与未识别规则会明确标出</small></div>
      <div class="skill-execution-list">
        <article v-for="execution in result.skillExecutions" :key="execution.skillId" :class="`skill-execution ${execution.status}`">
          <strong>{{ execution.name }}</strong><span>{{ execution.status === 'applied' ? '已应用' : execution.status === 'partially_applied' ? '部分应用' : '未应用' }}</span>
          <small v-if="execution.overriddenRules.length">已被本轮要求覆盖：{{ execution.overriddenRules.join('；') }}</small>
          <small v-if="execution.unsupportedRules.length">仍需人工确认：{{ execution.unsupportedRules.join('；') }}</small>
        </article>
      </div>
    </section>

    <div v-if="!isRoute" class="answer-view">
      <div class="answer-hero">
        <span class="hero-badge">{{ intentLabel }}</span>
        <h1>{{ result.title }}</h1>
        <p>{{ result.answer || result.summary }}</p>
      </div>
      <div v-if="result.sections?.length" class="answer-sections">
        <section v-for="section in result.sections" :key="section.title" class="answer-section">
          <h2>{{ section.title }}</h2>
          <ul><li v-for="item in section.items" :key="item">{{ item }}</li></ul>
        </section>
      </div>
      <div v-if="result.comparison" class="comparison-card">
        <h2>比较结果</h2>
        <p v-if="result.comparison.recommendation">{{ result.comparison.recommendation }}</p>
        <div v-for="option in result.comparison.options" :key="option.name" class="comparison-option">
          <strong>{{ option.name }}</strong>
          <span v-for="(value, key) in option.metrics" :key="key">{{ key }}：{{ value }}</span>
          <small v-if="option.pros.length">优点：{{ option.pros.join('、') }}</small>
          <small v-if="option.cons.length">注意：{{ option.cons.join('、') }}</small>
        </div>
        <p v-if="result.comparison.missingInformation?.length" class="muted">还缺少：{{ result.comparison.missingInformation.join('、') }}</p>
      </div>
      <div v-if="result.socialCopy?.variants.length" class="copy-list">
        <p v-if="result.socialCopy.generationDiagnostics?.regeneration?.attempted" class="copy-diagnostic">
          已根据「{{ result.socialCopy.generationDiagnostics.regeneration.reasons.join('；') }}」重新生成一次<span v-if="result.socialCopy.generationDiagnostics.fallbackTriggered">，第二次仍未完全满足约束，已保留安全版本。</span><span v-else>，本次已通过约束检查。</span>
        </p>
        <div v-if="result.socialCopy.styleProfile" class="copy-style-summary">
          <span>本次声口</span><strong>{{ result.socialCopy.styleProfile.label }}</strong>
          <p>{{ result.socialCopy.styleProfile.signature.narrativeMove }}</p>
        </div>
        <div v-for="variant in result.socialCopy.variants" :key="variant.tone" class="copy-card">
          <div><strong>{{ variant.tone }}</strong><button class="copy-btn" @click="copyVariant(variant.tone, variant.text, variant.hashtags)">{{ copiedTone === variant.tone ? '已复制' : '复制' }}</button></div>
          <p>{{ variant.text }}</p>
          <small v-if="variant.hashtags.length">{{ variant.hashtags.map(tag => `#${tag}`).join(' ') }}</small>
        </div>
      </div>
      <div v-if="result.sources?.length" class="sources-card">
        <div class="sources-heading"><h2>参考来源</h2><span>链接由服务端检索并校验</span></div>
        <a
          v-for="source in result.sources"
          :key="source.url"
          class="source-item"
          :href="source.url"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="source-badge" :class="source.sourceType === 'official_link' ? 'official' : 'unverified'">
            {{ source.sourceType === 'official_link' ? '官方来源' : '未核验' }}
          </span>
          <span class="source-main"><strong>{{ source.title }}</strong><small>{{ source.domain }}<span v-if="source.snippet"> · {{ source.snippet }}</span></small></span>
          <span class="source-arrow"><PhArrowSquareOut :size="17" /></span>
        </a>
      </div>
    </div>

    <section v-if="isRoute" class="hero">
      <div class="hero-top">
        <div class="hero-text">
          <span class="hero-badge">{{ result.routeOverview?.city || 'CITYWALK' }} · {{ result.routeOverview?.startPoint || '路线规划完成' }}</span>
          <h1 class="hero-summary">{{ result.title }}</h1>
          <p class="hero-compact">{{ result.answer || result.summary }}</p>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hstat"><span class="hstat-lbl">预计耗时</span><span class="hstat-val">{{ fmtTime(result.totalEstimatedMinutes) }}</span><small v-if="result.routeOverview?.time.startAt">{{ fmtClock(result.routeOverview.time.startAt) }}–{{ fmtClock(result.routeOverview.time.endAt) }} · 移动 {{ fmtTime(routeMins) }}</small><small v-else>移动 {{ fmtTime(routeMins) }} · 停留 {{ fmtTime(stayMins) }}</small></div>
        <div class="hstat"><span class="hstat-lbl">预计花费</span><span class="hstat-val">¥{{ result.totalEstimatedCost }}</span><small v-if="result.routeOverview?.cost.perPerson">约人均 ¥{{ result.routeOverview.cost.perPerson }}</small><small v-else>按当前同行人数估算</small></div>
        <div class="hstat"><span class="hstat-lbl">路线规模</span><span class="hstat-val">{{ result.stops.length }} 个地点</span><small>从 {{ result.routeOverview?.startPoint || '起点' }} 出发</small></div>
        <div class="hstat"><span class="hstat-lbl">出行时段天气</span><span class="hstat-val" :class="weatherInfo.cls">{{ weatherInfo.text }}</span><small>{{ result.routeOverview?.weather.summary || '暂无天气摘要' }}</small></div>
      </div>
      <div class="route-sequence" aria-label="路线顺序">
        <span class="sequence-start"><small>起点</small><strong>{{ result.routeOverview?.startPoint || '起点' }}</strong></span>
        <template v-for="(stop, index) in result.stops" :key="stop.name">
          <i />
          <span class="sequence-stop"><b>{{ fmtClock(stop.estimatedArrivalAt) || String(index + 1).padStart(2, '0') }}</b><strong>{{ stop.name }}</strong></span>
        </template>
      </div>
      <div v-if="result.routeOverview" class="route-briefing">
        <section v-if="visibleImportantNotes.length" class="important-notes"><strong>出发前留意</strong><ul><li v-for="note in visibleImportantNotes" :key="note">{{ note }}</li></ul></section>
        <section class="weather-detail"><strong>天气补充</strong><p v-if="result.routeOverview.weather.decisionUsable !== false">降雨概率 {{ result.routeOverview.weather.rainProbability }}%<span v-if="result.routeOverview.weather.airQuality"> · AQI {{ result.routeOverview.weather.airQuality.aqi }}，{{ result.routeOverview.weather.airQuality.category }}</span></p><p v-else>缺少与本次出行时间匹配的天气数据</p><ul v-if="result.routeOverview.weather.advice.length"><li v-for="advice in result.routeOverview.weather.advice" :key="advice">{{ advice }}</li></ul></section>
      </div>
      <section v-if="routeTradeoffs.length" class="tradeoff-section" aria-label="约束冲突与当前取舍">
        <div class="tradeoff-heading"><div><strong>约束冲突与当前取舍</strong><small>你可以按下面的备选方向继续修改路线</small></div></div>
        <article v-for="tradeoff in routeTradeoffs" :key="tradeoff.id" class="tradeoff-card" :class="`severity-${tradeoff.severity}`">
          <div class="tradeoff-title"><span>{{ tradeoffLabel(tradeoff.kind, tradeoff.severity) }}</span><strong>{{ tradeoff.issue }}</strong></div>
          <p><b>当前选择</b>{{ tradeoff.decision }}</p>
          <div v-if="tradeoff.alternatives.length" class="tradeoff-options"><b>你可以改为</b><span v-for="option in tradeoff.alternatives" :key="option">{{ option }}</span></div>
        </article>
      </section>
      <div v-if="result.sources?.length" class="sources-card route-sources">
        <div class="sources-heading"><h2>官方信息参考</h2><span>预约与临时公告请打开链接确认</span></div>
        <a v-for="source in result.sources" :key="source.url" class="source-item" :href="source.url" target="_blank" rel="noopener noreferrer">
          <span class="source-badge" :class="source.sourceType === 'official_link' ? 'official' : 'unverified'">{{ source.sourceType === 'official_link' ? '官方来源' : '未核验' }}</span>
          <span class="source-main"><strong>{{ source.title }}</strong><small>{{ source.domain }}</small></span><span class="source-arrow"><PhArrowSquareOut :size="17" /></span>
        </a>
      </div>
      <div class="hero-footer">
        <p v-if="favoriteError" class="favorite-error">{{ favoriteError }}</p>
        <div class="hero-actions">
          <button class="favorite-btn" :class="{ saved: favoriteId }" :disabled="favoriteBusy || !favoriteUserId" @click="toggleFavorite">
            <PhHeart :size="17" :weight="favoriteId ? 'fill' : 'regular'" />
            {{ favoriteId ? '已收藏' : '收藏路线' }}
          </button>
          <button class="start-walk-btn" :disabled="handoffBusy" @click="sendToMobile">
            <PhNavigationArrow :size="17" weight="fill" />
            {{ handoffBusy ? '发送中…' : handoffSent ? '已发送到手机' : '发送到手机' }}
          </button>
        </div>
      </div>
    </section>

    <!-- ── Timeline ── -->
    <div v-if="isRoute" class="tl-head">
      <span class="section-index"><PhPath :size="18" /></span><div><span class="tl-head-title">详细路线</span><small>按实际行走顺序排列</small></div>
    </div>

    <div v-if="isRoute" class="timeline">
      <div v-for="(stop, idx) in result.stops" :key="idx" class="tl-item">
        <div class="tl-rail">
          <div class="tl-node" :class="`n-${stop.category}`">{{ idx + 1 }}</div>
          <div class="tl-line" v-if="idx < result.stops.length - 1" />
        </div>

        <div class="tl-card">
          <div class="tl-leg" v-if="legForStop(idx)">
            <div class="tl-leg-icon">{{ transportLabel(legForStop(idx)!.mode) }}</div>
            <div class="tl-leg-body">
              <span class="tl-leg-mode">{{ legForStop(idx)!.originName ?? legForStop(idx)!.origin }} → {{ legForStop(idx)!.destinationName ?? legForStop(idx)!.destination }}</span>
              <span v-if="legForStop(idx)!.samePlaceTransfer" class="tl-leg-dist">同一场馆或相邻入口内移动<span v-if="legForStop(idx)!.durationMinutes"> · 约 {{ legForStop(idx)!.durationMinutes }} 分钟</span></span>
              <span v-else class="tl-leg-dist">{{ fmtDist(legForStop(idx)!.distanceMeters) }} · {{ legForStop(idx)!.durationMinutes }} 分钟<span v-if="legForStop(idx)!.estimated"> · 示意估算</span></span>
              <span v-if="legForStop(idx)!.fallbackReason" class="tl-leg-note">{{ legForStop(idx)!.fallbackReason }}</span>
            </div>
          </div>
          <div class="tl-top">
            <h3 class="tl-name">{{ stop.name }}</h3>
            <span class="tl-tag">{{ CAT_LABEL[stop.category] }}<template v-if="stop.subtype"> · {{ stop.subtype }}</template></span>
            <span class="tl-cost"><small>预计</small> ¥{{ stop.estimatedCost }}</span>
          </div>

          <p class="tl-hl" v-if="stop.highlight">{{ stop.highlight }}</p>
          <p class="tl-reason" v-if="stop.reason">{{ stop.reason }}</p>
          <div class="tl-suitability" v-if="stop.suitabilityTags?.length || stop.styleMatches?.length">
            <span v-for="tag in [...(stop.suitabilityTags ?? []), ...(stop.styleMatches ?? []).map(item => `风格：${item}`)]" :key="tag">{{ tag }}</span>
          </div>

          <p class="tl-addr" v-if="stop.address">
            <PhMapPinLine :size="14" />
            {{ stop.address }}
          </p>

          <div class="tl-meta">
            <span class="tl-chip star" v-if="stop.rating">评分 {{ stop.rating.toFixed(1) }}</span>
            <span class="tl-chip" v-if="stop.estimatedArrivalAt">{{ fmtClock(stop.estimatedArrivalAt) }} 到达 · {{ fmtClock(stop.estimatedDepartureAt) }} 离开</span>
            <span class="tl-chip">建议停留 {{ fmtTime(stop.estimatedStayMinutes) }}</span>
            <span class="tl-chip" v-if="stop.distanceMeters">距起点 {{ fmtDist(stop.distanceMeters) }}</span>
            <span class="tl-chip discovery" v-if="stop.discoverySource === 'web' && stop.verificationStatus === 'map_matched'">公开发现 · 高德核验</span>
            <a v-if="stop.evidenceUrls?.[0]" class="tl-source-link" :href="stop.evidenceUrls[0]" target="_blank" rel="noopener noreferrer">查看发现来源</a>
          </div>

          <div v-if="stop.costBreakdown || stop.bookingInfo" class="tl-info-grid">
            <div class="tl-info cost" v-if="stop.costBreakdown">
              <strong>费用</strong><span>{{ stop.costBreakdown }}</span>
            </div>
            <div class="tl-info book" v-if="stop.bookingInfo" :class="{ warn: !stop.bookingInfo.includes('免预约') && !stop.bookingInfo.includes('直接') }">
              <strong>预约</strong><span>{{ stop.bookingInfo }}</span>
            </div>
          </div>

        </div>
      </div>
    </div>

    <div v-if="isRoute" class="map-section">
      <div class="tl-head"><span class="section-index"><PhMapTrifold :size="18" /></span><div><span class="tl-head-title">路线地图</span><small>低饱和底图，节点与路线信息保持一致</small></div></div>
      <RouteMap :stops="result.stops" :routeLegs="result.routeLegs" :startLocation="result.startLocation" :startName="result.routeOverview?.startPoint" />
    </div>

  </div>
</template>

<style scoped>
.result-view {
  display: flex; flex-direction: column; gap: 32px;
  padding: 28px 36px 48px;
  overflow-y: auto; flex: 1;
}

/* ── Hero ── */
.hero {
  display: flex; flex-direction: column; gap: 28px;
  padding: 30px 32px;
  background: linear-gradient(135deg, #faf7f2 0%, #fefdfb 50%, #faf8f5 100%);
  border: 1px solid #e8dfd4; border-radius: 18px;
  box-shadow: 0 2px 16px rgba(0,0,0,.03);
}
.hero-top { display: flex; gap: 18px; align-items: flex-start; }
.hero-icon-box {
  width: 52px; height: 52px; border-radius: 16px;
  background: #fff; border: 1px solid #e8dfd4;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.hero-text { flex: 1; min-width: 0; }
.hero-footer { display: flex; align-items: center; justify-content: flex-end; gap: 16px; padding-top: 4px; }
.hero-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.favorite-btn {
  border: 1px solid var(--accent-border); background: #fff; color: var(--accent);
  border-radius: 999px; padding: 9px 15px; font: inherit; font-size: 13px; font-weight: 650;
  cursor: pointer; white-space: nowrap;
}
.skill-execution-summary{padding:14px 16px;border:1px solid var(--border-subtle);border-radius:var(--radius);background:rgba(255,255,255,.58)}.skill-execution-heading{display:flex;align-items:baseline;gap:10px}.skill-execution-heading strong{color:var(--primary);font-size:14px}.skill-execution-heading small{color:var(--text-muted);font-size:11px}.skill-execution-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.skill-execution{display:grid;grid-template-columns:auto auto;gap:2px 7px;padding:7px 10px;border-radius:10px;background:var(--surface-container)}.skill-execution strong{font-size:12px}.skill-execution span{font-size:11px;color:var(--secondary)}.skill-execution small{grid-column:1/-1;color:var(--text-muted);font-size:10px;line-height:1.4}.skill-execution.partially_applied span{color:#936000}.skill-execution.skipped span{color:#93000a}
.favorite-btn.saved { background: #fff5f0; }
.favorite-btn:disabled { opacity: .55; cursor: wait; }
.start-walk-btn { border: 1px solid var(--primary); background: var(--primary); color: #fff; border-radius: 999px; padding: 9px 15px; font: 700 13px var(--font-sans); cursor: pointer; box-shadow: 0 6px 15px rgba(151,68,0,.2); }
.start-walk-btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
.favorite-error { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 12px; font-size: 12px; margin: 0 auto 0 0; }
.sources-card { display: flex; flex-direction: column; gap: 8px; padding: 16px; background: #fff; border: 1px solid #e8dfd4; border-radius: 12px; }
.route-sources { margin-top: -12px; }
.sources-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 2px; }
.sources-heading h2 { margin: 0; font-size: 15px; color: var(--text-h); }
.sources-heading span { color: var(--text-muted); font-size: 11px; }
.source-item { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px 10px; color: inherit; text-decoration: none; border-radius: 8px; background: #faf8f5; transition: background .15s; }
.source-item:hover { background: #fff3ec; }
.source-badge { flex-shrink: 0; padding: 3px 6px; border-radius: 5px; font-size: 11px; font-weight: 700; }
.source-badge.official { color: #166534; background: #dcfce7; }
.source-badge.unverified { color: #92400e; background: #fef3c7; }
.source-main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.source-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--text-h); }
.source-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--text-muted); }
.source-arrow { color: var(--accent); font-size: 16px; }
.hero-badge {
  display: inline-block;
  font-size: 11px; font-weight: 700; letter-spacing: .1em;
  text-transform: uppercase; color: var(--accent);
  background: #fff5f0; border: 1px solid var(--accent-border);
  padding: 4px 12px; border-radius: 999px; margin-bottom: 10px;
}
.hero-summary {
  font-size: 20px; font-weight: 700; color: #1e1918;
  line-height: 1.55; letter-spacing: -.01em;
}
.hero-compact { color: var(--text-muted); font-size: 14px; margin-top: 5px; }
.hero-stats {
  display: grid; grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid #e8dfd4; padding-top: 24px;
}
.hstat { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 0 16px; }
.hstat + .hstat { border-left: 1px solid #ece6dc; }
.hstat-icon { font-size: 28px; }
.hstat-val { font-size: 19px; font-weight: 700; color: var(--text-h); text-align: center; }
.hstat-lbl { font-size: 13px; color: var(--text-muted); text-align: center; line-height: 1.5; }
.wt-low  { color: #059669; }
.wt-mid  { color: #d97706; }
.wt-high { color: #dc2626; }
.important-notes, .weather-detail { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.important-notes { border-top: 1px solid #e8dfd4; padding-top: 20px; }
.important-notes strong { margin-right: 4px; color: var(--text-h); font-size: 13px; }
.important-notes span, .weather-detail span, .tl-suitability span {
  border: 1px solid var(--border); background: #fff; border-radius: 999px;
  padding: 6px 10px; color: var(--text-muted); font-size: 12.5px;
}
.weather-detail { background: #f7fbff; border: 1px solid #dbeafe; border-radius: 12px; padding: 14px; }
.weather-detail span { background: transparent; border-color: #bfdbfe; color: #1e4f7a; }

.answer-view { display: flex; flex-direction: column; gap: 22px; max-width: 900px; width: 100%; margin: 0 auto; }
.answer-hero, .answer-section, .comparison-card, .copy-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 26px 28px;
  box-shadow: 0 2px 10px rgba(0,0,0,.03);
}
.answer-hero h1 { color: var(--text-h); font-size: 24px; margin: 2px 0 12px; }
.answer-hero p, .comparison-card > p { color: var(--text); font-size: 15px; line-height: 1.8; }
.answer-sections, .copy-list { display: grid; gap: 14px; }
.copy-diagnostic { margin: 0; padding: 9px 12px; border-left: 3px solid var(--secondary); background: var(--surface-2); color: var(--text-muted); font-size: 12px; line-height: 1.55; }
.copy-style-summary { display: grid; grid-template-columns: auto 1fr; gap: 5px 11px; padding: 15px 18px; border-left: 3px solid var(--secondary); background: var(--surface-2); }
.copy-style-summary span { color: var(--text-muted); font-size: 12px; }
.copy-style-summary strong { color: var(--text-h); font-size: 14px; }
.copy-style-summary p { grid-column: 1 / -1; color: var(--text-muted); font-size: 13px; line-height: 1.65; }
.answer-section h2, .comparison-card h2 { color: var(--text-h); font-size: 16px; margin-bottom: 12px; }
.answer-section ul { display: grid; gap: 9px; padding-left: 20px; color: var(--text); line-height: 1.65; }
.comparison-option { display: grid; gap: 8px; padding: 16px 0; border-top: 1px solid var(--border); }
.comparison-option span, .comparison-option small, .muted { color: var(--text-muted); line-height: 1.6; }
.copy-card > div { display: flex; align-items: center; justify-content: space-between; }
.copy-card p { color: var(--text-h); line-height: 1.8; margin: 14px 0; }
.copy-card small { color: var(--accent); }
.copy-btn { border: 1px solid var(--border); background: var(--surface-2); border-radius: 8px; padding: 5px 10px; cursor: pointer; }
.map-section { display: flex; flex-direction: column; gap: 16px; }

/* ── Timeline heading ── */
.tl-head { display: flex; align-items: center; gap: 12px; }
.tl-head-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
.tl-head-title { font-size: 16px; font-weight: 700; color: var(--text-h); letter-spacing: -.01em; }

/* ── Timeline ── */
.timeline { display: flex; flex-direction: column; }
.tl-item { display: flex; gap: 18px; }
.tl-rail { display: flex; flex-direction: column; align-items: center; width: 32px; flex-shrink: 0; padding-top: 22px; }
.tl-node {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 800; color: #fff; flex-shrink: 0;
  box-shadow: 0 3px 12px rgba(0,0,0,.18);
}
.n-bookstore  { background: #6366f1; }
.n-cafe       { background: #a855f7; }
.n-museum     { background: #0ea5e9; }
.n-sight      { background: #f59e0b; }
.n-mall       { background: #ec4899; }
.n-park       { background: #10b981; }
.n-restaurant { background: #ef4444; }
.n-shop       { background: #8a6754; }
.n-market     { background: #b7791f; }
.n-studio     { background: #7c5c8f; }
.n-street_scene { background: #64748b; }
.n-event      { background: #b45365; }
.tl-line {
  width: 2px; flex: 1; min-height: 22px;
  background: linear-gradient(to bottom, var(--accent-border) 0%, var(--border) 60%, transparent 100%);
  margin: 8px 0;
}

.tl-card {
  flex: 1; min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 28px 30px;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,.03);
  transition: border-color .25s, box-shadow .25s;
}
.tl-card:hover { border-color: var(--accent-border); box-shadow: 0 6px 24px rgba(0,0,0,.06); }

.tl-top { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 12px; }
.tl-name { font-size: 20px; font-weight: 700; color: var(--text-h); letter-spacing: -.01em; }
.tl-tag {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; color: var(--text-muted);
  background: var(--surface-2); border: 1px solid var(--border);
  padding: 4px 12px; border-radius: 999px;
}
.tl-cost {
  margin-left: auto;
  font-size: 22px; font-weight: 700; color: #065f46;
  background: #ecfdf5; border: 1px solid #a7f3d0;
  padding: 6px 16px; border-radius: 10px;
}

.tl-hl {
  font-size: 14.5px; color: var(--accent); line-height: 1.65;
  padding: 10px 16px;
  background: linear-gradient(135deg, #fff8f5, #fff5f0);
  border-left: 3px solid var(--accent);
  border-radius: 0 8px 8px 0;
  margin-bottom: 12px;
}
.tl-reason { color: var(--text); font-size: 14px; line-height: 1.7; margin-bottom: 10px; }
.tl-suitability { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 14px; }
.tl-addr {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; color: var(--text-muted);
  margin-bottom: 12px;
}
.tl-addr svg { flex-shrink: 0; opacity: .4; }

.tl-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.tl-chip.discovery { color: #6f5143; background: #f7efe5; border-color: #dcc7b2; }
.tl-source-link { align-self: center; color: #7a5a49; font-size: 12px; text-decoration: underline; text-underline-offset: 3px; }
.tl-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px; padding: 5px 12px; border-radius: 999px;
  background: var(--surface-2); border: 1px solid var(--border);
  color: var(--text-muted);
}
.tl-chip.star { color: #d97706; background: #fffbeb; border-color: #fde68a; }

.tl-info-grid { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.tl-info {
  display: flex; align-items: flex-start; gap: 10px;
  font-size: 14px; line-height: 1.65; padding: 12px 16px;
  border-radius: 10px; border: 1px solid;
}
.tl-info.cost { background: #fefce8; color: #854d0e; border-color: #fde68a; }
.tl-info.book { background: #f0f9ff; color: #075985; border-color: #bae6fd; }
.tl-info.warn { background: #fef2f2; color: #991b1b; border-color: #fecaca; }

.tl-leg {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px;
  background: #faf9f7; border: 1px solid #e8dfd4;
  border-radius: 12px;
  margin-bottom: 18px;
}
.tl-leg-icon { font-size: 22px; flex-shrink: 0; }
.tl-leg-body { display: flex; flex-direction: column; gap: 2px; }
.tl-leg-mode { font-size: 14px; font-weight: 600; color: var(--text-h); }
.tl-leg-dist { font-size: 13px; color: var(--text-muted); }
.tl-leg-note { margin-top: 3px; font-size: 11px; line-height: 1.45; color: #8a674f; }

/* Route card: one restrained travel-journal system, without mixed emoji colors. */
.hero{gap:22px;padding:30px;background:#fffdf7;border-color:rgba(103,83,69,.2);border-radius:5px 18px 7px 15px;box-shadow:0 12px 28px rgba(72,54,42,.08)}
.hero-top{gap:24px;align-items:flex-start}.hero-text{max-width:760px}.hero-badge{padding:0;margin:0 0 9px;border:0;border-radius:0;background:transparent;color:#6d7045;font-size:10px;font-weight:800;letter-spacing:.17em}.hero-summary{font:750 clamp(27px,3.3vw,39px)/1.16 var(--font-display);color:#332a24}.hero-compact{max-width:720px;margin-top:10px;color:#6e5d52;font:15px/1.75 var(--font-display)}
.hero-actions{margin-left:auto}.hero-actions button{display:inline-flex;align-items:center;gap:7px;padding:9px 14px;border-radius:var(--radius-control);font-size:13px;box-shadow:none}.hero-actions svg{width:17px;height:17px}.favorite-btn{border-color:var(--border);background:transparent;color:var(--primary)}.favorite-btn.saved{background:var(--primary-fixed);color:var(--primary);border-color:var(--accent-border)}.start-walk-btn{border-color:var(--primary);background:var(--primary)}.start-walk-btn:hover{background:var(--primary-hover)}
.hero-stats{grid-template-columns:repeat(4,minmax(0,1fr));padding:0;border:1px solid rgba(103,83,69,.16);border-radius:10px;background:#f4f0e5;overflow:hidden}.hstat{min-width:0;align-items:flex-start;gap:2px;padding:17px 18px}.hstat+.hstat{border-left:1px solid rgba(103,83,69,.14)}.hstat-lbl{order:-1;color:#88776c;font-size:10px;font-weight:800;letter-spacing:.1em;text-align:left}.hstat-val{color:#332a24;font:720 19px/1.35 var(--font-display);text-align:left}.hstat small{overflow:hidden;max-width:100%;color:#85746a;font-size:10.5px;line-height:1.45}.wt-low{color:#536b3e}.wt-mid{color:#8a5d35}.wt-high{color:#8a3f36}
.route-sequence{display:flex;align-items:center;min-width:0;padding:5px 2px;overflow-x:auto}.route-sequence>span{flex:0 0 auto;display:grid;max-width:185px}.route-sequence small,.route-sequence b{color:#7a8457;font-size:8px;font-weight:900;letter-spacing:.12em}.route-sequence strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#55463d;font:650 11px var(--font-display)}.route-sequence>i{width:clamp(28px,5vw,75px);height:1px;flex:1 0 28px;position:relative;margin:0 10px;border-top:1px dashed #9e8c7d}.route-sequence>i::after{content:'';position:absolute;right:-2px;top:-3px;width:5px;height:5px;border-radius:50%;background:#758052}.sequence-stop b{font-style:normal}
.route-briefing{display:grid;grid-template-columns:1.1fr .9fr;gap:0;border-top:1px dashed rgba(103,83,69,.25);border-bottom:1px dashed rgba(103,83,69,.25)}.important-notes,.weather-detail{display:block;padding:18px 20px;border:0;background:transparent;border-radius:0}.weather-detail{border-left:1px solid rgba(103,83,69,.14)}.important-notes strong,.weather-detail strong{display:block;margin:0 0 8px;color:#43372f;font-size:12px;letter-spacing:.08em}.important-notes ul,.weather-detail ul{display:grid;gap:5px;padding-left:17px;color:#6f5f54;font-size:12px;line-height:1.55}.weather-detail p{color:#6f5f54;font-size:12px;line-height:1.6}.weather-detail ul{margin-top:5px}.route-sources{margin-top:0;background:#f7f3e9;border-color:rgba(103,83,69,.14)}
.tradeoff-section{display:grid;gap:10px;padding:18px;border:1px solid var(--border);border-radius:var(--radius-control);background:var(--surface-2)}.tradeoff-heading strong{display:block;color:var(--text-h);font-size:14px}.tradeoff-heading small{display:block;margin-top:3px;color:var(--text-muted);font-size:12px}.tradeoff-card{display:grid;gap:8px;padding:13px 14px;border:1px solid var(--border);border-left:3px solid var(--primary);border-radius:var(--radius-sm);background:var(--surface)}.tradeoff-card.severity-critical{border-left-color:#a3443b}.tradeoff-card.severity-warning{border-left-color:#a36c32}.tradeoff-title{display:flex;align-items:flex-start;gap:9px}.tradeoff-title>span{flex:none;padding:2px 7px;border-radius:999px;background:var(--accent-dim);color:var(--primary);font-size:10px;font-weight:800}.severity-critical .tradeoff-title>span{background:#f9e6e3;color:#8a332b}.severity-warning .tradeoff-title>span{background:#f8ecd9;color:#835323}.tradeoff-title>strong{color:var(--text-h);font-size:13px;line-height:1.55}.tradeoff-card p{color:var(--text);font-size:12px;line-height:1.6}.tradeoff-card p b,.tradeoff-options>b{margin-right:7px;color:var(--primary);font-size:11px}.tradeoff-options{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.tradeoff-options>span{padding:4px 8px;border:1px solid var(--accent-border);border-radius:var(--radius-control);background:var(--accent-dim);color:var(--text);font-size:11px}
.tl-head{gap:13px;padding:3px 0 7px}.section-index{width:35px;height:35px;display:grid;place-items:center;border:1px solid #786354;border-radius:50%;color:#786354;font:800 10px var(--font-sans)}.tl-head>div{display:grid}.tl-head-title{color:#3d322b;font:720 19px var(--font-display)}.tl-head small{color:#8a786d;font-size:10px}.tl-head-dot{display:none}
.timeline{gap:0}.tl-item{gap:17px}.tl-rail{width:35px;padding-top:20px}.tl-node,.n-bookstore,.n-cafe,.n-museum,.n-sight,.n-mall,.n-park,.n-restaurant{width:31px;height:31px;background:#f4f0e5;color:#6a5648;border:1px solid #8a7465;box-shadow:0 0 0 4px #fffdf7;font-size:11px}.tl-line{width:1px;border-left:1px dashed #a99789;background:none;margin:7px 0}
.tl-card{padding:19px 4px 25px;margin:0 0 5px;border:0;border-top:1px solid rgba(103,83,69,.12);border-radius:0;background:transparent;box-shadow:none}.tl-card:hover{border-color:rgba(103,83,69,.25);box-shadow:none}.tl-leg{gap:12px;margin:0 0 17px;padding:9px 11px;border:0;border-radius:7px;background:#f2eee3}.tl-leg-icon{min-width:53px;padding:4px 7px;border:1px solid rgba(83,96,47,.25);border-radius:999px;color:#53602f;font-size:10px;font-weight:800;text-align:center}.tl-leg-mode{font-size:12px;color:#594a40}.tl-leg-dist{font-size:10px;color:#8a786d}.tl-top{gap:10px;margin-bottom:11px}.tl-name{color:#382e28;font-size:21px}.tl-tag{padding:3px 9px;border-color:rgba(103,83,69,.18);border-radius:5px;background:#f4f0e5;color:#746258;font-size:10px;font-weight:700}.tl-cost{margin-left:auto;padding:0;border:0;border-radius:0;background:transparent;color:#5b6440;font-size:18px}.tl-cost small{color:#938177;font-size:9px;font-weight:600}.tl-hl{padding:0 0 0 12px;margin-bottom:9px;border-left:2px solid #838b58;border-radius:0;background:transparent;color:#53602f;font-size:13px}.tl-reason{color:#65554b;font-size:13px}.tl-suitability{gap:5px}.important-notes span,.weather-detail span,.tl-suitability span{padding:3px 8px;border:1px solid rgba(103,83,69,.16);border-radius:5px;background:#f5f1e7;color:#746258;font-size:10px}.tl-addr{font-size:11px}.tl-meta{gap:0;margin-bottom:12px}.tl-chip,.tl-chip.star{padding:0 10px;border:0;border-radius:0;background:transparent;color:#76655b;font-size:10.5px}.tl-chip:first-child{padding-left:0}.tl-chip+.tl-chip{border-left:1px solid rgba(103,83,69,.2)}.tl-info-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0}.tl-info{gap:9px;padding:10px 12px;border:1px solid rgba(103,83,69,.14);border-radius:7px;background:#f6f2e8;color:#67564c;font-size:11px}.tl-info.cost,.tl-info.book,.tl-info.warn{border-color:rgba(103,83,69,.14);background:#f6f2e8;color:#67564c}.tl-info strong{color:#53602f;font-size:9px;letter-spacing:.08em}.map-section{gap:15px;padding-top:7px}

@media (max-width: 900px) {
  .hero-stats { grid-template-columns: repeat(2, 1fr); gap: 0; }
  .hstat + .hstat { border-left: none; }
  .hstat:nth-child(even){border-left:1px solid rgba(103,83,69,.14)}
  .hstat:nth-child(n+3){border-top:1px solid rgba(103,83,69,.14)}
  .route-briefing{grid-template-columns:1fr}.weather-detail{border-left:0;border-top:1px solid rgba(103,83,69,.14)}
}
@media (max-width: 680px) {
  .result-view { padding: 18px 14px 100px; gap: 22px; }
  .hero { padding: 22px 18px; }
  .hero-top { flex-wrap: wrap; }
  .hero-footer { align-items: stretch; flex-direction: column; }
  .hero-actions { width: 100%; justify-content: stretch; }
  .hero-actions button { flex: 1; padding: 9px 8px; font-size: 11px; }
  .hero-stats { grid-template-columns: 1fr 1fr; }
  .tl-item { gap: 9px; }
  .tl-card { padding: 20px 16px; }
  .tl-cost { margin-left: 0; }
  .tl-info-grid{grid-template-columns:1fr}
}

/* Taste Skill redesign layer: itinerary reads as one continuous travel sheet. */
.hero{border-radius:var(--radius);border-color:var(--border);background:var(--surface)}
.hero-badge{font-size:12px;letter-spacing:.06em;text-transform:none}
.hero-summary{font-size:clamp(28px,3.2vw,38px);line-height:1.2;text-wrap:balance}
.hero-compact{font-size:15px;text-wrap:pretty}
.hero-stats{border-color:var(--border);border-radius:var(--radius-control);background:var(--surface-2)}
.hstat{gap:3px;padding:18px}.hstat-lbl{font-size:12px;letter-spacing:.03em}.hstat-val{font-size:20px}.hstat small{font-size:12px}
.route-sequence small,.route-sequence b{font-size:10px;letter-spacing:.06em;color:var(--primary)}.route-sequence strong{font-size:12px}
.route-sequence>i{border-color:var(--accent-border)}.route-sequence>i::after{background:var(--primary)}
.important-notes strong,.weather-detail strong{font-size:13px;letter-spacing:0}.important-notes ul,.weather-detail ul,.weather-detail p{font-size:13px}
.weather-detail{background:var(--accent-dim);border-color:transparent}.route-sources{background:var(--surface-2)}
.section-index{width:36px;height:36px;border-radius:var(--radius-sm);border-color:var(--accent-border);color:var(--primary)}
.tl-head-title{font-size:20px}.tl-head small{font-size:12px}
.tl-node,.n-bookstore,.n-cafe,.n-museum,.n-sight,.n-mall,.n-park,.n-restaurant{background:var(--surface-2);color:var(--primary);border-color:var(--accent-border);box-shadow:0 0 0 4px var(--surface)}
.tl-leg{border-radius:var(--radius-sm);background:var(--surface-2)}.tl-leg-icon{min-width:56px;border-color:var(--accent-border);color:var(--primary);font-size:12px}.tl-leg-mode{font-size:13px}.tl-leg-dist{font-size:12px}
.tl-card{padding:20px 4px 27px}.tl-name{font-size:22px}.tl-tag{font-size:12px;background:var(--surface-2)}.tl-cost{color:var(--primary)}
.tl-hl{border-color:var(--primary);color:var(--primary);font-size:14px}.tl-reason{font-size:14px}.tl-suitability span{font-size:12px;background:var(--surface-2)}
.tl-addr{font-size:13px}.tl-chip,.tl-chip.star{font-size:12px;color:var(--text-muted)}
.tl-info{border-radius:var(--radius-sm);background:var(--surface-2)!important;color:var(--text)!important;font-size:12px}.tl-info strong{color:var(--primary);font-size:11px;letter-spacing:0}
.sources-heading span,.source-main small{font-size:12px}.source-badge{font-size:12px}.source-main strong{font-size:14px}
.answer-hero,.answer-section,.comparison-card,.copy-card{border-radius:var(--radius);box-shadow:none}.answer-hero p,.comparison-card>p{font-size:16px}

@media(max-width:680px){
  .tl-card{padding:18px 2px 24px}
  .hero-actions button{font-size:12px}
}
</style>
