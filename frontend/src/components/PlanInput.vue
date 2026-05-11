<script setup lang="ts">
import { inject, ref, computed } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { PlanRequest } from '../api/agent'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!

const taskText = ref('')
type ModelChoice = 'flash' | 'pro'
const selectedModel = ref<ModelChoice>('flash')

const templates = [
  { icon: '🌤', label: '周末漫步', text: '南京周末轻松漫步，3小时，预算100元以内，想去特色书店和咖啡馆' },
  { icon: '🏛', label: '深度文化', text: '深度文化游，参观博物馆和历史街区，5小时，预算200元' },
  { icon: '🍜', label: '美食探店', text: '美食探店之旅，2小时，120元，推荐本地特色小吃' },
  { icon: '🌧', label: '雨天室内', text: '今天可能下雨，安排以室内为主的路线，4小时，150元' },
  { icon: '🚇', label: '地铁沿线', text: '地铁沿线游玩，玄武湖+南博+新街口，全天，80元' },
]

const isRunning = computed(() => agent.isRunning.value)

function applyTemplate(text: string) { taskText.value = text }

async function handleSubmit() {
  const task = taskText.value.trim()
  if (!task) return
  const req: PlanRequest = { task, preferredModel: selectedModel.value }
  await agent.run(req)
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit() }
}
</script>

<template>
  <aside class="plan-input-panel">
    <div class="panel-header">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
      </svg>
      <h2 class="panel-title">规划任务</h2>
    </div>

    <div class="input-section">
      <label class="input-label">用自然语言描述你的 CityWalk</label>
      <textarea v-model="taskText" class="task-textarea" placeholder="例：下午去新街口逛逛，顺便喝杯咖啡，最后去南京南站坐车，3小时，步行不超过30分钟…" rows="6" :disabled="isRunning" @keydown="handleKeydown" />
      <p class="input-hint">⌘ + Enter 快速提交 · AI 自动识别城市、时长、偏好</p>
    </div>

    <div class="template-section">
      <p class="section-label">快捷示例</p>
      <div class="template-list">
        <button v-for="t in templates" :key="t.label" class="template-chip" :disabled="isRunning" @click="applyTemplate(t.text)">
          <span class="chip-icon">{{ t.icon }}</span>
          <span class="chip-label">{{ t.label }}</span>
        </button>
      </div>
    </div>

    <div style="flex:1" />

    <div class="model-selector">
      <span class="model-label">模型</span>
      <div class="model-pills">
        <button class="model-pill" :class="{ active: selectedModel === 'flash' }" :disabled="isRunning" @click="selectedModel = 'flash'">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          Flash 快速
        </button>
        <button class="model-pill" :class="{ active: selectedModel === 'pro' }" :disabled="isRunning" @click="selectedModel = 'pro'">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          V4 Pro 深思
        </button>
      </div>
    </div>

    <button class="btn btn-primary submit-btn" :disabled="isRunning || !taskText.trim()" @click="handleSubmit">
      <template v-if="!isRunning">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        开始规划
      </template>
      <template v-else>
        <span class="spinner" /> Agent 思考中…
      </template>
    </button>

    <Transition name="fade">
      <div v-if="agent.isError.value" class="error-box">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" style="flex-shrink:0;margin-top:1px"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-1-8a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1z" clip-rule="evenodd"/></svg>
        <span>{{ agent.error.value }}</span>
      </div>
    </Transition>
  </aside>
</template>

<style scoped>
.plan-input-panel {
  display: flex; flex-direction: column; gap: 20px;
  padding: 22px 18px 18px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  overflow-y: auto;
}
.panel-header { display: flex; align-items: center; gap: 10px; }
.panel-title { font-size: 16px; font-weight: 700; color: var(--text-h); }

.input-section { display: flex; flex-direction: column; gap: 8px; }
.input-label { font-size: 13px; color: var(--text-muted); font-weight: 500; }
.task-textarea {
  width: 100%; background: var(--bg); border: 1.5px solid var(--border);
  border-radius: 10px; color: var(--text-h); font-family: var(--font-sans);
  font-size: 14px; padding: 12px 14px; resize: vertical; min-height: 120px;
  line-height: 1.7; transition: border-color .2s, box-shadow .2s;
}
.task-textarea::placeholder { color: var(--text-muted); }
.task-textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
.task-textarea:disabled { opacity: .5; }
.input-hint { font-size: 11.5px; color: var(--text-muted); }

.section-label { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
.template-list { display: flex; flex-direction: column; gap: 6px; }
.template-chip {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 13px; background: var(--bg); border: 1px solid var(--border);
  border-radius: 9px; font-family: var(--font-sans); font-size: 13px;
  color: var(--text); cursor: pointer; text-align: left;
  transition: all .15s;
}
.template-chip:hover:not(:disabled) { background: var(--accent-dim); border-color: var(--accent-border); }
.template-chip:disabled { opacity: .4; cursor: not-allowed; }
.chip-icon { font-size: 17px; }
.chip-label { font-size: 13.5px; }

.model-selector { display: flex; align-items: center; gap: 12px; }
.model-label { font-size: 12.5px; font-weight: 600; color: var(--text-muted); white-space: nowrap; }
.model-pills { display: flex; gap: 6px; flex: 1; }
.model-pill {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 10px; background: var(--bg); border: 1.5px solid var(--border);
  border-radius: 8px; font-family: var(--font-sans); font-size: 13px; font-weight: 500;
  color: var(--text-muted); cursor: pointer; transition: all .15s;
}
.model-pill:hover:not(:disabled) { border-color: var(--accent-border); color: var(--text-h); background: var(--accent-dim); }
.model-pill.active { background: var(--accent-dim); border-color: var(--accent); color: var(--accent); font-weight: 600; }
.model-pill:disabled { opacity: .4; cursor: not-allowed; }

.submit-btn { width: 100%; justify-content: center; padding: 13px; font-size: 15px; font-weight: 600; border-radius: 10px; }
.spinner { display: inline-block; width: 15px; height: 15px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; border-radius: 50%; animation: spin .7s linear infinite; }

.error-box { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; font-size: 13px; color: #991b1b; line-height: 1.5; }
.fade-enter-active, .fade-leave-active { transition: opacity .2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
