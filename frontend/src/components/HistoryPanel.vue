<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import { apiListHistory, apiDeleteHistory, type HistoryEntry } from '../api/agent'
import { CAT_ICON } from '../constants'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!

function catColor(cat: string): string {
  const map: Record<string, string> = {
    bookstore: '#6366f1', cafe: '#a855f7', museum: '#0ea5e9',
    sight: '#f59e0b', mall: '#ec4899', park: '#10b981', restaurant: '#ef4444'
  }
  return map[cat] ?? '#d4570a'
}
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function routePreview(entry: HistoryEntry): string {
  return entry.result.stops.map(s => s.name).join(' → ')
}

onMounted(loadHistory)
</script>

<template>
  <aside class="hp">
    <!-- Header -->
    <div class="hp-head">
      <div class="hp-head-left">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span class="hp-head-title">历史记录</span>
      </div>
      <button class="hp-head-btn" @click="loadHistory" :disabled="loading" title="刷新">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" :class="{ spin: loading }"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>
    </div>

    <!-- Body -->
    <div class="hp-body">
      <!-- Loading -->
      <div v-if="loading && entries.length === 0" class="hp-skel">
        <div v-for="i in 3" :key="i" class="hp-skel-card">
          <div class="skel-line w60" /><div class="skel-line w90" /><div class="skel-line w40" />
        </div>
      </div>

      <!-- Empty -->
      <div v-else-if="entries.length === 0" class="hp-empty">
        <div class="hp-empty-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        </div>
        <span class="hp-empty-title">暂无记录</span>
        <span class="hp-empty-sub">完成一次路线规划后<br/>自动保存到此处</span>
      </div>

      <!-- List -->
      <div v-else class="hp-list">
        <div v-for="entry in entries" :key="entry.id" class="hp-entry" :class="{ open: expandedId === entry.id }">
          <!-- Row -->
          <div class="hp-row" @click="expandedId = expandedId === entry.id ? null : entry.id">
            <div class="hp-row-top">
              <span class="hp-time">{{ relativeTime(entry.createdAt) }}</span>
              <span class="hp-time-full">{{ new Date(entry.createdAt).toLocaleDateString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) }}</span>
            </div>
            <p class="hp-task">{{ entry.request.task || routePreview(entry) }}</p>
            <div class="hp-row-bottom">
              <div class="hp-route-dots">
                <span v-for="(s, i) in entry.result.stops.slice(0, 5)" :key="i" class="hp-dot" :style="{ background: catColor(s.category) }" :title="s.name" />
              </div>
              <span class="hp-meta-text">{{ entry.result.stops.length }} 个地点 · ¥{{ entry.result.totalEstimatedCost }}</span>
            </div>
          </div>

          <!-- Expanded -->
          <Transition name="expand">
            <div v-if="expandedId === entry.id" class="hp-detail">
              <div class="hp-route">
                <div v-for="(s, i) in entry.result.stops" :key="i" class="hp-route-stop">
                  <span class="hp-rs-num" :style="{ background: catColor(s.category) }">{{ i + 1 }}</span>
                  <span class="hp-rs-icon">{{ CAT_ICON[s.category] }}</span>
                  <span class="hp-rs-name">{{ s.name }}</span>
                  <span class="hp-rs-stay">{{ s.estimatedStayMinutes }}min</span>
                  <span class="hp-rs-cost">¥{{ s.estimatedCost }}</span>
                </div>
              </div>
              <div class="hp-actions">
                <button class="hp-act hp-act-view" @click="viewEntry(entry)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  查看
                </button>
                <button class="hp-act hp-act-retry" @click="reuseEntry(entry)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>
                  重试
                </button>
                <button class="hp-act hp-act-del" @click="removeEntry(entry.id)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  删除
                </button>
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.hp { display: flex; flex-direction: column; width: 340px; flex-shrink: 0; background: var(--surface); border-left: 1px solid var(--border); overflow: hidden; }

