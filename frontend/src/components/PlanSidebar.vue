<script setup lang="ts">
import { inject, computed } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { AgentPlanStep } from '../api/agent'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!

const toolIcon: Record<AgentPlanStep['toolHint'], string> = {
  weather: '🌤', poi_search: '📍', route_plan: '🗺', constraint_check: '✅',
}

const doneCount = computed(() => agent.visibleSteps.value.filter(s => s.status === 'completed').length)
const progress = computed(() => {
  const t = agent.visibleSteps.value.length
  return t ? Math.round((doneCount.value / t) * 100) : 0
})
</script>

<template>
  <!-- Horizontal steps strip -->
  <div class="steps-strip">
    <div class="strip-header">
      <span class="strip-title">执行步骤</span>
      <span class="strip-count">{{ doneCount }}/{{ agent.visibleSteps.value.length }}</span>
    </div>

    <!-- Skeleton steps -->
    <div class="steps-row" v-if="agent.status.value === 'loading' && !agent.visibleSteps.value.length">
      <div v-for="i in 4" :key="i" class="step-skel" :style="{ animationDelay: (i*0.1)+'s' }" />
    </div>

    <!-- Real steps -->
    <div class="steps-row" v-else>
      <div
        v-for="(step, idx) in agent.visibleSteps.value"
        :key="step.id"
        class="step-pill"
        :class="[`s-${step.status}`]"
      >
        <!-- Status icon -->
        <span v-if="step.status === 'pending'" class="sp-num">{{ idx+1 }}</span>
        <span v-else-if="step.status === 'running'" class="sp-spin">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="12 20" stroke-linecap="round">
              <animateTransform attributeName="transform" type="rotate" from="0 6 6" to="360 6 6" dur=".7s" repeatCount="indefinite"/>
            </circle>
          </svg>
        </span>
        <span v-else-if="step.status === 'completed'" class="sp-check">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><path d="M10 2.5L4.75 8.5 2 5.5"/></svg>
        </span>
        <span v-else class="sp-fail">✕</span>

        <span class="sp-icon">{{ toolIcon[step.toolHint] }}</span>
        <span class="sp-label">{{ step.description.length > 14 ? step.description.slice(0, 14) + '…' : step.description }}</span>
      </div>
    </div>

    <!-- Progress bar -->
    <div class="progress-bar" v-if="agent.visibleSteps.value.length">
      <div class="progress-fill" :style="{ width: progress + '%' }" />
    </div>
  </div>
</template>

<style scoped>
.steps-strip {
  flex-shrink: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 10px 16px 8px;
  display: flex; flex-direction: column; gap: 8px;
}
.strip-header { display: flex; align-items: center; justify-content: space-between; }
.strip-title { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .07em; }
.strip-count { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

.steps-row { display: flex; gap: 8px; flex-wrap: wrap; }

/* Skeleton */
.step-skel {
  height: 30px; width: 110px; border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%);
  background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite;
}

/* Step pill */
.step-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: var(--bg);
  font-size: 12px; color: var(--text-muted);
  transition: all var(--transition);
}
.s-running { border-color: var(--accent-border); background: #fff5f0; color: var(--accent); }
.s-completed { border-color: #a7f3d0; background: #ecfdf5; color: #065f46; }
.s-failed { border-color: #fecaca; background: #fff5f5; color: #991b1b; }

.sp-num {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--surface-2); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600; color: var(--text-muted); flex-shrink: 0;
}
.sp-spin { display: flex; align-items: center; color: var(--accent); }
.sp-check {
  width: 16px; height: 16px; border-radius: 50%;
  background: #059669; color: #fff;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.sp-fail { color: #991b1b; font-size: 12px; }
.sp-icon { font-size: 13px; }
.sp-label { font-size: 12px; white-space: nowrap; }

/* Progress bar */
.progress-bar { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
.progress-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width .4s ease; }
</style>
