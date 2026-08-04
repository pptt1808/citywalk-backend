<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { PhBrain, PhCheck, PhPath } from '@phosphor-icons/vue'
import { apiDeleteMemory, apiListMemories, type MemoryItem, type MemoryKind } from '../api/agent'
import { getMemoryUserId } from '../utils/identity'

interface LocalPreferences {
  pace: 'relaxed' | 'normal' | 'intensive'
  transport: 'walk' | 'mixed' | 'transit'
  familyFriendly: boolean
  restStops: boolean
  avoidCrowds: boolean
  indoorFirst: boolean
}

const defaults: LocalPreferences = {
  pace: 'relaxed', transport: 'mixed', familyFriendly: false,
  restStops: true, avoidCrowds: false, indoorFirst: false
}
const preferences = ref<LocalPreferences>({ ...defaults })
const memories = ref<MemoryItem[]>([])
const loading = ref(true)
const saved = ref(false)
const memoryError = ref('')
const storageKey = `citywalk-default-preferences:${getMemoryUserId() ?? 'anonymous'}`

const groupedMemories = computed(() => {
  const groups: Record<MemoryKind, MemoryItem[]> = { semantic: [], episodic: [], procedural: [] }
  memories.value.forEach(memory => groups[memory.kind].push(memory))
  return groups
})
const groupLabels: Record<MemoryKind, { title: string; description: string }> = {
  semantic: { title: '长期偏好', description: '你喜欢或明确避开的地点、氛围和出行方式' },
  procedural: { title: '规划习惯', description: 'Agent 在后续路线中会重复采用的规划方法' },
  episodic: { title: '旅程经历', description: '曾经发生过、可能对下一次规划有帮助的经历' }
}

function savePreferences() {
  localStorage.setItem(storageKey, JSON.stringify(preferences.value))
  saved.value = true
  window.setTimeout(() => { saved.value = false }, 1400)
}

async function removeMemory(memory: MemoryItem) {
  const userId = getMemoryUserId()
  if (!userId || !window.confirm(`确定让 Agent 忘记“${memory.text}”吗？`)) return
  try {
    await apiDeleteMemory(memory.id, userId)
    memories.value = memories.value.filter(item => item.id !== memory.id)
  } catch (error) {
    memoryError.value = error instanceof Error ? error.message : '删除记忆失败'
  }
}

onMounted(async () => {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored) preferences.value = { ...defaults, ...JSON.parse(stored) as Partial<LocalPreferences> }
  } catch { preferences.value = { ...defaults } }
  const userId = getMemoryUserId()
  if (userId) {
    try { memories.value = (await apiListMemories(userId)).entries }
    catch { memoryError.value = '暂时无法读取 Agent 记忆，请稍后重试。' }
  }
  loading.value = false
})

watch(preferences, savePreferences, { deep: true })
</script>

