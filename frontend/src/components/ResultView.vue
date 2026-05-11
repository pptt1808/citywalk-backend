<script setup lang="ts">
import { inject, computed } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import { CAT_ICON, CAT_LABEL } from '../constants'
import RouteMap from './RouteMap.vue'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const result = computed(() => agent.result.value!)

const weatherInfo = computed(() => {
  const r = result.value?.weatherRisk
  if (r === 'low')    return { text: '天气良好', icon: '🌤', cls: 'wt-low' }
  if (r === 'medium') return { text: '天气一般', icon: '⛅', cls: 'wt-mid' }
  if (r === 'high')   return { text: '注意天气', icon: '🌧', cls: 'wt-high' }
  return { text: '—', icon: '—', cls: '' }
})

const routeMins = computed(() => (result.value?.routeLegs ?? []).reduce((s, l) => s + l.durationMinutes, 0))
const stayMins  = computed(() => (result.value?.stops ?? []).reduce((s, st) => s + st.estimatedStayMinutes, 0))

function fmtTime(m: number): string {
  const h = Math.floor(m / 60), r = m % 60
  return h === 0 ? `${r} 分钟` : r > 0 ? `${h} 小时 ${r} 分钟` : `${h} 小时`
}
function fmtDist(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m'
}

const summaryLine = computed(() => {
  const s = result.value?.summary ?? ''
  const m = s.match(/^(.+?推荐\s*\d+\s*个点位)/)
  return m ? m[1] : s.split(/[。：:]/)[0] ?? s
})
</script>

<template>
  <div class="result-view" v-if="result">

    <!-- ── Hero ── -->
    <div class="hero">
      <div class="hero-top">
        <div class="hero-icon-box">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
          </svg>
        </div>
        <div class="hero-text">
          <span class="hero-badge">路线规划完成</span>
          <p class="hero-summary">{{ summaryLine }}</p>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hstat">
          <span class="hstat-icon">💰</span>
          <span class="hstat-val">¥{{ result.totalEstimatedCost }}</span>
          <span class="hstat-lbl">预估花费</span>
        </div>
        <div class="hstat">
          <span class="hstat-icon">⏱</span>
          <span class="hstat-val">{{ fmtTime(result.totalEstimatedMinutes) }}</span>
          <span class="hstat-lbl">🚶{{ fmtTime(routeMins) }} · 🛑{{ fmtTime(stayMins) }}</span>
        </div>
        <div class="hstat">
          <span class="hstat-icon">{{ weatherInfo.icon }}</span>
          <span class="hstat-val" :class="weatherInfo.cls">{{ weatherInfo.text }}</span>
          <span class="hstat-lbl">天气评估</span>
        </div>
        <div class="hstat">
          <span class="hstat-icon">📍</span>
          <span class="hstat-val">{{ result.stops.length }} 处</span>
          <span class="hstat-lbl">推荐地点</span>
        </div>
      </div>
    </div>

    <!-- ── Map ── -->
    <RouteMap :stops="result.stops" :routeLegs="result.routeLegs" :startLocation="result.startLocation" />

    <!-- ── Timeline ── -->
    <div class="tl-head">
      <span class="tl-head-dot" />
      <span class="tl-head-title">路线详情</span>
    </div>

    <div class="timeline">
      <div v-for="(stop, idx) in result.stops" :key="idx" class="tl-item">
        <div class="tl-rail">
          <div class="tl-node" :class="`n-${stop.category}`">{{ idx + 1 }}</div>
          <div class="tl-line" v-if="idx < result.stops.length - 1" />
        </div>

        <div class="tl-card">
          <div class="tl-top">
            <h3 class="tl-name">{{ stop.name }}</h3>
            <span class="tl-tag">{{ CAT_ICON[stop.category] }} {{ CAT_LABEL[stop.category] }}</span>
            <span class="tl-cost">¥{{ stop.estimatedCost }}</span>
          </div>

          <p class="tl-hl" v-if="stop.highlight">{{ stop.highlight }}</p>

          <p class="tl-addr" v-if="stop.address">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {{ stop.address }}
          </p>

          <div class="tl-meta">
            <span class="tl-chip star" v-if="stop.rating">★ {{ stop.rating.toFixed(1) }}</span>
            <span class="tl-chip">🕐 停留 {{ fmtTime(stop.estimatedStayMinutes) }}</span>
            <span class="tl-chip" v-if="stop.distanceMeters">📏 {{ fmtDist(stop.distanceMeters) }}</span>
          </div>

          <div v-if="stop.costBreakdown || stop.bookingInfo" class="tl-info-grid">
            <div class="tl-info cost" v-if="stop.costBreakdown">
              <span>💰</span><span>{{ stop.costBreakdown }}</span>
            </div>
            <div class="tl-info book" v-if="stop.bookingInfo" :class="{ warn: !stop.bookingInfo.includes('免预约') && !stop.bookingInfo.includes('直接') }">
              <span>📅</span><span>{{ stop.bookingInfo }}</span>
            </div>
          </div>

          <div class="tl-leg" v-if="result.routeLegs?.[idx]">
            <div class="tl-leg-icon">{{ result.routeLegs[idx].mode === 'transit' ? '🚇' : '🚶' }}</div>
            <div class="tl-leg-body">
              <span class="tl-leg-mode">{{ result.routeLegs[idx].mode === 'transit' ? '公交地铁' : '步行' }} 至下一站</span>
              <span class="tl-leg-dist">{{ fmtDist(result.routeLegs[idx].distanceMeters) }} · {{ result.routeLegs[idx].durationMinutes }} 分钟</span>
            </div>
          </div>
        </div>
      </div>
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
.tl-addr {
  display: flex; align-items: center; gap: 6px;
  font-size: 13px; color: var(--text-muted);
  margin-bottom: 12px;
}
.tl-addr svg { flex-shrink: 0; opacity: .4; }

.tl-meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
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
}
.tl-leg-icon { font-size: 22px; flex-shrink: 0; }
.tl-leg-body { display: flex; flex-direction: column; gap: 2px; }
.tl-leg-mode { font-size: 14px; font-weight: 600; color: var(--text-h); }
.tl-leg-dist { font-size: 13px; color: var(--text-muted); }

@media (max-width: 900px) {
  .hero-stats { grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .hstat + .hstat { border-left: none; }
}
</style>
