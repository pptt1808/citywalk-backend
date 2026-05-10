<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import { apiListHistory, apiDeleteHistory, type HistoryEntry } from '../api/agent'
import { CAT_ICON } from '../constants'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!

const entries = ref<HistoryEntry[]>([])
const loading = ref(false)
const expandedId = ref<string | null>(null)

async function loadHistory() {
  loading.value = true
  try {
    const data = await apiListHistory(20, 0)
    entries.value = data.entries
  } catch {
    // silent
  } finally {
    loading.value = false
  }
}

async function removeEntry(id: string) {
  try {
    await apiDeleteHistory(id)
    entries.value = entries.value.filter(e => e.id !== id)
  } catch {
    // silent
  }
}

function reuseEntry(entry: HistoryEntry) {
  agent.reset()
  setTimeout(() => agent.run(entry.request), 100)
}

function viewEntry(entry: HistoryEntry) {
  agent.result.value = entry.result
  agent.visibleEvents.value = entry.result.events ?? []
  agent.visibleSteps.value = entry.result.planSteps ?? []
  agent.rawJson.value = JSON.stringify(entry.result, null, 2)
  // Brief streaming→done transition so AgentConsole auto-switches to result tab
  agent.status.value = 'streaming'
  setTimeout(() => { agent.status.value = 'done' }, 150)
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

onMounted(loadHistory)
</script>

<template>
  <aside class="history-panel">
    <div class="hp-header">
      <span class="hp-title">历史记录</span>
      <button class="hp-refresh" @click="loadHistory" :disabled="loading">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          :class="{ spinning: loading }">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    </div>

    <div class="hp-body">
      <div v-if="loading && entries.length === 0" class="hp-skel">
        <div v-for="i in 3" :key="i" class="hp-skel-row" />
      </div>

      <div v-else-if="entries.length === 0" class="hp-empty">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>暂无历史记录</span>
        <span class="hp-empty-hint">执行规划后自动保存</span>
      </div>

      <div v-else class="hp-list">
        <div
          v-for="entry in entries"
          :key="entry.id"
          class="hp-entry"
          :class="{ expanded: expandedId === entry.id }"
        >
          <!-- Summary row -->
          <div class="hp-entry-row" @click="expandedId = expandedId === entry.id ? null : entry.id">
            <div class="hp-entry-main">
              <span class="hp-date">{{ formatDate(entry.createdAt) }}</span>
              <span class="hp-task">{{ entry.request.task || entry.result?.summary?.slice(0, 40) || '(无描述)' }}</span>
            </div>
            <div class="hp-entry-meta">
              <span class="hp-cost">¥{{ entry.result.totalEstimatedCost }}</span>
              <span class="hp-stops">{{ entry.result.stops.length }}点</span>
            </div>
          </div>

          <!-- Expanded detail -->
          <div v-if="expandedId === entry.id" class="hp-detail">
            <p class="hp-detail-summary">{{ entry.result.summary }}</p>
            <div class="hp-detail-stops">
              <div v-for="(stop, i) in entry.result.stops" :key="i" class="hp-stop">
                <span class="hp-stop-num">{{ i + 1 }}</span>
                <span>{{ CAT_ICON[stop.category] }}</span>
                <span class="hp-stop-name">{{ stop.name }}</span>
                <span class="hp-stop-cost">¥{{ stop.estimatedCost }}</span>
                <span class="hp-stop-time">{{ stop.estimatedStayMinutes }}min</span>
              </div>
            </div>
            <div class="hp-detail-actions">
              <button class="hp-btn-view" @click="viewEntry(entry)">查看完整结果</button>
              <button class="hp-btn-reuse" @click="reuseEntry(entry)">重新规划</button>
              <button class="hp-btn-delete" @click="removeEntry(entry.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.history-panel {
  display: flex; flex-direction: column;
  width: 280px; flex-shrink: 0;
  background: var(--surface); border-left: 1px solid var(--border);
  overflow: hidden;
}
.hp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--border); flex-shrink: 0;
}
.hp-title {
  font-size: 12px; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: .07em;
}
.hp-refresh {
  background: none; border: none; cursor: pointer; padding: 4px;
  border-radius: 6px; color: var(--text-muted);
  transition: color .2s, background .2s;
}
.hp-refresh:hover:not(:disabled) { color: var(--text-h); background: var(--surface-hover); }
.hp-refresh:disabled { opacity: .5; cursor: not-allowed; }
.spinning { animation: spin 1s linear infinite; }

.hp-body { flex: 1; overflow-y: auto; }

.hp-skel { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.hp-skel-row {
  height: 48px; border-radius: var(--radius-sm);
  background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%);
  background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite;
}

.hp-empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
  padding: 32px 16px; text-align: center;
  font-size: 13px; color: var(--text-muted);
}
.hp-empty-hint { font-size: 11px; opacity: .6; }

.hp-list { display: flex; flex-direction: column; }
.hp-entry { border-bottom: 1px solid var(--border-subtle); }
.hp-entry-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; cursor: pointer; gap: 8px;
  transition: background .15s;
}
.hp-entry-row:hover { background: var(--surface-hover); }
.hp-entry.expanded .hp-entry-row { background: var(--accent-dim); }

.hp-entry-main {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 2px;
}
.hp-date { font-size: 10px; color: var(--text-muted); font-family: var(--font-mono); }
.hp-task {
  font-size: 12.5px; color: var(--text-h);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hp-entry-meta {
  display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0;
}
.hp-cost { font-size: 12px; font-weight: 600; color: var(--c-obs); }
.hp-stops { font-size: 10px; color: var(--text-muted); }

.hp-detail {
  padding: 0 14px 12px;
  display: flex; flex-direction: column; gap: 8px;
}
.hp-detail-summary {
  font-size: 12px; color: var(--text); line-height: 1.55;
  padding: 6px 8px; background: var(--bg); border-radius: 6px;
}
.hp-detail-stops { display: flex; flex-direction: column; gap: 3px; }
.hp-stop {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px; background: var(--bg);
  border-radius: 6px; font-size: 12px;
}
.hp-stop-num {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent-dim); border: 1px solid var(--accent-border);
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600; color: var(--accent); flex-shrink: 0;
}
.hp-stop-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-h); }
.hp-stop-cost { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
.hp-stop-time { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }

.hp-detail-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.hp-btn-view, .hp-btn-reuse, .hp-btn-delete {
  flex: 1; padding: 6px 0; border-radius: 6px; border: 1px solid;
  font-size: 12px; font-family: var(--font-sans); cursor: pointer;
  transition: opacity .15s; min-width: 70px;
}
.hp-btn-view {
  background: var(--c-plan); border-color: var(--c-plan); color: #fff;
}
.hp-btn-reuse {
  background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent);
}
.hp-btn-delete {
  background: var(--bg); border-color: var(--border); color: var(--text-muted);
}
.hp-btn-view:hover, .hp-btn-reuse:hover, .hp-btn-delete:hover { opacity: .8; }

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
