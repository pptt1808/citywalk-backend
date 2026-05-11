<script setup lang="ts">
import { inject, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import PlanSidebar from './PlanSidebar.vue'
import EventFeed from './EventFeed.vue'
import ResultView from './ResultView.vue'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const showDebugJson = inject<Ref<boolean>>('showDebugJson', ref(false))

type Tab = 'result' | 'events' | 'debug'
const activeTab = ref<Tab>('events')

// Sync header JSON button → debug tab
watch(showDebugJson, v => {
  if (v && agent.rawJson.value) activeTab.value = 'debug'
  else if (!v && activeTab.value === 'debug') activeTab.value = 'result'
})

// When streaming ends (status → done), smoothly switch to result tab
watch(() => agent.status.value, (newVal, oldVal) => {
  if (oldVal === 'streaming' && newVal === 'done') {
    // Small extra delay so the tab switch itself feels deliberate
    setTimeout(() => { activeTab.value = 'result' }, 350)
  }
  // On new run, reset to events tab so user sees the live stream
  if (newVal === 'streaming') activeTab.value = 'events'
})
</script>

<template>
  <main class="agent-console">

    <!-- ── IDLE: full-screen welcome ─────────────────────────────── -->
    <Transition name="page">
      <div v-if="agent.status.value === 'idle'" class="welcome-screen" key="welcome">
        <div class="welcome-icon">
          <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
            <rect width="60" height="60" rx="16" fill="#fff5f0"/>
            <rect x="1" y="1" width="58" height="58" rx="15" stroke="#e5e2dc" stroke-width="1.5"/>
            <circle cx="30" cy="30" r="17" stroke="#d4570a" stroke-width="2" stroke-opacity=".2"/>
            <circle cx="30" cy="30" r="9.5" stroke="#d4570a" stroke-width="1.5"/>
            <circle cx="30" cy="30" r="2.8" fill="#d4570a"/>
            <line x1="30" y1="14" x2="30" y2="19" stroke="#d4570a" stroke-width="2" stroke-linecap="round"/>
            <line x1="30" y1="41" x2="30" y2="46" stroke="#d4570a" stroke-width="2" stroke-linecap="round"/>
            <line x1="14" y1="30" x2="19" y2="30" stroke="#d4570a" stroke-width="2" stroke-linecap="round"/>
            <line x1="41" y1="30" x2="46" y2="30" stroke="#d4570a" stroke-width="2" stroke-linecap="round"/>
            <path d="M30 21L32 30H30H28L30 21Z" fill="#d4570a"/>
            <path d="M30 39L32 30H30H28L30 39Z" fill="#d1cfc9"/>
          </svg>
        </div>
        <h1 class="welcome-title">你好，想去哪里漫游？</h1>
        <p class="welcome-sub">在左侧输入目的地和需求，AI Agent 自动查天气、找 POI、规划最优路线</p>

        <div class="feature-cards">
          <div class="feature-card">
            <div class="fc-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.657 16.657 13.414 20.9a1.998 1.998 0 0 1-2.827 0l-4.244-4.243a8 8 0 1 1 11.314 0z"/>
                <path d="M15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/>
              </svg>
            </div>
            <h4 class="fc-title">地图 &amp; 路线</h4>
            <p class="fc-desc">高德 POI 搜索 + 步行 / 骑行最优路径规划</p>
          </div>
          <div class="feature-card">
            <div class="fc-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 .75-7.414 5.25 5.25 0 0 0-10.233-2.33c-.34-.05-.686-.074-1.019-.074A4.5 4.5 0 0 0 2.25 15z"/>
              </svg>
            </div>
            <h4 class="fc-title">实时天气</h4>
            <p class="fc-desc">和风天气预报、降雨指数，自动规避风险</p>
          </div>
          <div class="feature-card">
            <div class="fc-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09z"/>
                <path d="M18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456z"/>
              </svg>
            </div>
            <h4 class="fc-title">LLM 智能规划</h4>
            <p class="fc-desc">DeepSeek Flash / Pro，自动提取偏好生成路线</p>
          </div>
        </div>

        <p class="welcome-footer">Powered by DeepSeek · 高德地图 · 和风天气</p>
      </div>
    </Transition>

    <!-- ── LOADING: waiting for API response ─────────────────────── -->
    <Transition name="page">
      <div v-if="agent.status.value === 'loading'" class="loading-screen" key="loading">
        <PlanSidebar />
        <div class="loading-body">
          <div class="loading-ring" />
          <p class="loading-title">Agent 正在分析需求…</p>
          <p class="loading-hint">正在调用 DeepSeek 解析约束并生成执行计划</p>
        </div>
      </div>
    </Transition>

    <!-- ── STREAMING + DONE + ERROR: persistent tabs layout ──────── -->
    <Transition name="page">
      <div
        v-if="agent.status.value === 'streaming' || agent.status.value === 'done' || agent.status.value === 'error'"
        class="tabs-layout"
        key="tabs"
      >
        <!-- Steps strip (only during streaming) -->
        <PlanSidebar v-if="agent.status.value === 'streaming'" />

        <!-- Tab bar -->
        <div class="tab-bar">
          <button class="tab-btn" :class="{ active: activeTab === 'events' }" @click="activeTab = 'events'">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            执行过程
            <span class="ev-badge" v-if="agent.visibleEvents.value.length">
              {{ agent.visibleEvents.value.length }}
            </span>
          </button>

          <button
            class="tab-btn"
            :class="{ active: activeTab === 'result' }"
            :disabled="!agent.isDone.value"
            @click="activeTab = 'result'"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 11 12 14 22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
            路线规划
            <span class="tab-new" v-if="agent.isDone.value && activeTab !== 'result'">NEW</span>
          </button>

          <button
            class="tab-btn"
            :class="{ active: activeTab === 'debug' }"
            :disabled="!agent.rawJson.value"
            @click="activeTab = 'debug'; showDebugJson = true"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
            </svg>
            JSON
          </button>

          <!-- Summary pills -->
          <div class="tab-pills" v-if="agent.isDone.value && agent.result.value">
            <span class="pill pill-green">¥{{ agent.result.value.totalEstimatedCost }}</span>
            <span class="pill pill-blue">{{ agent.result.value.totalEstimatedMinutes }}分钟</span>
            <span class="pill pill-gray">{{ agent.result.value.stops.length }} 处</span>
          </div>
        </div>

        <!-- Tab panels (all rendered, toggled by opacity) -->
        <div class="tab-panels">
          <div class="tab-panel" :class="{ active: activeTab === 'events' }">
            <EventFeed :forceExpanded="true" />
          </div>
          <div class="tab-panel" :class="{ active: activeTab === 'result' }">
            <ResultView />
          </div>
          <div class="tab-panel" :class="{ active: activeTab === 'debug' }">
            <div class="debug-wrap">
              <pre class="debug-pre">{{ agent.rawJson.value }}</pre>
            </div>
          </div>
        </div>
      </div>
    </Transition>

  </main>
</template>

<style scoped>
.agent-console {
  display: flex; flex-direction: column;
  overflow: hidden; background: var(--bg);
  position: relative;
}

/* ── Welcome ──────────────────────────────────────── */
.welcome-screen {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 20px; padding: 40px 32px; text-align: center;
}
.welcome-icon { margin-bottom: 4px; }
.welcome-title { font-size: 30px; font-weight: 700; color: var(--text-h); letter-spacing: -.03em; }
.welcome-sub { font-size: 14px; color: var(--text-muted); max-width: 430px; line-height: 1.7; }
.feature-cards {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 14px; width: 100%; max-width: 620px; margin-top: 10px;
}
.feature-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 22px 18px; text-align: left;
  box-shadow: 0 1px 3px rgba(0,0,0,.03);
  transition: transform .2s, box-shadow .2s, border-color .2s;
}
.feature-card:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0,0,0,.06); border-color: var(--accent-border); }
.fc-icon {
  width: 44px; height: 44px; border-radius: 12px;
  background: var(--accent-dim); border: 1px solid var(--accent-border);
  display: flex; align-items: center; justify-content: center; margin-bottom: 12px;
}
.fc-title { font-size: 14px; font-weight: 700; color: var(--text-h); margin-bottom: 6px; }
.fc-desc { font-size: 13px; color: var(--text-muted); line-height: 1.6; }
.welcome-footer { font-size: 12px; color: var(--text-muted); margin-top: 6px; }