<template>
  <main class="preferences-page paper-canvas">
    <header class="preferences-heading">
      <div><small>TRAVEL PREFERENCES</small><h2>个人偏好与 Agent 设置</h2><p>这些是路线的默认倾向；每一轮对话里明确提出的新要求仍然拥有最高优先级。</p></div>
      <span :class="{ visible: saved }"><PhCheck :size="16" weight="bold" /> 已保存到当前设备</span>
    </header>

    <section class="settings-card">
      <div class="section-title"><span><PhPath :size="20" /></span><div><h3>默认规划方式</h3><p>不需要每次重复说明的基础习惯</p></div></div>
      <div class="setting-grid">
        <label><span>漫步节奏</span><select v-model="preferences.pace"><option value="relaxed">轻松慢走</option><option value="normal">适中</option><option value="intensive">紧凑探索</option></select></label>
        <label><span>交通方式</span><select v-model="preferences.transport"><option value="walk">优先步行</option><option value="mixed">步行 + 公共交通</option><option value="transit">优先公共交通</option></select></label>
      </div>
      <div class="toggle-grid">
        <label><input v-model="preferences.familyFriendly" type="checkbox"/><span><b>默认亲子友好</b><small>优先安全、低强度和儿童可参与地点</small></span></label>
        <label><input v-model="preferences.restStops" type="checkbox"/><span><b>主动安排休息点</b><small>路线中保留咖啡馆、公园座椅等停留空间</small></span></label>
        <label><input v-model="preferences.avoidCrowds" type="checkbox"/><span><b>尽量避开拥挤</b><small>降低热门商业点和高峰时段的优先级</small></span></label>
        <label><input v-model="preferences.indoorFirst" type="checkbox"/><span><b>天气不佳时室内优先</b><small>自动提高博物馆、书店和室内场馆权重</small></span></label>
      </div>
    </section>

    <section class="settings-card memory-card">
      <div class="section-title"><span><PhBrain :size="20" /></span><div><h3>Agent 已记住的内容</h3><p>三层记忆可以查看，也可以逐条要求遗忘</p></div></div>
      <p v-if="memoryError" class="memory-error">{{ memoryError }}</p>
      <p v-if="loading" class="memory-empty">正在整理你的记忆…</p>
      <div v-else class="memory-columns">
        <section v-for="kind in (['semantic', 'procedural', 'episodic'] as MemoryKind[])" :key="kind">
          <header><h4>{{ groupLabels[kind].title }}</h4><span>{{ groupedMemories[kind].length }}</span><p>{{ groupLabels[kind].description }}</p></header>
          <article v-for="memory in groupedMemories[kind]" :key="memory.id">
            <p>{{ memory.text }}</p><small>{{ Math.round(memory.confidence * 100) }}% 置信度 · {{ new Date(memory.updatedAt).toLocaleDateString('zh-CN') }}</small>
            <button @click="removeMemory(memory)">让 Agent 忘记</button>
          </article>
          <p v-if="!groupedMemories[kind].length" class="memory-empty">这一层还没有内容</p>
        </section>
      </div>
    </section>
  </main>
</template>

