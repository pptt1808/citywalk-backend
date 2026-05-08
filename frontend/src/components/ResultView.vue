<script setup lang="ts">
import { inject, computed } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { PoiCategory } from '../api/agent'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const result = computed(() => agent.result.value!)

const catIcon: Record<PoiCategory, string> = {
  bookstore: '📚', cafe: '☕', sight: '🏛', museum: '🎨',
  mall: '🛍', park: '🌳', restaurant: '🍜',
}
const catLabel: Record<PoiCategory, string> = {
  bookstore: '书店', cafe: '咖啡', sight: '景点', museum: '博物馆',
  mall: '商场', park: '公园', restaurant: '餐厅',
}

const weatherInfo = computed(() => {
  const r = result.value?.weatherRisk
  if (r === 'low')    return { text: '天气良好', icon: '🌤', cls: 'wt-low' }
  if (r === 'medium') return { text: '天气一般', icon: '⛅', cls: 'wt-mid' }
  if (r === 'high')   return { text: '注意天气', icon: '🌧', cls: 'wt-high' }
  return { text: '—', icon: '—', cls: '' }
})

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} 分钟`
  return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
}
</script>

<template>
  <div class="result-view" v-if="result">
    <!-- ── Summary banner ── -->
    <div class="summary-banner">
      <div class="banner-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
      </div>
      <div class="banner-body">
        <p class="banner-label">路线规划完成</p>
        <p class="banner-summary">{{ result.summary }}</p>
      </div>
    </div>

    <!-- ── Stats bar ── -->
    <div class="stats-bar">
      <div class="stat-item">
        <span class="stat-icon">💴</span>
        <span class="stat-val">¥{{ result.totalEstimatedCost }}</span>
        <span class="stat-label">预估花费</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-icon">⏱</span>
        <span class="stat-val">{{ formatTime(result.totalEstimatedMinutes) }}</span>
        <span class="stat-label">预计时长</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-icon">{{ weatherInfo.icon }}</span>
        <span class="stat-val" :class="weatherInfo.cls">{{ weatherInfo.text }}</span>
        <span class="stat-label">天气状况</span>
      </div>
      <div class="stat-divider" />
      <div class="stat-item">
        <span class="stat-icon">📍</span>
        <span class="stat-val">{{ result.stops.length }} 个</span>
        <span class="stat-label">推荐地点</span>
      </div>
    </div>

    <!-- ── Route stops ── -->
    <div class="section-title">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
      推荐路线
    </div>

    <div class="stops-grid">
      <div v-for="(stop, idx) in result.stops" :key="idx" class="stop-card animate-fade-in" :style="{ animationDelay: (idx * 0.08) + 's' }">
        <!-- Card header -->
        <div class="stop-card-header">
          <div class="stop-seq">{{ idx + 1 }}</div>
          <div class="stop-cat-badge">
            <span class="cat-emoji">{{ catIcon[stop.category] }}</span>
            <span class="cat-text">{{ catLabel[stop.category] }}</span>
          </div>
          <div class="stop-cost-pill">¥{{ stop.estimatedCost }}</div>
        </div>

        <!-- Name -->
        <h4 class="stop-name">{{ stop.name }}</h4>

        <!-- Address -->
        <p class="stop-address" v-if="stop.address">{{ stop.address }}</p>

        <!-- Rating row -->
        <div class="stop-meta-row">
          <span class="stop-rating" v-if="stop.rating">
            <span v-for="i in 5" :key="i" class="star" :class="{ filled: i <= Math.round(stop.rating!) }">★</span>
            <span class="rating-num">{{ stop.rating.toFixed(1) }}</span>
          </span>
          <span class="meta-chip">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            {{ stop.estimatedStayMinutes }}分钟
          </span>
          <span class="meta-chip" v-if="stop.distanceMeters">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/></svg>
            {{ stop.distanceMeters! >= 1000 ? (stop.distanceMeters! / 1000).toFixed(1) + ' km' : stop.distanceMeters + ' m' }}
          </span>
        </div>

        <!-- Reason -->
        <p class="stop-reason">{{ stop.reason }}</p>
      </div>
    </div>

    <!-- ── Corrections (if any) ── -->
    <div class="corrections-section" v-if="result.corrections?.length">
      <div class="section-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>
        自动修正记录
      </div>
      <ul class="corrections-list">
        <li v-for="(c, i) in result.corrections" :key="i">{{ c }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.result-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
}

/* Summary banner */
.summary-banner {
  display: flex;
  gap: 14px;
  padding: 18px 20px;
  background: linear-gradient(135deg, #fff8f5 0%, #fff 100%);
  border: 1.5px solid var(--accent-border);
  border-radius: var(--radius);
}
.banner-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: var(--accent-dim); border: 1px solid var(--accent-border);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.banner-body { flex: 1; min-width: 0; }
.banner-label {
  font-size: 11px; font-weight: 600; color: var(--accent);
  text-transform: uppercase; letter-spacing: .07em; margin-bottom: 5px;
}
.banner-summary {
  font-size: 15px; color: var(--text-h); line-height: 1.65; font-weight: 400;
}

/* Stats bar */
.stats-bar {
  display: flex;
  align-items: center;
  padding: 14px 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-sm);
}
.stat-item {
  flex: 1;
  display: flex; flex-direction: column;
  align-items: center; gap: 3px;
}
.stat-icon { font-size: 20px; }
.stat-val { font-size: 17px; font-weight: 700; color: var(--text-h); }
.stat-label { font-size: 11px; color: var(--text-muted); }
.stat-divider { width: 1px; height: 40px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
.wt-low  { color: var(--risk-low); }
.wt-mid  { color: var(--risk-medium); }
.wt-high { color: var(--risk-high); }

/* Section title */
.section-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 700; color: var(--text-h);
  letter-spacing: -.01em;
}

/* Stop cards grid */
.stops-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.stop-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px;
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition), border-color var(--transition);
}
.stop-card:hover { box-shadow: var(--shadow); border-color: var(--accent-border); }

.stop-card-header { display: flex; align-items: center; gap: 8px; }
.stop-seq {
  width: 22px; height: 22px; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; flex-shrink: 0;
}
.stop-cat-badge {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 999px; font-size: 12px; color: var(--text-muted);
}
.cat-emoji { font-size: 13px; }
.cat-text { font-size: 11px; font-weight: 500; }
.stop-cost-pill {
  margin-left: auto;
  padding: 2px 9px;
  background: #ecfdf5; border: 1px solid #a7f3d0;
  border-radius: 999px; font-size: 12px; font-weight: 600; color: #065f46;
}

.stop-name { font-size: 15px; font-weight: 700; color: var(--text-h); }
.stop-address { font-size: 12px; color: var(--text-muted); }

.stop-meta-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.stop-rating { display: flex; align-items: center; gap: 2px; }
.star { font-size: 12px; color: #d1cfc9; }
.star.filled { color: #f59e0b; }
.rating-num { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); margin-left: 2px; }
.meta-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 999px; font-size: 11px; color: var(--text-muted);
}
.stop-reason { font-size: 12px; color: var(--text-muted); line-height: 1.5; }

/* Corrections */
.corrections-section { display: flex; flex-direction: column; gap: 8px; }
.corrections-list {
  list-style: none;
  display: flex; flex-direction: column; gap: 5px;
  padding: 12px 16px;
  background: #fff9f5; border: 1px solid #fed7aa;
  border-radius: var(--radius-sm);
}
.corrections-list li {
  font-size: 12.5px; color: #7c2d12;
  padding-left: 14px; position: relative; line-height: 1.55;
}
.corrections-list li::before { content: '›'; position: absolute; left: 0; color: var(--accent); font-weight: 700; }

/* Anim */
.animate-fade-in { animation: fadeSlideIn .28s ease both; }
</style>