/* ── Loading ──────────────────────────────────────── */
.loading-screen {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; overflow: hidden;
}
.loading-body {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 12px;
}
.loading-ring {
  width: 40px; height: 40px;
  border: 3.5px solid var(--border); border-top-color: var(--accent);
  border-radius: 50%; animation: spin .9s linear infinite;
}
.loading-title { font-size: 16px; font-weight: 600; color: var(--text-h); }
.loading-hint { font-size: 13px; color: var(--text-muted); }

/* ── Tabs layout ──────────────────────────────────── */
.tabs-layout {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; overflow: hidden;
}

.tab-bar {
  display: flex; align-items: center; gap: 2px;
  padding: 0 16px; height: 44px; flex-shrink: 0;
  background: var(--surface); border-bottom: 1px solid var(--border);
  overflow-x: auto;
}
.tab-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border: none; background: transparent;
  color: var(--text-muted); font-family: var(--font-sans); font-size: 13.5px;
  cursor: pointer; border-radius: 8px; white-space: nowrap;
  transition: all .2s; position: relative;
}
.tab-btn::after {
  content: ''; position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 0; height: 2.5px; border-radius: 2px; background: var(--accent);
  transition: width .25s ease;
}
.tab-btn:hover:not(:disabled) { color: var(--text-h); }
.tab-btn.active { color: var(--accent); font-weight: 600; }
.tab-btn.active::after { width: 50%; }
.tab-btn:disabled { opacity: .35; cursor: not-allowed; }