<style scoped>
.preferences-page{flex:1;min-height:0;overflow-y:auto;padding:46px clamp(24px,6vw,82px) 100px}.preferences-heading{max-width:1180px;margin:0 auto 35px;display:flex;align-items:flex-end;justify-content:space-between;gap:28px}.preferences-heading small{color:var(--primary);font-size:11px;font-weight:900;letter-spacing:.18em}.preferences-heading h2{margin:4px 0 8px;color:var(--primary);font:800 clamp(35px,4vw,52px)/1.1 var(--font-display)}.preferences-heading p{max-width:720px;color:var(--text);font-size:15px}.preferences-heading>span{padding:8px 13px;border-radius:999px;background:var(--secondary-container);color:var(--on-secondary-container);font-size:12px;font-weight:800;opacity:0;transition:.2s}.preferences-heading>span.visible{opacity:1}.settings-card{max-width:1180px;margin:0 auto 28px;padding:28px 30px;border:1px solid rgba(138,114,102,.19);border-radius:8px 23px 10px 20px;background:rgba(255,255,255,.63);box-shadow:var(--shadow-paper)}.section-title{display:flex;align-items:center;gap:14px;padding-bottom:20px;margin-bottom:22px;border-bottom:1px dashed rgba(138,114,102,.24)}.section-title>span{width:42px;height:42px;display:grid;place-items:center;border:2px double var(--primary);border-radius:50%;color:var(--primary);font-size:12px;font-weight:900;transform:rotate(-6deg)}.section-title h3{font:700 23px var(--font-display)}.section-title p{color:var(--text-muted);font-size:12px}.setting-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.setting-grid label{display:grid;gap:8px}.setting-grid label>span{color:var(--text-h);font-size:14px;font-weight:750}.setting-grid select{width:100%;padding:12px 14px;border:1px solid var(--border);border-radius:11px;background:var(--surface);color:var(--text);font-size:14px}.toggle-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:22px}.toggle-grid label{display:flex;align-items:flex-start;gap:11px;padding:15px;border:1px solid rgba(138,114,102,.17);border-radius:13px;background:rgba(252,249,240,.68);cursor:pointer}.toggle-grid input{width:18px;height:18px;margin-top:2px;accent-color:var(--primary)}.toggle-grid label>span{display:grid}.toggle-grid b{color:var(--text-h);font-size:14px}.toggle-grid small{margin-top:2px;color:var(--text-muted);font-size:11px;line-height:1.5}.memory-columns{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.memory-columns>section{min-width:0;padding:16px;border:1px solid rgba(138,114,102,.16);border-radius:14px;background:rgba(252,249,240,.62)}.memory-columns header{display:grid;grid-template-columns:1fr auto;margin-bottom:12px}.memory-columns h4{font:700 17px var(--font-display)}.memory-columns header>span{min-width:26px;height:26px;display:grid;place-items:center;border-radius:999px;background:var(--secondary-container);color:var(--on-secondary-container);font-size:11px;font-weight:800}.memory-columns header p{grid-column:1/-1;color:var(--text-muted);font-size:11px}.memory-columns article{position:relative;padding:13px 11px 40px;margin-top:9px;border-radius:10px;background:#fff;border:1px solid rgba(138,114,102,.14)}.memory-columns article p{color:var(--text);font-size:13px;line-height:1.6}.memory-columns article small{display:block;margin-top:6px;color:var(--text-muted);font-size:10px}.memory-columns article button{position:absolute;right:8px;bottom:8px;padding:4px 8px;border:0;border-radius:999px;background:#ffdad6;color:#93000a;font-size:10px;font-weight:700;cursor:pointer}.memory-empty{padding:18px 8px;color:var(--text-muted);font-size:12px;text-align:center}.memory-error{margin-bottom:14px;padding:10px;border-radius:9px;background:#ffdad6;color:#93000a;font-size:12px}@media(max-width:900px){.memory-columns{grid-template-columns:1fr}.toggle-grid{grid-template-columns:1fr}}@media(max-width:650px){.preferences-page{padding:28px 16px 90px}.preferences-heading{display:block}.preferences-heading>span{display:inline-block;margin-top:12px}.settings-card{padding:20px 16px}.setting-grid{grid-template-columns:1fr}}
/* Taste Skill redesign layer. */
.preferences-heading small{font-size:12px;letter-spacing:.06em}.preferences-heading h2{font-size:clamp(34px,4vw,50px)}.preferences-heading p{font-size:16px;text-wrap:pretty}
.preferences-heading>span{display:flex;align-items:center;gap:6px;background:var(--primary-fixed);color:var(--primary);font-size:13px}
.settings-card{border-color:var(--border);border-radius:var(--radius);box-shadow:none;background:rgba(255,255,255,.68)}
.section-title{border-color:var(--border)}.section-title>span{width:40px;height:40px;border:1px solid var(--accent-border);border-radius:var(--radius-sm);transform:none}.section-title h3{font-size:24px}.section-title p{font-size:13px}
.setting-grid select{border-radius:var(--radius-control);font-size:15px}.toggle-grid label{border-color:var(--border-subtle);border-radius:var(--radius-control);background:var(--surface)}.toggle-grid small{font-size:12px}
.memory-columns>section{border-color:var(--border-subtle);border-radius:var(--radius);background:var(--surface-2)}.memory-columns header>span{background:var(--primary-fixed);color:var(--primary);font-size:12px}.memory-columns header p{font-size:12px}.memory-columns article{border-color:var(--border-subtle);border-radius:var(--radius-control)}.memory-columns article p{font-size:14px}.memory-columns article small,.memory-columns article button{font-size:12px}
@media(max-width:650px){.preferences-heading>span{display:inline-flex}}
</style>
