<script setup lang="ts">
import { inject, ref, watch, nextTick } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { StateEventType } from '../api/agent'

defineProps<{ forceExpanded?: boolean }>()
const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const feedEl = ref<HTMLElement | null>(null)
const expandedIdx = ref<number | null>(null)

const evLabel: Record<StateEventType, string> = {
  PLAN: '规划', THINK: '思考', ACTION: '调用', OBS: '观察', REFLECT: '反思', RESULT: '结果', ERROR: '错误',
}

function toggleExpand(idx: number) { expandedIdx.value = expandedIdx.value === idx ? null : idx }
function formatOutput(v: unknown) { return typeof v === 'string' ? v : JSON.stringify(v, null, 2) }

watch(() => agent.visibleEvents.value.length, async () => {
  await nextTick()
  if (feedEl.value) feedEl.value.scrollTop = feedEl.value.scrollHeight
})
</script>

<template>
  <section class="feed">
    <div class="feed-head">
      <span class="feed-head-title">执行过程</span>
      <span v-if="agent.isRunning.value" class="feed-badge live"><span class="dot" />实时</span>
      <span v-else-if="agent.visibleEvents.value.length" class="feed-badge">{{ agent.visibleEvents.value.length }} 条</span>
    </div>

    <div class="feed-body" ref="feedEl">
      <div v-if="agent.status.value === 'loading'" class="feed-loading">
        <div class="skel" style="width:40%" /><div class="skel" style="width:65%;animation-delay:.12s" /><div class="skel" style="width:52%;animation-delay:.24s" />
        <div class="feed-loading-ring"><div class="ring" /><span>Agent 正在思考…</span></div>
      </div>

      <TransitionGroup name="ev-list" tag="div" class="events">
        <div v-for="(ev, idx) in agent.visibleEvents.value" :key="idx" class="ev" :class="[`bg-${ev.event_type}`]" :style="{ cursor: ev.tool_call ? 'pointer' : 'default' }" @click="ev.tool_call ? toggleExpand(idx) : undefined">
          <div class="ev-meta">
            <span class="ev-badge" :class="`b-${ev.event_type}`">{{ evLabel[ev.event_type] }}</span>
            <span class="ev-time">{{ new Date(ev.timestamp).toLocaleTimeString('zh-CN') }}</span>
            <span v-if="ev.tool_call" class="ev-tool">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
              {{ ev.tool_call.tool }}
            </span>
            <svg v-if="ev.tool_call" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="arrow" :class="{ rotated: expandedIdx === idx }" style="margin-left:auto;color:var(--text-muted)"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div class="ev-content">{{ ev.content }}</div>
          <Transition name="expand">
            <div v-if="ev.tool_call && expandedIdx === idx" class="ev-detail">
              <div class="td"><span class="td-label">INPUT</span><pre>{{ JSON.stringify(ev.tool_call.input, null, 2) }}</pre></div>
              <div class="td" v-if="ev.tool_call.output !== undefined"><span class="td-label">OUTPUT</span><pre>{{ formatOutput(ev.tool_call.output) }}</pre></div>
            </div>
          </Transition>
        </div>
      </TransitionGroup>

      <Transition name="fade">
        <div v-if="agent.isDone.value && agent.result.value?.summary" class="final">
          <div class="final-head">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--c-result)" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="9 11 12 14 22 4"/></svg>
            最终摘要
          </div>
          <p class="final-text">{{ agent.result.value.summary }}</p>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.feed { display: flex; flex-direction: column; overflow: hidden; flex: 1; }
.feed-head { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0; }
.feed-head-title { font-size: 13px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .07em; }
.feed-badge { font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 5px; }
.feed-badge.live { color: var(--accent); }
.dot { width: 7px; height: 7px; background: var(--accent); border-radius: 50%; animation: pulse-dot 1.2s ease-in-out infinite; }

.feed-body { flex: 1; overflow-y: auto; padding: 14px 14px; }
.feed-body::-webkit-scrollbar { width: 8px; }
.feed-body::-webkit-scrollbar-track { background: var(--surface-2); }
.feed-body::-webkit-scrollbar-thumb { background: #ccc8c2; border-radius: 4px; }

.feed-loading { display: flex; flex-direction: column; gap: 12px; padding: 10px 0; }
.skel { height: 14px; border-radius: 4px; background: linear-gradient(90deg, var(--border) 25%, var(--surface-hover) 50%, var(--border) 75%); background-size: 200% 100%; animation: shimmer 1.4s ease-in-out infinite; }
.feed-loading-ring { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 24px; }
.ring { width: 32px; height: 32px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }

.events { display: flex; flex-direction: column; gap: 8px; }
.ev { border-radius: 10px; border: 1px solid var(--border); padding: 12px 14px; background: var(--surface); animation: fadeSlideIn .22s ease both; transition: border-color .2s; }
.bg-PLAN    { background: #f8f8ff; }
.bg-THINK   { background: #f9fafb; }
.bg-ACTION  { background: #fffbf0; }
.bg-OBS     { background: #f0fdf8; }
.bg-REFLECT { background: #fff8f5; }
.bg-RESULT  { background: #f6f4ff; }
.bg-ERROR   { background: #fff5f5; }

.ev-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ev-badge { display: inline-flex; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.ev-time { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
.ev-tool { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono); }
.arrow { transition: transform .2s; }
.arrow.rotated { transform: rotate(180deg); }

.ev-content { font-size: 13.5px; color: var(--text); line-height: 1.6; }

.ev-detail { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.td { display: flex; flex-direction: column; gap: 4px; }
.td-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); }
.td pre { font-size: 12px; max-height: 200px; }

.final { margin-top: 16px; padding: 16px 18px; background: #f6f4ff; border: 1px solid #ddd6fe; border-radius: 12px; }
.final-head { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 600; color: var(--c-result); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 8px; }
.final-text { font-size: 13.5px; color: var(--text-h); line-height: 1.7; }

.ev-list-enter-active { transition: all .22s ease; }
.ev-list-enter-from { opacity: 0; transform: translateY(7px); }
.expand-enter-active, .expand-leave-active { transition: all .2s ease; overflow: hidden; }
.expand-enter-from, .expand-leave-to { opacity: 0; max-height: 0; }
.expand-enter-to, .expand-leave-from { opacity: 1; max-height: 600px; }
.fade-enter-active, .fade-leave-active { transition: opacity .3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
