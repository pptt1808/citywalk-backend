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
  try { entries.value = (await apiListHistory(20, 0)).entries } catch {} finally { loading.value = false }
}
async function removeEntry(id: string) {
  try { await apiDeleteHistory(id); entries.value = entries.value.filter(e => e.id !== id) } catch {}
}
function reuseEntry(entry: HistoryEntry) { agent.reset(); setTimeout(() => agent.run(entry.request), 100) }
function viewEntry(entry: HistoryEntry) {
  agent.result.value = entry.result
  agent.visibleEvents.value = entry.result.events ?? []
  agent.visibleSteps.value = entry.result.planSteps ?? []
  agent.rawJson.value = JSON.stringify(entry.result, null, 2)
  agent.status.value = 'streaming'
  setTimeout(() => { agent.status.value = 'done' }, 150)
}
function formatDate(iso: string): string {
  const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
onMounted(loadHistory)
</script>

<template>
  <aside class="hp">
    <div class="hp-head">
      <span class="hp-head-title">历史记录</span>
      <button class="hp-head-btn" @click="loadHistory" :disabled="loading">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" :class="{ spinning: loading }"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
    </div>

    <div class="hp-body">
      <div v-if="loading && entries.length === 0" class="hp-skel"><div v-for="i in 3" :key="i" class="hp-skel-row" /></div>

      <div v-else-if="entries.length === 0" class="hp-empty">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="opacity:.25"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <span>暂无历史记录</span>
        <span class="hp-empty-sub">执行规划后自动保存</span>
      </div>

      <div v-else class="hp-list">
        <div v-for="entry in entries" :key="entry.id" class="hp-entry" :class="{ expanded: expandedId === entry.id }">
          <div class="hp-row" @click="expandedId = expandedId === entry.id ? null : entry.id">
            <div class="hp-main">
              <span class="hp-date">{{ formatDate(entry.createdAt) }}</span>
              <span class="hp-task">{{ entry.request.task || entry.result?.summary?.slice(0, 50) || '(无描述)' }}</span>
            </div>
            <div class="hp-meta">
              <span class="hp-cost">¥{{ entry.result.totalEstimatedCost }}</span>
              <span class="hp-stops">{{ entry.result.stops.length }} 点</span>
            </div>
          </div>

          <div v-if="expandedId === entry.id" class="hp-detail">
            <p class="hp-detail-text">{{ entry.result.summary }}</p>
            <div class="hp-stops-list">
              <div v-for="(s, i) in entry.result.stops" :key="i" class="hp-stop">
                <span class="hp-stop-num">{{ i + 1 }}</span>
                <span>{{ CAT_ICON[s.category] }}</span>
                <span class="hp-stop-name">{{ s.name }}</span>
                <span class="hp-stop-cost">¥{{ s.estimatedCost }}</span>
                <span class="hp-stop-time">{{ s.estimatedStayMinutes }}min</span>
              </div>
            </div>
            <div class="hp-actions">
              <button class="hp-btn hp-btn-view" @click="viewEntry(entry)">查看</button>
              <button class="hp-btn hp-btn-reuse" @click="reuseEntry(entry)">重试</button>
              <button class="hp-btn hp-btn-del" @click="removeEntry(entry.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.hp { display: flex; flex-direction: column; width: 300px; flex-shrink: 0; background: var(--surface); border-left: 1px solid var(--border); overflow: hidden; }
.hp-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.hp-head-title { font-size: 13px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .07em; }
.hp-head-btn { background: none; border: none; cursor: pointer; padding: 5px; border-radius: 6px; color: var(--text-muted); transition: all .15s; }
.hp-head-btn:hover:not(:disabled) { color: var(--text-h); background: var(--surface-hover); }
.hp-head-btn:disabled { opacity: .4; }
.spinning { animation: spin 1s linear infinite; }

.hp-body { flex: 1; overflow-y: auto; }
.hp-skel { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.hp-skel-row { height: 52px; border-radius: 8px; background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%); background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; }

.hp-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 40px 16px; text-align: center; font-size: 14px; color: var(--text-muted); }
.hp-empty-sub { font-size: 12px; opacity: .5; }

.hp-list { display: flex; flex-direction: column; }
.hp-entry { border-bottom: 1px solid var(--border-subtle); }
.hp-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; cursor: pointer; gap: 10px; transition: background .12s; }
.hp-row:hover { background: var(--surface-hover); }
.hp-entry.expanded .hp-row { background: var(--accent-dim); }
.hp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.hp-date { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.hp-task { font-size: 13px; color: var(--text-h); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hp-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; flex-shrink: 0; }
.hp-cost { font-size: 13px; font-weight: 600; color: var(--c-obs); }
.hp-stops { font-size: 11px; color: var(--text-muted); }

.hp-detail { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 10px; }
.hp-detail-text { font-size: 13px; color: var(--text); line-height: 1.6; padding: 8px 12px; background: var(--bg); border-radius: 8px; }
.hp-stops-list { display: flex; flex-direction: column; gap: 4px; }
.hp-stop { display: flex; align-items: center; gap: 7px; padding: 5px 10px; background: var(--bg); border-radius: 7px; font-size: 12.5px; }
.hp-stop-num { width: 18px; height: 18px; border-radius: 50%; background: var(--accent-dim); border: 1px solid var(--accent-border); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--accent); flex-shrink: 0; }
.hp-stop-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-h); }
.hp-stop-cost { font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
.hp-stop-time { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }

.hp-actions { display: flex; gap: 6px; }
.hp-btn { flex: 1; padding: 7px 0; border-radius: 7px; border: 1px solid; font-size: 12.5px; font-family: var(--font-sans); cursor: pointer; transition: opacity .15s; }
.hp-btn-view { background: var(--c-plan); border-color: var(--c-plan); color: #fff; }
.hp-btn-reuse { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }
.hp-btn-del { background: var(--bg); border-color: var(--border); color: var(--text-muted); }
.hp-btn:hover { opacity: .8; }

@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
