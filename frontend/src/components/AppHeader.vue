<script setup lang="ts">
import { inject } from 'vue'
import type { Ref } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const showDebugJson = inject<Ref<boolean>>('showDebugJson')!
</script>

<template>
  <header class="app-header">
    <!-- Brand -->
    <div class="header-brand">
      <div class="logo-box">
        <!-- Compass SVG — Claude persimmon -->
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <circle cx="11" cy="11" r="9" stroke="#d4570a" stroke-width="1.75" fill="#fff5f0"/>
          <circle cx="11" cy="11" r="2.5" fill="#d4570a"/>
          <path d="M11 4v3M11 15v3M4 11h3M15 11h3" stroke="#d4570a" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M11 7L12.2 11H11H9.8L11 7Z" fill="#d4570a"/>
          <path d="M11 15L12.2 11H11H9.8L11 15Z" fill="#d1cfc9"/>
        </svg>
      </div>
      <span class="brand-name">CityWalk Pulse</span>
    </div>

    <!-- Center: model + stats (only when result exists) -->
    <div class="header-center" v-if="agent.result.value?.trace?.metadata">
      <span class="model-tag">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--accent)" style="flex-shrink:0">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
        {{ agent.result.value.trace.metadata.model }}
      </span>
      <span class="hc-sep">·</span>
      <span class="hc-stat" v-if="agent.result.value.trace.metadata.duration_ms">
        {{ (agent.result.value.trace.metadata.duration_ms / 1000).toFixed(1) }}s
      </span>
      <span class="hc-sep" v-if="agent.result.value.trace.metadata.tool_calls_count">·</span>
      <span class="hc-stat" v-if="agent.result.value.trace.metadata.tool_calls_count">
        {{ agent.result.value.trace.metadata.tool_calls_count }} 次工具调用
      </span>
    </div>

    <!-- Right: status + actions -->
    <div class="header-actions">
      <!-- Backend online indicator -->
      <div class="status-pill">
        <span class="status-dot"
          :class="{
            'dot-on':  agent.backendOnline.value === true,
            'dot-off': agent.backendOnline.value === false,
            'dot-chk': agent.backendOnline.value === null,
          }"
        />
        <span>{{ agent.backendOnline.value === null ? '检查中' : agent.backendOnline.value ? 'API 在线' : 'API 离线' }}</span>
      </div>

      <!-- JSON debug toggle -->
      <button class="icon-btn" :class="{ active: showDebugJson }" @click="showDebugJson = !showDebugJson" title="JSON 调试">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
        JSON
      </button>

      <!-- Reset -->
      <button class="icon-btn" :disabled="agent.status.value === 'idle'" @click="agent.reset()" title="重置">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 .49-3.36"/>
        </svg>
        重置
      </button>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex; align-items: center; gap: 14px;
  padding: 0 20px; height: 52px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  box-shadow: 0 1px 0 var(--border);
}

/* Brand */
.header-brand { display: flex; align-items: center; gap: 9px; }
.logo-box {
  width: 32px; height: 32px; border-radius: 9px;
  background: #fff5f0; border: 1px solid var(--accent-border);
  display: flex; align-items: center; justify-content: center;
}
.brand-name {
  font-size: 15px; font-weight: 700; color: var(--text-h); letter-spacing: -.02em;
}

/* Center */
.header-center {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
}
.model-tag {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; background: var(--surface-2);
  border: 1px solid var(--border); border-radius: 999px;
  font-size: 12px; font-family: var(--font-mono); color: var(--text-muted);
}
.hc-sep, .hc-stat { font-size: 12px; color: var(--text-muted); }

/* Actions */
.header-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }

.status-pill {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 10px; border: 1px solid var(--border);
  border-radius: 999px; font-size: 12px; color: var(--text-muted);
}
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.dot-on  { background: #059669; box-shadow: 0 0 5px #059669; }
.dot-off { background: #dc2626; }
.dot-chk { background: var(--text-muted); animation: pulse-dot 1.2s ease-in-out infinite; }

.icon-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 11px; border: 1px solid var(--border);
  border-radius: var(--radius-sm); background: transparent;
  color: var(--text-muted); font-family: var(--font-sans);
  font-size: 12px; cursor: pointer;
  transition: background var(--transition), color var(--transition), border-color var(--transition);
}
.icon-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-h); }
.icon-btn:disabled { opacity: .4; cursor: not-allowed; }
.icon-btn.active {
  background: #fff5f0; border-color: var(--accent-border); color: var(--accent);
}
</style>
