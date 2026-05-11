<script setup lang="ts">
import { inject } from 'vue'
import type { Ref } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'

defineProps<{ showHistory?: boolean }>()
const emit = defineEmits<{ 'toggleHistory': [] }>()

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const showDebugJson = inject<Ref<boolean>>('showDebugJson')!
</script>

<template>
  <header class="app-header">
    <div class="header-brand">
      <div class="logo-box">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#d4570a" stroke-width="1.6" fill="#fff5f0"/>
          <circle cx="12" cy="12" r="2.5" fill="#d4570a"/>
          <path d="M12 5v3M12 16v3M5 12h3M16 12h3" stroke="#d4570a" stroke-width="1.4" stroke-linecap="round"/>
          <path d="M12 8L13 12H12H11L12 8Z" fill="#d4570a"/>
          <path d="M12 16L13 12H12H11L12 16Z" fill="#d1cfc9"/>
        </svg>
      </div>
      <span class="brand-name">CityWalk Pulse</span>
    </div>

    <div class="header-center" v-if="agent.result.value?.trace?.metadata">
      <span class="model-tag">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--accent)"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
        {{ agent.result.value.trace.metadata.model }}
      </span>
      <span class="hc-sep">·</span>
      <span class="hc-stat" v-if="agent.result.value.trace.metadata.response_time_ms">
        {{ (agent.result.value.trace.metadata.response_time_ms / 1000).toFixed(1) }}s
      </span>
    </div>

    <div class="header-actions">
      <div class="status-pill">
        <span class="status-dot" :class="agent.backendOnline.value === true ? 'dot-on' : agent.backendOnline.value === false ? 'dot-off' : 'dot-chk'" />
        <span>{{ agent.backendOnline.value === null ? '检查中' : agent.backendOnline.value ? 'API 在线' : '离线' }}</span>
      </div>

      <button class="hdr-btn" :disabled="agent.status.value === 'idle'" @click="agent.reset()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.36"/></svg>
        重置
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex; align-items: center; gap: 20px;
  padding: 0 24px; height: 58px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.header-brand { display: flex; align-items: center; gap: 10px; }
.logo-box {
  width: 36px; height: 36px; border-radius: 10px;
  background: #fff5f0; border: 1px solid var(--accent-border);
  display: flex; align-items: center; justify-content: center;
}
.brand-name { font-size: 16px; font-weight: 700; color: var(--text-h); letter-spacing: -.02em; }

.header-center { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; }
.model-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 12px; background: var(--surface-2);
  border: 1px solid var(--border); border-radius: 999px;
  font-size: 13px; font-family: var(--font-mono); color: var(--text-muted);
}
.hc-sep { font-size: 13px; color: var(--text-muted); }
.hc-stat { font-size: 13px; color: var(--text-muted); }

.header-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

.status-pill {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 12px; border: 1px solid var(--border);
  border-radius: 999px; font-size: 12.5px; color: var(--text-muted);
}
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot-on  { background: #059669; box-shadow: 0 0 6px #059669; }
.dot-off { background: #dc2626; }
.dot-chk { background: var(--text-muted); animation: pulse-dot 1.2s ease-in-out infinite; }

.hdr-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 13px; border: 1px solid var(--border);
  border-radius: 8px; background: transparent;
  color: var(--text-muted); font-family: var(--font-sans);
  font-size: 13px; cursor: pointer;
  transition: all .2s;
}
.hdr-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-h); }
.hdr-btn:disabled { opacity: .35; cursor: not-allowed; }
.hdr-btn.active { background: #fff5f0; border-color: var(--accent-border); color: var(--accent); }
</style>