/* Header */
.hp-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.hp-head-left { display: flex; align-items: center; gap: 8px; color: var(--text-muted); }
.hp-head-title { font-size: 14px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; }
.hp-head-btn { background: none; border: none; cursor: pointer; padding: 6px; border-radius: 6px; color: var(--text-muted); transition: all .15s; display: flex; }
.hp-head-btn:hover:not(:disabled) { color: var(--text-h); background: var(--surface-hover); }
.hp-head-btn:disabled { opacity: .3; }
.spin { animation: spin 1s linear infinite; }

/* Body */
.hp-body { flex: 1; overflow-y: auto; padding: 8px 0; }

/* Skeleton */
.hp-skel { display: flex; flex-direction: column; gap: 6px; padding: 8px 14px; }
.hp-skel-card { padding: 14px 16px; background: var(--bg); border-radius: 10px; display: flex; flex-direction: column; gap: 8px; }
.skel-line { height: 12px; border-radius: 4px; background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%); background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; }
.w60 { width: 60%; } .w90 { width: 90%; } .w40 { width: 40%; }

/* Empty */
.hp-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 48px 24px; text-align: center; }
.hp-empty-icon { width: 64px; height: 64px; border-radius: 20px; background: var(--bg); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; color: var(--text-muted); opacity: .5; }
.hp-empty-title { font-size: 15px; font-weight: 600; color: var(--text-muted); }
.hp-empty-sub { font-size: 13px; color: var(--text-muted); opacity: .6; line-height: 1.7; }

/* List */
.hp-list { display: flex; flex-direction: column; gap: 2px; padding: 0 10px; }
.hp-entry { border-radius: 12px; overflow: hidden; transition: background .15s; margin-bottom: 2px; }
.hp-entry.open { background: var(--accent-dim); }

/* Row */
.hp-row { padding: 14px 16px; cursor: pointer; transition: background .12s; }
.hp-row:hover { background: var(--surface-hover); }
.hp-entry.open .hp-row { background: transparent; }
.hp-row-top { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.hp-time { font-size: 13px; font-weight: 600; color: var(--text-h); }
.hp-time-full { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.hp-task { font-size: 13px; color: var(--text); line-height: 1.5; margin-bottom: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.hp-row-bottom { display: flex; align-items: center; justify-content: space-between; }
.hp-route-dots { display: flex; gap: 3px; }
.hp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.hp-meta-text { font-size: 11.5px; color: var(--text-muted); }

/* Detail */
.hp-detail { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.hp-route { display: flex; flex-direction: column; gap: 3px; }
.hp-route-stop { display: flex; align-items: center; gap: 8px; padding: 7px 10px; background: var(--bg); border-radius: 8px; font-size: 13px; }
.hp-rs-num { width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; flex-shrink: 0; }
.hp-rs-icon { font-size: 15px; flex-shrink: 0; }
.hp-rs-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-h); }
.hp-rs-stay { font-size: 11px; color: var(--text-muted); flex-shrink: 0; }
.hp-rs-cost { font-size: 12px; font-weight: 600; color: var(--c-obs); flex-shrink: 0; }

/* Actions */
.hp-actions { display: flex; gap: 8px; }
.hp-act {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 8px 0; border-radius: 8px; border: 1px solid;
  font-size: 13px; font-family: var(--font-sans); cursor: pointer; transition: all .15s;
}
.hp-act-view { background: var(--c-plan); border-color: var(--c-plan); color: #fff; }
.hp-act-retry { background: var(--accent-dim); border-color: var(--accent-border); color: var(--accent); }
.hp-act-del  { background: var(--bg); border-color: var(--border); color: var(--text-muted); }
.hp-act:hover { filter: brightness(.95); }

/* Animations */
.expand-enter-active { transition: all .25s ease; overflow: hidden; }
.expand-leave-active { transition: all .2s ease; overflow: hidden; }
.expand-enter-from, .expand-leave-to { opacity: 0; max-height: 0; }
.expand-enter-to, .expand-leave-from { opacity: 1; max-height: 600px; }

@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
