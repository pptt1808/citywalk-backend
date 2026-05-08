<script setup lang="ts">
import { inject, computed } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { PoiCategory } from '../api/agent'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!

const categoryIcons: Record<PoiCategory, string> = {
  bookstore: '📚',
  cafe: '☕',
  sight: '🏛',
  museum: '🎨',
  mall: '🛍',
  park: '🌳',
  restaurant: '🍜',
}

const categoryLabels: Record<PoiCategory, string> = {
  bookstore: '书店',
  cafe: '咖啡',
  sight: '景点',
  museum: '博物馆',
  mall: '商场',
  park: '公园',
  restaurant: '餐厅',
}

const weatherRiskLabel = computed(() => {
  const r = agent.result.value?.weatherRisk
  if (r === 'low') return { text: '天气良好', icon: '🌤', cls: 'risk-low' }
  if (r === 'medium') return { text: '天气一般', icon: '⛅', cls: 'risk-mid' }
  if (r === 'high') return { text: '注意天气', icon: '🌧', cls: 'risk-high' }
  return null
})

const budgetPercent = computed(() => {
  const res = agent.result.value
  if (!res || !res.totalEstimatedCost) return 0
  const budget = agent.lastRequest.value?.budget ?? 200
  return Math.min(100, Math.round((res.totalEstimatedCost / budget) * 100))
})

const timePercent = computed(() => {
  const res = agent.result.value
  if (!res || !res.totalEstimatedMinutes) return 0
  const duration = (agent.lastRequest.value?.durationHours ?? 4) * 60
  return Math.min(100, Math.round((res.totalEstimatedMinutes / duration) * 100))
})
</script>

<template>
  <aside class="context-panel">
    <div class="panel-header">
      <span class="panel-title">路线摘要</span>
    </div>

    <!-- Loading skeleton -->
    <div v-if="agent.status.value === 'loading'" class="skeleton-section">
      <div class="skeleton-block" style="height:64px" />
      <div class="skeleton-block" style="height:80px" />
      <div class="skeleton-block" />
      <div class="skeleton-block" />
      <div class="skeleton-block" />
    </div>

    <!-- Empty state for streaming -->
    <div v-else-if="agent.status.value === 'streaming' && !agent.result.value" class="mini-empty">
      <div class="loading-ring" />
      <span>正在生成路线…</span>
    </div>

    <!-- Content when done -->
    <template v-else-if="agent.result.value">
      <!-- Weather -->
      <div class="section" v-if="weatherRiskLabel">
        <div class="section-label">天气评估</div>
        <div class="weather-card" :class="weatherRiskLabel.cls">
          <span class="weather-icon">{{ weatherRiskLabel.icon }}</span>
          <span class="weather-text">{{ weatherRiskLabel.text }}</span>
        </div>
      </div>

      <!-- Budget meter -->
      <div class="section">
        <div class="section-label">预算使用</div>
        <div class="meter-row">
          <span class="meter-label">¥{{ agent.result.value.totalEstimatedCost }}</span>
          <span class="meter-limit" v-if="agent.lastRequest.value?.budget">/ ¥{{ agent.lastRequest.value.budget }}</span>
        </div>
        <div class="meter-bar">
          <div
            class="meter-fill"
            :class="{ 'fill-warn': budgetPercent > 85 }"
            :style="{ width: budgetPercent + '%' }"
          />
        </div>
      </div>

      <!-- Time meter -->
      <div class="section">
        <div class="section-label">预计时长</div>
        <div class="meter-row">
          <span class="meter-label">{{ agent.result.value.totalEstimatedMinutes }} 分钟</span>
          <span class="meter-limit" v-if="agent.lastRequest.value?.durationHours">
            / {{ agent.lastRequest.value.durationHours * 60 }} 分钟
          </span>
        </div>
        <div class="meter-bar">
          <div
            class="meter-fill fill-blue"
            :class="{ 'fill-warn': timePercent > 90 }"
            :style="{ width: timePercent + '%' }"
          />
        </div>
      </div>

      <!-- POI Stops -->
      <div class="section" v-if="agent.result.value.stops.length">
        <div class="section-label">路线地点 ({{ agent.result.value.stops.length }})</div>
        <div class="stops-list">
          <div
            v-for="(stop, idx) in agent.result.value.stops"
            :key="idx"
            class="stop-card"
          >
            <div class="stop-header">
              <div class="stop-index">{{ idx + 1 }}</div>
              <span class="stop-cat-icon">{{ categoryIcons[stop.category] }}</span>
              <div class="stop-info">
                <div class="stop-name">{{ stop.name }}</div>
                <div class="stop-cat-label">{{ categoryLabels[stop.category] }}</div>
              </div>
              <div class="stop-cost">¥{{ stop.estimatedCost }}</div>
            </div>

            <!-- Rating -->
            <div v-if="stop.rating" class="stop-rating">
              <span v-for="i in 5" :key="i" class="star" :class="{ filled: i <= Math.round(stop.rating) }">★</span>
              <span class="rating-num">{{ stop.rating.toFixed(1) }}</span>
            </div>

            <!-- Details row -->
            <div class="stop-details">
              <span class="detail-chip">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="opacity:.7">
                  <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z"/>
                  <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z"/>
                </svg>
                {{ stop.estimatedStayMinutes }}分钟
              </span>
              <span class="detail-chip" v-if="stop.distanceMeters">
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="opacity:.7">
                  <path d="M12.166 8.94c-.524 1.062-1.234 2.12-1.96 3.07A32.688 32.688 0 0 1 8 14.58a32.692 32.692 0 0 1-2.206-2.57c-.726-.95-1.436-2.008-1.96-3.07C3.304 7.867 3 6.862 3 6a5 5 0 0 1 10 0c0 .862-.305 1.867-.834 2.94z"/>
                  <path d="M8 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
                </svg>
                {{ stop.distanceMeters >= 1000 ? (stop.distanceMeters / 1000).toFixed(1) + 'km' : stop.distanceMeters + 'm' }}
              </span>
            </div>

            <div class="stop-reason">{{ stop.reason }}</div>
          </div>
        </div>
      </div>

      <!-- Decision log -->
      <div class="section" v-if="agent.result.value.decisionLog?.length">
        <div class="section-label">决策日志</div>
        <div class="decision-log">
          <div v-for="(log, i) in agent.result.value.decisionLog" :key="i" class="decision-item">
            <span class="decision-bullet">›</span>
            <span>{{ log }}</span>
          </div>
        </div>
      </div>
    </template>

    <!-- Idle state -->
    <div v-else class="mini-empty">
      <span style="font-size: 28px">🗺</span>
      <span>规划结果将在此显示</span>
    </div>
  </aside>