.ev-badge {
  min-width: 18px; height: 18px; border-radius: 9px;
  background: var(--surface-2); border: 1px solid var(--border);
  font-size: 11px; color: var(--text-muted);
  display: inline-flex; align-items: center; justify-content: center; padding: 0 4px;
}
.tab-new {
  font-size: 9px; font-weight: 700; letter-spacing: .04em;
  padding: 1px 5px; border-radius: 4px;
  background: var(--accent); color: #fff; line-height: 1.4;
}
.tab-pills { display: flex; gap: 6px; margin-left: auto; padding-left: 12px; }
.pill {
  padding: 3px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 500; border: 1px solid;
}
.pill-green { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
.pill-blue  { background: #eff6ff; color: #1e40af; border-color: #bfdbfe; }
.pill-gray  { background: var(--surface-2); color: var(--text-muted); border-color: var(--border); }

/* Tab panels — crossfade via opacity */
.tab-panels {
  flex: 1; position: relative; overflow: hidden;
}
.tab-panel {
  position: absolute; inset: 0;
  opacity: 0; pointer-events: none;
  transition: opacity .35s ease;
  overflow: hidden; display: flex; flex-direction: column;
}
.tab-panel.active { opacity: 1; pointer-events: auto; }

/* Debug pre */
.debug-wrap { flex: 1; overflow: hidden; padding: 16px; display: flex; flex-direction: column; }
.debug-pre {
  flex: 1; overflow-y: scroll; min-height: 0;
  scrollbar-width: auto; scrollbar-color: #ccc8c2 var(--surface-2);
}
.debug-pre::-webkit-scrollbar { width: 10px; }
.debug-pre::-webkit-scrollbar-track { background: var(--surface-2); border-radius: 5px; }
.debug-pre::-webkit-scrollbar-thumb { background: #bbb7b0; border-radius: 5px; border: 2px solid var(--surface-2); }
.debug-pre::-webkit-scrollbar-thumb:hover { background: #9b9590; }

/* Page transitions */
.page-enter-active { transition: opacity .3s ease, transform .3s ease; }
.page-leave-active { transition: opacity .2s ease, transform .2s ease; }
.page-enter-from { opacity: 0; transform: translateY(10px); }
.page-leave-to  { opacity: 0; transform: translateY(-6px); }
</style>
