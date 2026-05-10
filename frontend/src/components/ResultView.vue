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

const routeMinutes = computed(() =>
  (result.value?.routeLegs ?? []).reduce((s, l) => s + l.durationMinutes, 0)
)
const stayMinutes = computed(() =>
  (result.value?.stops ?? []).reduce((s, st) => s + st.estimatedStayMinutes, 0)
)

// Parse summary into structured sections
const summaryParts = computed(() => {
  const s = result.value?.summary ?? ''
  // Split on Chinese-style delimiters: "。" "；" "。"
  const sentences = s.split(/[。；;]/).map(p => p.trim()).filter(Boolean)
  const route = sentences[0] ?? s
  const rest = sentences.slice(1).join(' · ')
  return { route, rest }
})

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} 分钟`
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
}

function formatDist(m: number): string {
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m'
}

const statCards = computed(() => [
  { icon: '💰', value: `¥${result.value.totalEstimatedCost}`, label: '预估花费' },
  { icon: '⏱',  value: formatTime(result.value.totalEstimatedMinutes), label: `步行 ${formatTime(routeMinutes.value)}  ·  停留 ${formatTime(stayMinutes.value)}` },
  { icon: weatherInfo.value.icon, value: weatherInfo.value.text, label: '天气评估', cls: weatherInfo.value.cls },
  { icon: '📍', value: `${result.value.stops.length} 处`, label: '推荐地点' },
])
</script>

<template>
  <div class="result-view" v-if="result">

    <!-- ── Hero summary card ── -->
    <div class="hero-card">
      <div class="hero-icon-wrap">
        <div class="hero-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
          </svg>
        </div>
      </div>
      <div class="hero-body">
        <span class="hero-badge">路线规划完成</span>
        <p class="hero-summary">{{ summaryParts.route }}</p>
        <p class="hero-detail" v-if="summaryParts.rest">{{ summaryParts.rest }}</p>
      </div>
    </div>

    <!-- ── Stat cards ── -->
    <div class="stat-grid">
      <div v-for="(s, i) in statCards" :key="i" class="stat-card">
        <span class="stat-card-icon">{{ s.icon }}</span>
        <span class="stat-card-val" :class="s.cls">{{ s.value }}</span>
        <span class="stat-card-label">{{ s.label }}</span>
      </div>
    </div>

    <!-- ── Map view ── -->
    <RouteMap
      :stops="result.stops"
      :routeLegs="result.routeLegs"
      :startLocation="result.startLocation"
    />

    <!-- ── Route timeline ── -->
    <div class="section-header">
      <span class="section-dot" />
      <span class="section-title">路线详情</span>
      <span class="section-count">{{ result.stops.length }} 个地点</span>
    </div>

    <div class="timeline">
      <div
        v-for="(stop, idx) in result.stops"
        :key="idx"
        class="tl-card animate-fade-in"
        :style="{ animationDelay: (idx * 0.06) + 's' }"
      >
        <!-- Timeline connector -->
        <div class="tl-rail">
          <div class="tl-node" :class="`tl-${stop.category}`">{{ idx + 1 }}</div>
          <div class="tl-line" v-if="idx < result.stops.length - 1" />
        </div>

        <!-- Card body -->
        <div class="tl-body">
          <div class="tl-top">
            <div class="tl-name-row">
              <h3 class="tl-name">{{ stop.name }}</h3>
              <span class="tl-cat" :class="`tl-cat-${stop.category}`">{{ CAT_ICON[stop.category] }} {{ CAT_LABEL[stop.category] }}</span>
            </div>
            <div class="tl-cost">¥{{ stop.estimatedCost }}</div>
          </div>

          <!-- Highlight -->
          <div class="tl-highlight" v-if="stop.highlight">{{ stop.highlight }}</div>

          <!-- Address -->
          <div class="tl-addr" v-if="stop.address">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {{ stop.address }}
          </div>

          <!-- Meta chips -->
          <div class="tl-meta">
            <span class="tl-chip" v-if="stop.rating">★ {{ stop.rating.toFixed(1) }}</span>
            <span class="tl-chip">🕐 {{ stop.estimatedStayMinutes }}分钟</span>
            <span class="tl-chip" v-if="stop.distanceMeters">📏 {{ formatDist(stop.distanceMeters) }}</span>
          </div>

          <!-- Info cards -->
          <div class="tl-info-list">
            <div class="tl-info tl-info-cost" v-if="stop.costBreakdown">
              <span class="tl-info-icon">💰</span>
              <span>{{ stop.costBreakdown }}</span>
            </div>
            <div class="tl-info tl-info-book" v-if="stop.bookingInfo" :class="{ 'tl-info-warn': !stop.bookingInfo.includes('免预约') && !stop.bookingInfo.includes('直接') }">
              <span class="tl-info-icon">📅</span>
              <span>{{ stop.bookingInfo }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Corrections ── -->
    <div class="corrections-section" v-if="result.corrections?.length">
      <div class="section-header">
        <span class="section-dot warn" />
        <span class="section-title">自动修正记录</span>
      </div>
      <div class="corrections-card">
        <div v-for="(c, i) in result.corrections" :key="i" class="corr-item">
          <span class="corr-num">{{ i + 1 }}</span>
          <span>{{ c }}</span>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.result-view {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 24px 28px;
  overflow-y: auto;
  flex: 1;
}

/* ── Hero card ── */
.hero-card {
  display: flex;
  gap: 16px;
  padding: 20px 22px;
  background: linear-gradient(135deg, #faf7f2 0%, #fdfcfa 40%, #faf8f6 100%);
  border: 1.5px solid #e8dfd4;
  border-radius: 14px;
  box-shadow: 0 1px 0 rgba(0,0,0,.03);
}
.hero-icon-wrap { flex-shrink: 0; }
.hero-icon {
  width: 52px; height: 52px; border-radius: 14px;
  background: #fff; border: 1px solid #e8dfd4;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.hero-body { flex: 1; min-width: 0; }
.hero-badge {
  display: inline-block;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .1em; color: var(--accent);
  background: #fff5f0; border: 1px solid var(--accent-border);
  padding: 3px 10px; border-radius: 999px; margin-bottom: 8px;
}
.hero-summary {
  font-size: 18px; font-weight: 700; color: #1e1918;
  line-height: 1.6; letter-spacing: -.01em;
}
.hero-detail {
  font-size: 13px; color: #6b615c; margin-top: 4px; line-height: 1.55;
}

/* ── Stat grid ── */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 900px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 12px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  box-shadow: 0 1px 2px rgba(0,0,0,.03);
  transition: border-color .2s, box-shadow .2s;
}
.stat-card:hover {
  border-color: var(--accent-border);
  box-shadow: 0 2px 12px rgba(0,0,0,.06);
}
.stat-card-icon { font-size: 22px; }
.stat-card-val {
  font-size: 16px; font-weight: 700; color: var(--text-h);
}
.stat-card-label {
  font-size: 10.5px; color: var(--text-muted); text-align: center; line-height: 1.4;
}
.wt-low  { color: #059669; }
.wt-mid  { color: #d97706; }
.wt-high { color: #dc2626; }

/* ── Section header ── */
.section-header {
  display: flex; align-items: center; gap: 8px;
}
.section-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--accent); flex-shrink: 0;
}
.section-dot.warn { background: #f59e0b; }
.section-title {
  font-size: 14px; font-weight: 700; color: var(--text-h); letter-spacing: -.01em;
}
.section-count {
  margin-left: auto; font-size: 11px; color: var(--text-muted);
  background: var(--surface-2); padding: 2px 10px; border-radius: 999px;
}

/* ── Timeline ── */
.timeline {
  display: flex; flex-direction: column;
  padding-left: 4px;
}
.tl-card {
  display: flex; gap: 14px;
}
.tl-rail {
  display: flex; flex-direction: column; align-items: center;
  width: 28px; flex-shrink: 0; padding-top: 3px;
}
.tl-node {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; color: #fff;
  flex-shrink: 0; z-index: 1;
  background: var(--accent);
  box-shadow: 0 2px 6px rgba(212,87,10,.25);
}
.tl-bookstore  { background: #6366f1; }
.tl-cafe       { background: #a855f7; }
.tl-museum     { background: #0ea5e9; }
.tl-sight      { background: #f59e0b; }
.tl-mall       { background: #ec4899; }
.tl-park       { background: #10b981; }
.tl-restaurant { background: #ef4444; }
.tl-line {
  width: 2px; flex: 1; min-height: 16px;
  background: linear-gradient(to bottom, var(--accent-border), var(--border));
  margin: 6px 0;
}
.tl-body {
  flex: 1; min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px; padding: 16px 18px;
  margin-bottom: 14px;
  box-shadow: 0 1px 3px rgba(0,0,0,.03);
  transition: border-color .2s, box-shadow .2s;
}
.tl-body:hover { border-color: var(--accent-border); box-shadow: 0 3px 14px rgba(0,0,0,.06); }

.tl-top {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin-bottom: 8px;
}
.tl-name-row {
  flex: 1; min-width: 0;
  display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px;
}
.tl-name { font-size: 16px; font-weight: 700; color: var(--text-h); }
.tl-cat {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 11px; color: var(--text-muted);
  background: var(--surface-2); border: 1px solid var(--border);
  padding: 2px 8px; border-radius: 999px; white-space: nowrap;
}
.tl-cost {
  font-size: 18px; font-weight: 700; color: #065f46;
  background: #ecfdf5; border: 1px solid #a7f3d0;
  padding: 4px 12px; border-radius: 8px; white-space: nowrap;
}

.tl-highlight {
  font-size: 13px; color: var(--accent); line-height: 1.5;
  padding: 6px 10px; background: linear-gradient(135deg, #fff8f5, #fff5f0);
  border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0;
  margin-bottom: 6px;
}
.tl-addr {
  display: flex; align-items: center; gap: 5px;
  font-size: 12px; color: var(--text-muted); margin-bottom: 6px;
}
.tl-addr svg { flex-shrink: 0; opacity: .5; }

.tl-meta {
  display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px;
}
.tl-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 9px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 999px; font-size: 11.5px; color: var(--text-muted);
}

.tl-info-list { display: flex; flex-direction: column; gap: 5px; }
.tl-info {
  display: flex; align-items: flex-start; gap: 6px;
  padding: 7px 10px; border-radius: 8px;
  font-size: 12px; line-height: 1.5;
}
.tl-info-icon { flex-shrink: 0; font-size: 13px; }
.tl-info-cost { background: #fefce8; color: #854d0e; }
.tl-info-book { background: #f0f9ff; color: #075985; }
.tl-info-warn { background: #fef2f2; color: #991b1b; }

/* ── Corrections ── */
.corrections-section {
  display: flex; flex-direction: column; gap: 8px;
}
.corrections-card {
  background: #fff9f5; border: 1px solid #fed7aa;
  border-radius: var(--radius); padding: 8px 0;
  display: flex; flex-direction: column;
}
.corr-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 7px 16px; font-size: 12.5px; color: #7c2d12; line-height: 1.5;
}
.corr-num {
  width: 18px; height: 18px; border-radius: 50%;
  background: #fed7aa; color: #7c2d12;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex-shrink: 0; margin-top: 1px;
}

/* Anim */
.animate-fade-in { animation: fadeSlideIn .3s ease both; }
</style>