</template>

<style scoped>
.context-panel {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: var(--surface);
}

.panel-header {
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.07em;
}

.section {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
}
.section-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 8px;
}

/* Weather */
.weather-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid;
  font-size: 13px;
  font-weight: 500;
}
.risk-low  { color: var(--risk-low);    background: rgba(52,211,153,.08);  border-color: rgba(52,211,153,.2); }
.risk-mid  { color: var(--risk-medium); background: rgba(251,191,36,.08);  border-color: rgba(251,191,36,.2); }
.risk-high { color: var(--risk-high);   background: rgba(248,113,113,.08); border-color: rgba(248,113,113,.2); }
.weather-icon { font-size: 18px; }

/* Meters */
.meter-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 6px;
}
.meter-label { font-size: 18px; font-weight: 600; color: var(--text-h); }
.meter-limit { font-size: 12px; color: var(--text-muted); }
.meter-bar {
  height: 5px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
}
.meter-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.5s ease;
}
.fill-blue { background: var(--c-plan); }
.fill-warn { background: var(--c-error); }

/* POI Stops */
.stops-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.stop-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px;
  animation: fadeSlideIn 0.25s ease both;
}
.stop-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.stop-index {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent-dim);
  border: 1px solid var(--accent-border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  flex-shrink: 0;
  margin-top: 1px;
}
.stop-cat-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.stop-info { flex: 1; min-width: 0; }
.stop-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stop-cat-label { font-size: 11px; color: var(--text-muted); }
.stop-cost {
  font-size: 13px;
  font-weight: 600;
  color: var(--c-obs);
  white-space: nowrap;
}

.stop-rating {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 5px 0 0 28px;
}
.star { font-size: 11px; color: var(--text-muted); }
.star.filled { color: var(--c-action); }
.rating-num { font-size: 11px; color: var(--text-muted); margin-left: 3px; font-family: var(--font-mono); }

.stop-details {
  display: flex;
  gap: 6px;
  margin: 5px 0 0 28px;
  flex-wrap: wrap;
}
.detail-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 11px;
  color: var(--text-muted);
}
.stop-reason {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
  margin-top: 6px;
  margin-left: 28px;
}

/* Decision log */
.decision-log {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.decision-item {
  display: flex;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}
.decision-bullet { color: var(--accent); flex-shrink: 0; }

/* Skeleton */
.skeleton-section {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skeleton-block {
  height: 40px;
  background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%);
  background-size: 200% 100%;
  border-radius: var(--radius-sm);
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Mini empty */
.mini-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
}
.loading-ring {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
</style>
