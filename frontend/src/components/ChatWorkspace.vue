<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue'
import {
  PhArrowClockwise, PhChatsCircle, PhCompass, PhMapPinLine, PhMicrophone,
  PhPaperPlaneTilt, PhPaperclip, PhPath, PhPlus, PhSparkle, PhStop,
} from '@phosphor-icons/vue'
import {
  apiListFavoriteRoutes, apiListHistory, apiListMemories,
  type FavoriteRoute, type HistoryEntry, type MemoryItem, type PlanningResult, type PlanRequest
} from '../api/agent'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { SkillController, UserSkill } from '../composables/useSkills'
import { getMemoryThreadId, getMemoryUserId } from '../utils/identity'
import MapSearchAnimation from './MapSearchAnimation.vue'
import ResultView from './ResultView.vue'
import {
  buildPromptSuggestions,
  type LocalPreferenceSnapshot,
  type PromptSuggestion
} from '../utils/promptSuggestions'

interface ChatTurn {
  id: string
  task: string
  result?: PlanningResult
  error?: string
}

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const skillController = inject<SkillController>('skills')!
const taskText = ref('')
const turns = ref<ChatTurn[]>([])
const history = ref<HistoryEntry[]>([])
const favorites = ref<FavoriteRoute[]>([])
const suggestionMemories = ref<MemoryItem[]>([])
const suggestions = ref<PromptSuggestion[]>(buildPromptSuggestions({ memories: [], favorites: [], history: [] }))
const suggestionRound = ref(0)
const suggestionLoading = ref(false)
const sidebarMode = ref<'history' | 'favorites'>('history')
const historyLoading = ref(false)
const activeHistoryId = ref<string | null>(null)
const streamEl = ref<HTMLElement>()
const fileInput = ref<HTMLInputElement>()
const composerFocused = ref(false)
const skillMenuOpen = ref(false)
const selectedSkillIds = ref<string[]>([])
const copiedSocialVariant = ref('')
const attachedFiles = ref<File[]>([])
const listening = ref(false)
let recognition: { start: () => void; stop: () => void } | null = null

const running = computed(() => agent.isRunning.value)
const lastTurn = computed(() => turns.value.at(-1))
const availableSkills = computed(() => skillController.skills.value.filter(skill => skill.enabled))
const selectedSkills = computed(() => availableSkills.value.filter(skill => selectedSkillIds.value.includes(skill.id)))
const sidebarEntries = computed(() => sidebarMode.value === 'history' ? history.value : favorites.value)
const personalizedSuggestionCount = computed(() => suggestions.value.filter(item => item.basis !== 'starter').length)

function needsStructuredView(result: PlanningResult): boolean {
  return result.responseKind === 'route' || result.responseKind === 'comparison'
}

function uid() { return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}` }

function readDefaultPreferences(): LocalPreferenceSnapshot {
  const userId = getMemoryUserId() ?? 'anonymous'
  try {
    const raw = localStorage.getItem(`citywalk-default-preferences:${userId}`)
    return raw ? JSON.parse(raw) as LocalPreferenceSnapshot : {}
  } catch { return {} }
}

function defaultPreferenceHint(): string {
  try {
    const value = readDefaultPreferences()
    const labels = [
      value.pace === 'relaxed' ? '默认轻松慢走' : value.pace === 'intensive' ? '默认紧凑探索' : '默认适中节奏',
      value.transport === 'walk' ? '优先步行' : value.transport === 'transit' ? '优先公共交通' : '步行与公共交通结合',
      value.familyFriendly ? '亲子友好' : '', value.restStops ? '安排休息点' : '',
      value.avoidCrowds ? '尽量避开拥挤' : '', value.indoorFirst ? '天气不佳时室内优先' : ''
    ].filter(Boolean)
    return labels.length ? `若本轮没有相反要求，可参考用户默认偏好：${labels.join('、')}。` : ''
  } catch { return '' }
}

function rebuildSuggestions() {
  suggestions.value = buildPromptSuggestions({
    memories: suggestionMemories.value,
    favorites: favorites.value,
    history: history.value,
    defaults: readDefaultPreferences(),
    now: new Date(),
    round: suggestionRound.value
  })
}

async function loadSuggestionContext() {
  const userId = getMemoryUserId()
  if (!userId) {
    rebuildSuggestions()
    return
  }
  suggestionLoading.value = true
  const [memoryResult, favoriteResult] = await Promise.allSettled([
    apiListMemories(userId), apiListFavoriteRoutes(userId)
  ])
  if (memoryResult.status === 'fulfilled') suggestionMemories.value = memoryResult.value.entries
  if (favoriteResult.status === 'fulfilled') favorites.value = favoriteResult.value.entries
  suggestionLoading.value = false
  rebuildSuggestions()
}

function rotateSuggestions() {
  suggestionRound.value += 1
  rebuildSuggestions()
}

async function scrollToBottom() {
  await nextTick()
  streamEl.value?.scrollTo({ top: streamEl.value.scrollHeight, behavior: 'smooth' })
}

async function submit() {
  const task = taskText.value.trim()
  if (!task || running.value) return
  const turn: ChatTurn = { id: uid(), task }
  turns.value.push(turn)
  taskText.value = ''
  activeHistoryId.value = null
  void scrollToBottom()
  const request: PlanRequest = {
    task,
    attachments: attachedFiles.value.map(file => file.name),
    activeSkillIds: [...selectedSkillIds.value],
    activeSkills: selectedSkills.value.map(skill => ({ id: skill.id, name: skill.name, description: skill.description, instruction: skill.instruction, priority: skill.priority, applicableIntents: skill.applicableIntents, version: skill.version })),
    preferredModel: 'flash', userId: getMemoryUserId(), threadId: getMemoryThreadId()
  }
  selectedSkillIds.value = []
  attachedFiles.value = []
  composerFocused.value = false
  try {
    await agent.run(request)
    if (agent.result.value) turn.result = agent.result.value
    else if (agent.error.value) turn.error = agent.error.value
  } catch (error) {
    turn.error = error instanceof Error ? error.message : '这次没有顺利完成，请再试一次'
  }
  await scrollToBottom()
  await loadHistory()
  void loadSuggestionContext()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void submit()
  }
}

function newConversation() {
  agent.newConversation()
  turns.value = []
  activeHistoryId.value = null
  taskText.value = ''
  selectedSkillIds.value = []
  attachedFiles.value = []
}

function selectAttachments(event: Event) {
  attachedFiles.value = Array.from((event.target as HTMLInputElement).files ?? [])
  composerFocused.value = true
}

function chooseSkill(skill: UserSkill) {
  selectedSkillIds.value = selectedSkillIds.value.includes(skill.id)
    ? selectedSkillIds.value.filter(id => id !== skill.id)
    : [...selectedSkillIds.value, skill.id].slice(0, 5)
  composerFocused.value = true
}

function hashtagLine(hashtags: string[]): string {
  return hashtags.map(tag => `#${tag.replace(/^#+/, '')}`).join(' ')
}

async function copySocialVariant(turnId: string, index: number, text: string, hashtags: string[]) {
  const copyText = `${text}${hashtags.length ? `\n${hashtagLine(hashtags)}` : ''}`
  try {
    await navigator.clipboard.writeText(copyText)
  } catch {
    const area = document.createElement('textarea')
    area.value = copyText
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  copiedSocialVariant.value = `${turnId}:${index}`
  window.setTimeout(() => {
    if (copiedSocialVariant.value === `${turnId}:${index}`) copiedSocialVariant.value = ''
  }, 1600)
}

function toggleVoice() {
  if (listening.value && recognition) {
    recognition.stop()
    return
  }
  type RecognitionLike = {
    lang: string
    interimResults: boolean
    continuous: boolean
    start: () => void
    stop: () => void
    onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null
    onend: (() => void) | null
    onerror: (() => void) | null
  }
  type RecognitionConstructor = new () => RecognitionLike
  const speechWindow = window as typeof window & {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
  if (!Recognition) {
    taskText.value ||= '当前浏览器不支持语音输入，请使用 Chrome 或 Edge。'
    composerFocused.value = true
    return
  }
  const instance = new Recognition()
  instance.lang = 'zh-CN'
  instance.interimResults = false
  instance.continuous = false
  instance.onresult = event => {
    const transcript = event.results[0]?.[0]?.transcript?.trim()
    if (transcript) taskText.value = `${taskText.value}${taskText.value ? ' ' : ''}${transcript}`
  }
  instance.onend = () => { listening.value = false; recognition = null }
  instance.onerror = () => { listening.value = false; recognition = null }
  recognition = instance
  listening.value = true
  composerFocused.value = true
  instance.start()
}

function openHistory(entry: HistoryEntry | FavoriteRoute) {
  activeHistoryId.value = entry.id
  agent.loadResult(entry.result, entry.request)
  turns.value = [{ id: `history_${entry.id}`, task: entry.request?.task ?? entry.result.title, result: entry.result }]
  void scrollToBottom()
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}天前` : new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

async function loadHistory() {
  const userId = getMemoryUserId()
  if (!userId) return
  historyLoading.value = true
  try {
    if (sidebarMode.value === 'history') history.value = (await apiListHistory(userId, 30, 0)).entries
    else favorites.value = (await apiListFavoriteRoutes(userId)).entries
  } catch {
    if (sidebarMode.value === 'history') history.value = []
    else favorites.value = []
  }
  finally { historyLoading.value = false }
}

function switchSidebarMode(mode: 'history' | 'favorites') {
  if (sidebarMode.value === mode) return
  sidebarMode.value = mode
  activeHistoryId.value = null
  void loadHistory()
}

const refreshPersonalizedSuggestions = () => { void loadSuggestionContext() }

onMounted(async () => {
  await loadHistory()
  await loadSuggestionContext()
  window.addEventListener('citywalk:favorites-changed', refreshPersonalizedSuggestions)
})

onUnmounted(() => window.removeEventListener('citywalk:favorites-changed', refreshPersonalizedSuggestions))
</script>

<template>
  <main class="chat-workspace">
    <aside class="conversation-column">
      <div class="history-heading"><div><small>漫游记录</small><h2>{{ sidebarMode === 'history' ? '最近对话' : '收藏路线' }}</h2></div><button :title="sidebarMode === 'history' ? '刷新对话' : '刷新收藏'" :aria-label="sidebarMode === 'history' ? '刷新对话' : '刷新收藏'" @click="loadHistory"><PhArrowClockwise :size="17" /></button></div>
      <div class="history-tabs" role="tablist" aria-label="漫游记录类型">
        <button role="tab" :aria-selected="sidebarMode === 'history'" :class="{ active: sidebarMode === 'history' }" @click="switchSidebarMode('history')">历史</button>
        <button role="tab" :aria-selected="sidebarMode === 'favorites'" :class="{ active: sidebarMode === 'favorites' }" @click="switchSidebarMode('favorites')">收藏</button>
      </div>
      <button class="new-chat" @click="newConversation"><PhPlus :size="18" weight="bold" /> 开始新漫游</button>
      <nav class="history-list">
        <p v-if="historyLoading && !sidebarEntries.length" class="history-state">{{ sidebarMode === 'history' ? '正在翻阅旧手账…' : '正在整理收藏路线…' }}</p>
        <p v-else-if="!sidebarEntries.length" class="history-state">{{ sidebarMode === 'history' ? '对话会像旅行便签一样留在这里。' : '在路线卡片点击“收藏路线”后，会出现在这里。' }}</p>
        <button v-for="entry in sidebarEntries" :key="entry.id" :class="{ active: activeHistoryId === entry.id }" @click="openHistory(entry)">
          <span class="history-icon"><PhPath v-if="entry.result.responseKind === 'route'" :size="17" /><PhChatsCircle v-else :size="17" /></span>
          <span class="history-copy"><strong>{{ entry.request?.task || entry.result.title }}</strong><small>{{ relativeTime(entry.createdAt) }} · {{ entry.result.responseKind === 'route' ? `${entry.result.stops.length}个地点` : '对话' }}</small></span>
        </button>
      </nav>
      <div class="history-foot"><span>{{ sidebarMode === 'history' ? '对话记忆已开启' : `${favorites.length} 条路线已收藏` }}</span><small>{{ sidebarMode === 'history' ? 'Agent 会延续当前对话中的约束' : '点开路线后，可在卡片底部取消收藏或现在出发' }}</small></div>
    </aside>

    <section class="conversation-main paper-canvas">
      <div class="chat-decor" aria-hidden="true">
        <div class="decor-postmark"><span>CITY WALK</span><b>JOURNAL</b><small>URBAN NOTES</small></div>
        <div class="decor-compass"><b>N</b><i /><span>W&nbsp;&nbsp;&nbsp;&nbsp;E</span><small>S</small></div>
        <svg class="decor-route" viewBox="0 0 420 250" fill="none"><path d="M20 216C96 176 61 103 152 128C235 151 202 54 286 42C350 33 343 103 405 76"/><circle cx="20" cy="216" r="6"/><circle cx="152" cy="128" r="6"/><circle cx="286" cy="42" r="6"/><circle cx="405" cy="76" r="6"/></svg>
        <p class="decor-handwriting decor-handwriting-a">拐进小巷看看</p>
        <p class="decor-handwriting decor-handwriting-b">记得抬头</p>
        <div class="decor-ticket"><span>URBAN WANDERER</span><b>慢慢走，认真看</b><small>ADMIT ONE</small></div>
      </div>
      <div ref="streamEl" class="message-stream">
        <div v-if="!turns.length && agent.status.value === 'idle'" class="chat-welcome">
          <span class="welcome-compass"><PhCompass :size="34" weight="duotone" /></span>
          <small>路线、比较、修改与城市问答</small>
          <h2>把今天想走的路，<br/>写成一张城市便签</h2>
          <p>可以只说一种感觉，也可以告诉我同行的人、时间、预算和不想错过的地方。</p>
          <div class="suggestion-toolbar"><span>{{ suggestionLoading ? '正在结合你的路线与偏好…' : personalizedSuggestionCount ? `其中 ${personalizedSuggestionCount} 条已结合你的信息` : '先从这几种走法开始' }}</span><button :disabled="suggestionLoading" @click="rotateSuggestions"><PhArrowClockwise :size="14" /> 换一组</button></div>
          <div class="suggestion-notes">
            <button v-for="(item, index) in suggestions" :key="`${suggestionRound}:${item.label}`" :title="item.reason" @click="taskText = item.text"><span>{{ String(index + 1).padStart(2, '0') }} / {{ item.label }}</span><p>{{ item.text }}</p><small>{{ item.reason }}</small></button>
          </div>
        </div>

        <template v-for="turn in turns" :key="turn.id">
          <article class="user-note"><span class="note-label">你的城市便签</span><p>{{ turn.task }}</p><PhMapPinLine :size="17" aria-hidden="true" /></article>

          <MapSearchAnimation v-if="running && turn === lastTurn" />

          <div v-else-if="turn.error" class="error-note"><strong>这次回复没有完成</strong><p>{{ turn.error }}</p></div>

          <article v-else-if="turn.result" class="agent-reply" :class="{ detailed: needsStructuredView(turn.result), route: turn.result.responseKind === 'route' }">
            <ResultView v-if="needsStructuredView(turn.result)" class="unified-result" :value="turn.result" />
            <div v-else class="assistant-message">
              <span class="assistant-mark">AI</span>
              <div class="assistant-bubble">
                <strong v-if="turn.result.title && turn.result.title !== (turn.result.answer || turn.result.summary)">{{ turn.result.title }}</strong>
                <p>{{ turn.result.answer || turn.result.summary }}</p>
                <div v-if="turn.result.skillExecutions?.length" class="bubble-skills">已应用：{{ turn.result.skillExecutions.map(item => item.name).join('、') }}<span v-if="turn.result.skillExecutions.some(item => item.status !== 'applied')">（部分规则未执行）</span></div>
                <div v-if="turn.result.socialCopy?.variants.length" class="bubble-copy-list">
                  <p v-if="turn.result.socialCopy.generationDiagnostics?.regeneration?.attempted" class="copy-diagnostic">
                    已根据「{{ turn.result.socialCopy.generationDiagnostics.regeneration.reasons.join('；') }}」重新生成一次<span v-if="turn.result.socialCopy.generationDiagnostics.fallbackTriggered">，第二次仍未完全满足约束，已保留安全版本。</span><span v-else>，本次已通过约束检查。</span>
                  </p>
                  <div v-if="turn.result.socialCopy.styleProfile" class="bubble-copy-style">
                    <span>本次声口</span>
                    <strong>{{ turn.result.socialCopy.styleProfile.label }}</strong>
                    <p>{{ turn.result.socialCopy.styleProfile.signature.narrativeMove }}</p>
                  </div>
                  <section v-for="(variant, variantIndex) in turn.result.socialCopy.variants" :key="`${variant.tone}-${variantIndex}`" class="bubble-copy-variant">
                    <header><b>{{ variant.tone }}</b><button @click="copySocialVariant(turn.id, variantIndex, variant.text, variant.hashtags)">{{ copiedSocialVariant === `${turn.id}:${variantIndex}` ? '已复制' : '复制文案' }}</button></header>
                    <p>{{ variant.text }}</p>
                    <small v-if="variant.hashtags.length">{{ hashtagLine(variant.hashtags) }}</small>
                  </section>
                </div>
                <section v-for="section in turn.result.sections" :key="section.title" class="bubble-section"><b>{{ section.title }}</b><ul><li v-for="item in section.items" :key="item">{{ item }}</li></ul></section>
                <div v-if="turn.result.sources?.length" class="bubble-sources"><span>参考：</span><a v-for="source in turn.result.sources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a></div>
              </div>
            </div>
          </article>
        </template>
        <div class="stream-bottom" />
      </div>

      <div class="composer-dock">
        <div class="torn-edge" />
        <div class="composer-box" :class="{ expanded: composerFocused || Boolean(taskText) || selectedSkillIds.length > 0 || attachedFiles.length }" @focusin="composerFocused = true">
          <div class="composer-main">
            <button class="voice" :class="{ listening }" :title="listening ? '停止语音输入' : '语音输入'" :aria-label="listening ? '停止语音输入' : '语音输入'" @click="toggleVoice"><PhStop v-if="listening" :size="18" weight="fill" /><PhMicrophone v-else :size="20" /></button>
            <textarea v-model="taskText" rows="1" :disabled="running" placeholder="写下目的地、同行人或今天想要的感觉…" @keydown="handleKeydown" />
            <button class="send" aria-label="发送消息" :disabled="running || !taskText.trim()" @click="submit"><span v-if="running">...</span><PhPaperPlaneTilt v-else :size="20" weight="fill" /></button>
          </div>
          <div class="composer-tools">
            <div class="skill-picker">
              <button class="tool-button" :class="{ active: selectedSkillIds.length }" @click="skillMenuOpen = !skillMenuOpen"><PhSparkle :size="15" /> {{ selectedSkills.length ? `已选 ${selectedSkills.length} 项 Skill` : '添加 Skill' }}</button>
              <div v-if="skillMenuOpen" class="skill-menu">
                <button v-for="skill in availableSkills" :key="skill.id" :class="{ active: selectedSkillIds.includes(skill.id) }" @click="chooseSkill(skill)"><strong>{{ skill.name }}</strong><small>{{ skill.description }}</small></button>
                <p v-if="!availableSkills.length">没有启用的 Skill，请到个人信息页配置。</p>
                <small v-if="selectedSkills.length" class="skill-selection-note">本轮：{{ selectedSkills.map(item => item.name).join('、') }}</small>
              </div>
            </div>
            <button class="tool-button" @click="fileInput?.click()"><PhPaperclip :size="15" /> 添加附件</button>
            <input ref="fileInput" class="file-input" type="file" multiple @change="selectAttachments" />
            <span v-if="attachedFiles.length" class="attachment-state">已添加 {{ attachedFiles.length }} 个附件</span>
            <span class="composer-hint">Enter 发送，Shift + Enter 换行</span>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.bubble-skills{margin:8px 0;padding:6px 9px;border-left:2px solid var(--secondary);color:var(--text-muted);font-size:11px;line-height:1.5}.bubble-skills span{color:#936000}
.chat-workspace{flex:1;min-height:0;display:grid;grid-template-columns:305px minmax(0,1fr);overflow:hidden}.conversation-column{min-height:0;display:flex;flex-direction:column;padding:25px 18px 19px;background:var(--surface-container-low);border-right:1px solid rgba(138,114,102,.18)}.history-heading{display:flex;align-items:flex-end;justify-content:space-between;padding:0 7px 11px}.history-heading small{color:var(--primary);font-size:10px;font-weight:800;letter-spacing:.15em}.history-heading h2{font:700 24px var(--font-display)}.history-heading button{width:34px;height:34px;border:1px solid var(--border);border-radius:50%;background:rgba(255,255,255,.45);color:var(--text-muted);font-size:16px;cursor:pointer}.history-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:0 4px 12px;padding:4px;border:1px solid var(--border-subtle);border-radius:12px;background:rgba(255,255,255,.35)}.history-tabs button{padding:7px;border:0;border-radius:8px;background:transparent;color:var(--text-muted);font-size:12px;font-weight:800;cursor:pointer}.history-tabs button.active{background:var(--surface);color:var(--primary);box-shadow:0 2px 8px rgba(68,48,38,.08)}.new-chat{width:100%;margin-bottom:18px;padding:13px;border:0;border-radius:999px;background:var(--primary);color:#fff;font-size:14px;font-weight:800;cursor:pointer;box-shadow:0 6px 16px rgba(151,68,0,.18)}.new-chat span{font-size:19px;margin-right:5px}.history-list{min-height:0;display:grid;gap:6px;overflow-y:auto;padding-right:3px}.history-list>button{width:100%;display:flex;align-items:center;gap:11px;padding:12px;border:1px solid transparent;border-radius:13px;background:transparent;color:var(--text);text-align:left;cursor:pointer;transition:.17s}.history-list>button:hover{background:rgba(255,255,255,.52)}.history-list>button.active{background:var(--secondary-container);border-color:rgba(73,104,0,.14);color:var(--on-secondary-container);transform:rotate(-.35deg);box-shadow:0 5px 11px rgba(73,104,0,.09)}.history-icon{width:31px;height:31px;flex:0 0 auto;display:grid;place-items:center;border:1px solid currentColor;border-radius:50%;font-size:15px}.history-copy{min-width:0;display:grid}.history-copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.history-copy small{color:var(--text-muted);font-size:10px;margin-top:3px}.history-list>button.active small{color:inherit;opacity:.75}.history-state{padding:30px 15px;color:var(--text-muted);font:14px/1.7 var(--font-display);text-align:center}.history-foot{margin-top:auto;padding:16px 8px 0;border-top:1px dashed rgba(138,114,102,.22);display:grid}.history-foot span{color:var(--secondary);font-size:12px;font-weight:800}.history-foot small{color:var(--text-muted);font-size:10px;margin-top:3px}
.conversation-main{min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;background:var(--bg)}.message-stream{position:relative;z-index:1;flex:1;min-height:0;overflow-y:auto;padding:42px clamp(24px,6vw,92px) 190px}.chat-welcome{max-width:850px;margin:5vh auto 0;text-align:center}.welcome-compass{width:70px;height:70px;margin:auto;display:grid;place-items:center;border:3px double var(--primary);border-radius:50%;color:var(--primary);font-size:29px;transform:rotate(-7deg)}.chat-welcome>small{display:block;margin-top:21px;color:var(--primary);font-size:9px;font-weight:900;letter-spacing:.2em}.chat-welcome h2{margin:7px 0 14px;color:var(--primary);font:800 clamp(34px,4.5vw,55px)/1.08 var(--font-display)}.chat-welcome>p{max-width:580px;margin:auto;color:var(--text-muted);font:15px/1.7 var(--font-display)}.suggestion-notes{display:grid;grid-template-columns:repeat(3,1fr);gap:17px;margin-top:34px}.suggestion-notes button{min-height:142px;padding:18px;border:1px solid rgba(138,114,102,.17);border-radius:5px 17px 6px 15px;background:rgba(255,255,255,.7);box-shadow:var(--shadow-paper);text-align:left;cursor:pointer;transition:.2s}.suggestion-notes button:nth-child(1){transform:rotate(-1deg)}.suggestion-notes button:nth-child(3){transform:rotate(1deg)}.suggestion-notes button:hover{transform:translateY(-4px) rotate(0)}.suggestion-notes span{display:inline-block;padding:3px 8px;background:var(--secondary-container);color:var(--on-secondary-container);border-radius:999px;font-size:9px;font-weight:800}.suggestion-notes p{margin-top:12px;color:var(--text);font:14px/1.55 var(--font-display)}
.chat-decor{position:absolute;z-index:0;inset:0;overflow:hidden;pointer-events:none;color:var(--primary);user-select:none}.decor-postmark{position:absolute;top:9%;right:5%;width:154px;height:154px;display:grid;place-items:center;align-content:center;border:3px double currentColor;border-radius:50%;opacity:.075;transform:rotate(13deg);text-align:center}.decor-postmark::before,.decor-postmark::after{content:'';position:absolute;left:-24px;right:-24px;border-top:2px solid currentColor}.decor-postmark::before{top:48px;box-shadow:0 8px currentColor}.decor-postmark::after{bottom:43px;box-shadow:0 -8px currentColor}.decor-postmark span{font-size:12px;font-weight:900;letter-spacing:.17em}.decor-postmark b{font:800 24px var(--font-display);letter-spacing:.08em}.decor-postmark small{font-size:8px;font-weight:800;letter-spacing:.12em}.decor-compass{position:absolute;left:3%;bottom:24%;width:128px;height:128px;border:2px solid currentColor;border-radius:50%;opacity:.055;transform:rotate(-18deg);text-align:center}.decor-compass::before,.decor-compass::after{content:'';position:absolute;left:50%;top:10px;bottom:10px;border-left:1px solid currentColor}.decor-compass::after{left:10px;right:10px;top:50%;bottom:auto;border:0;border-top:1px solid currentColor}.decor-compass b,.decor-compass small{position:absolute;left:0;right:0;font-size:11px}.decor-compass b{top:6px}.decor-compass small{bottom:6px}.decor-compass span{position:absolute;left:10px;right:10px;top:52px;font-size:10px}.decor-compass i{position:absolute;left:49px;top:25px;width:27px;height:77px;background:currentColor;clip-path:polygon(50% 0,70% 45%,50% 100%,30% 45%)}.decor-route{position:absolute;right:2%;bottom:20%;width:min(34vw,430px);opacity:.075;transform:rotate(-5deg)}.decor-route path{stroke:var(--secondary);stroke-width:3;stroke-dasharray:6 10;stroke-linecap:round}.decor-route circle{fill:var(--bg);stroke:var(--secondary);stroke-width:3}.decor-handwriting{position:absolute;font:700 29px var(--font-hand);opacity:.13}.decor-handwriting-a{left:5%;top:18%;transform:rotate(-5deg)}.decor-handwriting-b{right:13%;bottom:28%;color:var(--secondary);transform:rotate(3deg)}.decor-ticket{position:absolute;left:7%;bottom:7%;width:220px;padding:12px 18px;border:1px dashed currentColor;opacity:.065;transform:rotate(7deg);display:grid}.decor-ticket::before,.decor-ticket::after{content:'';position:absolute;top:50%;width:16px;height:16px;border-radius:50%;background:var(--bg)}.decor-ticket::before{left:-9px}.decor-ticket::after{right:-9px}.decor-ticket span{font-size:8px;font-weight:900;letter-spacing:.2em}.decor-ticket b{font:700 17px var(--font-display)}.decor-ticket small{font-size:7px;letter-spacing:.14em}
.user-note{width:min(620px,78%);margin:0 0 30px auto;padding:19px 24px;position:relative;border-radius:18px 5px 17px 7px;background:#e9e6de;border:1px solid rgba(138,114,102,.16);box-shadow:0 8px 17px rgba(86,67,56,.09);transform:rotate(.3deg)}.user-note::after{content:'';position:absolute;right:18px;bottom:-8px;width:26px;height:17px;background:#e9e6de;clip-path:polygon(0 0,100% 0,100% 100%)}.note-label{display:block;color:var(--text-muted);font-size:10px;font-weight:800;letter-spacing:.14em;margin-bottom:7px}.user-note p{color:var(--text-h);font:17px/1.65 var(--font-display)}.user-note i{position:absolute;right:11px;top:8px;color:rgba(138,114,102,.24);font-style:normal}.agent-reply{width:100%;margin-bottom:38px}.reply-note{width:min(720px,90%);padding:24px 29px 22px;position:relative;border:1px solid rgba(138,114,102,.17);border-radius:5px 18px 7px 15px;background:#fffdf4;box-shadow:0 11px 25px rgba(86,67,56,.11);transform:rotate(-.25deg)}.reply-note::before{content:'';position:absolute;top:-10px;left:85px;width:86px;height:23px;background:rgba(255,219,201,.58);transform:rotate(-2deg)}.push-pin{position:absolute;right:17px;top:12px;color:var(--primary);opacity:.32;font-size:22px}.reply-note small{color:var(--primary);font-size:10px;font-weight:900;letter-spacing:.18em}.reply-note h3{margin:6px 0 8px;color:var(--primary);font:700 25px var(--font-display)}.reply-note>p{color:var(--text);font:17px/1.65 var(--font-display)}.reply-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:15px}.reply-meta span{padding:5px 9px;border-radius:999px;background:var(--secondary-container);color:var(--on-secondary-container);font-size:11px;font-weight:700}.agent-reply.detailed{padding:0;border:1px solid rgba(138,114,102,.2);border-radius:8px 22px 10px 20px;background:rgba(255,253,244,.88);box-shadow:0 15px 36px rgba(86,67,56,.12);overflow:hidden}.agent-reply.detailed :deep(.result-view){width:100%;margin:0;padding:26px 30px 38px;overflow:visible}.agent-reply.detailed :deep(.hero){padding:0 0 27px;border:0;border-bottom:1px dashed rgba(138,114,102,.24);border-radius:0;background:transparent;box-shadow:none}.agent-reply.detailed :deep(.timeline .tl-card){background:rgba(255,255,255,.62)}.error-note{width:min(650px,90%);padding:19px 23px;margin-bottom:30px;border:1px solid rgba(147,0,10,.18);background:#ffdad6;color:#93000a;transform:rotate(-.3deg)}.error-note p{margin-top:4px}.stream-bottom{height:20px}
.assistant-message{width:min(760px,88%);display:flex;align-items:flex-start;gap:10px}.assistant-mark{width:31px;height:31px;flex:0 0 auto;display:grid;place-items:center;margin-top:3px;border:1px solid rgba(91,105,63,.34);border-radius:50%;background:#f1eddf;color:#596640;font-size:9px;font-weight:900}.assistant-bubble{position:relative;padding:15px 18px;border:1px solid rgba(103,83,69,.15);border-radius:5px 17px 17px 17px;background:rgba(255,253,247,.9);box-shadow:0 5px 15px rgba(72,54,42,.06);color:#51443b}.assistant-bubble::before{content:'';position:absolute;left:-7px;top:10px;width:12px;height:12px;border-left:1px solid rgba(103,83,69,.15);border-bottom:1px solid rgba(103,83,69,.15);background:#fffdf7;transform:rotate(45deg)}.assistant-bubble>strong{display:block;margin-bottom:5px;color:#342c27;font:700 15px var(--font-display)}.assistant-bubble>p{font:15px/1.75 var(--font-display)}.bubble-copy-list{margin-top:16px}.bubble-copy-style{display:grid;grid-template-columns:auto 1fr;gap:3px 9px;padding:10px 12px;margin-bottom:3px;border-left:3px solid var(--secondary);background:rgba(239,235,220,.62)}.bubble-copy-style span{color:var(--text-muted);font-size:11px;font-weight:750}.bubble-copy-style strong{color:#4c5a35;font:700 13px var(--font-display)}.bubble-copy-style p{grid-column:1/-1;color:#75665d;font:12px/1.55 var(--font-display)}.bubble-copy-variant{padding:15px 1px 5px;border-top:1px dashed rgba(103,83,69,.2)}.bubble-copy-variant header{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:7px}.bubble-copy-variant header b{color:#4c5a35;font:700 13px var(--font-display)}.bubble-copy-variant header button{padding:3px 8px;border:0;border-radius:999px;background:transparent;color:var(--primary);font-size:10px;font-weight:800;cursor:pointer}.bubble-copy-variant header button:hover{background:var(--primary-fixed)}.bubble-copy-variant p{white-space:pre-wrap;color:#51443b;font:15px/1.8 var(--font-display)}.bubble-copy-variant small{display:block;margin-top:8px;color:#657248;font-size:12px;line-height:1.65}.bubble-section{margin-top:13px}.bubble-section b{color:#4c5a35;font-size:12px}.bubble-section ul{display:grid;gap:4px;margin-top:5px;padding-left:18px;color:#65564d;font-size:13px;line-height:1.6}.bubble-sources{display:flex;flex-wrap:wrap;gap:5px 9px;margin-top:12px;color:#88766b;font-size:10px}.bubble-sources a{color:#596640;text-decoration:underline;text-underline-offset:2px}.error-note{width:min(650px,90%);padding:19px 23px;margin-bottom:30px;border:1px solid rgba(147,0,10,.18);background:#ffdad6;color:#93000a;transform:rotate(-.3deg)}.error-note p{margin-top:4px}.stream-bottom{height:20px}
.composer-dock{position:absolute;z-index:20;left:0;right:0;bottom:0;padding:18px clamp(22px,6vw,86px) 14px;background:rgba(252,249,240,.94);border-top:1px solid rgba(138,114,102,.14);box-shadow:0 -18px 35px rgba(86,67,56,.08);backdrop-filter:blur(15px)}.torn-edge{position:absolute;left:0;right:0;top:-9px;height:10px;background:linear-gradient(135deg,transparent 6px,var(--bg) 0) 0 0/13px 13px repeat-x}.composer-box{max-width:980px;margin:auto;padding:8px 10px;border:1px solid rgba(138,114,102,.23);border-radius:24px 8px 24px 8px;background:rgba(255,255,255,.82);box-shadow:0 10px 27px rgba(86,67,56,.12);transition:.24s ease}.composer-box.expanded{padding:12px;border-color:rgba(151,68,0,.36);box-shadow:0 16px 38px rgba(86,67,56,.16)}.composer-main{display:flex;align-items:flex-end;gap:11px}.composer-box textarea{flex:1;min-width:0;height:42px;max-height:150px;padding:9px 3px;border:0;outline:0;resize:none;background:transparent;color:var(--text-h);font:16px/1.55 var(--font-display);transition:height .24s ease}.composer-box.expanded textarea{height:86px}.composer-box textarea::placeholder{color:rgba(86,67,56,.44)}.voice,.send{flex:0 0 auto;border:0;border-radius:50%;cursor:pointer}.voice{width:42px;height:42px;border:1px dashed rgba(151,68,0,.35);background:transparent;color:var(--primary);font-size:19px}.voice.listening{background:#ffdad6;color:#93000a;animation:pulse-dot 1s infinite}.send{width:44px;height:44px;background:var(--primary);color:#fff;font-size:17px;box-shadow:0 6px 14px rgba(151,68,0,.22)}.send:disabled{opacity:.35;cursor:not-allowed}.composer-tools{display:none;align-items:center;gap:8px;padding:10px 53px 0;border-top:1px dashed transparent}.composer-box.expanded .composer-tools{display:flex;border-top-color:rgba(138,114,102,.16)}.tool-button{padding:6px 11px;border:1px solid rgba(138,114,102,.24);border-radius:999px;background:rgba(252,249,240,.8);color:var(--text);font-size:11px;font-weight:750;cursor:pointer}.tool-button.active{border-color:var(--secondary);background:var(--secondary-container);color:var(--on-secondary-container)}.skill-picker{position:relative}.skill-menu{position:absolute;z-index:5;left:0;bottom:38px;width:290px;max-height:310px;overflow-y:auto;display:grid;gap:3px;padding:7px;border:1px solid var(--border);border-radius:12px;background:var(--surface);box-shadow:var(--shadow)}.skill-menu button{display:grid;gap:2px;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:var(--text);text-align:left;cursor:pointer}.skill-menu button strong{font-size:12px}.skill-menu button small{color:var(--text-muted);font-size:10px;line-height:1.45}.skill-menu button:hover,.skill-menu button.active{background:var(--surface-container)}.skill-menu>p{padding:12px;color:var(--text-muted);font-size:11px;line-height:1.6}.file-input{display:none}.attachment-state{color:var(--secondary);font-size:11px;font-weight:700}.composer-hint{margin-left:auto;color:var(--text-muted);font-size:10px}
@media(max-width:800px){.chat-workspace{grid-template-columns:1fr}.conversation-column{display:none}.message-stream{padding:27px 15px 210px}.suggestion-notes{grid-template-columns:1fr;gap:10px}.suggestion-notes button{min-height:auto}.chat-welcome{margin-top:20px}.composer-dock{padding-left:13px;padding-right:13px}.composer-tools{padding-left:0;padding-right:0;flex-wrap:wrap}.composer-hint{display:none}.skill-menu{width:min(290px,78vw)}.user-note{width:88%}.reply-note{width:96%}.assistant-message{width:96%}.agent-reply.detailed :deep(.result-view){padding:20px 15px 30px}.decor-postmark{right:-55px}.decor-compass{left:-62px}.decor-route{width:70vw}.decor-ticket{display:none}.decor-handwriting{font-size:22px}}

/* A compact explanation is shown only when the model needed a factual retry. */
.copy-diagnostic{margin:0 0 10px;padding:8px 10px;border-left:3px solid var(--secondary);background:rgba(239,235,220,.62);color:var(--text-muted);font-size:12px;line-height:1.5}
/* Taste Skill redesign layer: one accent, one radius system, readable metadata. */
.chat-workspace{grid-template-columns:300px minmax(0,1fr)}
.conversation-column{border-color:var(--border-subtle)}
.history-heading small{font-size:12px;letter-spacing:0}
.history-heading h2{font-size:25px}
.history-heading button{width:36px;height:36px;display:grid;place-items:center;background:rgba(255,255,255,.58)}
.new-chat{display:flex;align-items:center;justify-content:center;gap:7px;box-shadow:0 7px 18px rgba(155,63,33,.18)}
.history-list>button{border-radius:var(--radius-control);transition:var(--transition)}
.history-list>button.active{background:var(--secondary-container);border-color:var(--accent-border);color:var(--on-secondary-container);transform:none;box-shadow:0 5px 13px rgba(68,48,38,.07)}
.history-copy strong{font-size:14px}.history-copy small,.history-foot small{font-size:12px}
.history-foot span{color:var(--primary);font-size:13px}
.chat-welcome{max-width:900px;margin:5vh auto 0;text-align:left}
.welcome-compass{width:68px;height:68px;margin:0}
.chat-welcome>small{margin-top:20px;font-size:12px;letter-spacing:0}
.chat-welcome h2{max-width:720px;font-size:clamp(34px,4.5vw,54px);text-wrap:balance}
.chat-welcome>p{max-width:620px;margin:0;font-size:16px}
.suggestion-notes{grid-template-columns:1.45fr 1fr;grid-template-rows:repeat(2,minmax(96px,auto));gap:14px;margin-top:30px}
.suggestion-notes button{min-height:0;padding:19px 20px;border-color:var(--border-subtle);border-radius:var(--radius);transition:var(--transition);transform:none!important}
.suggestion-notes button:first-child{grid-row:1 / span 2;padding:25px}
.suggestion-notes button:first-child{background:linear-gradient(145deg,rgba(239,222,212,.72),rgba(255,255,255,.78))}.suggestion-notes button:nth-child(3){background:rgba(238,233,225,.78)}
.suggestion-notes button:hover{transform:translateY(-3px)!important;border-color:var(--accent-border)}
.suggestion-notes span{padding:0;border-radius:0;background:transparent;color:var(--primary);font-size:12px}
.suggestion-notes p{font-size:15px;text-wrap:pretty}.suggestion-notes button:first-child p{max-width:38ch;font-size:17px}
.suggestion-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:28px;color:var(--text-muted);font-size:12px}.suggestion-toolbar button{display:flex;align-items:center;gap:5px;padding:6px 10px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.6);color:var(--primary);font-size:12px;font-weight:800;cursor:pointer}.suggestion-toolbar button:disabled{opacity:.45;cursor:wait}.suggestion-notes{margin-top:10px}.suggestion-notes small{display:block;margin-top:10px;color:var(--text-muted);font-size:11px;line-height:1.45}
.user-note{border-radius:var(--radius);background:#e9e4dc;border-color:var(--border-subtle);box-shadow:0 8px 17px rgba(68,48,38,.08);transform:none}
.user-note::after{background:#e9e4dc}.note-label{font-size:12px;letter-spacing:0}.user-note>svg{position:absolute;right:12px;top:10px;color:rgba(91,68,56,.28)}
.agent-reply.detailed{border-color:var(--border);border-radius:var(--radius);background:rgba(255,253,248,.9);box-shadow:0 15px 36px rgba(68,48,38,.11)}
.assistant-mark{border-color:var(--accent-border);background:var(--primary-fixed);color:var(--primary);font-size:10px}
.assistant-bubble{padding:16px 19px;border-color:var(--border-subtle);border-radius:4px var(--radius) var(--radius) var(--radius);background:rgba(255,253,247,.93);box-shadow:0 5px 15px rgba(68,48,38,.06)}
.bubble-copy-variant header button{font-size:12px}.bubble-section b{font-size:13px}.bubble-section ul{font-size:14px}.bubble-sources{font-size:12px}
.composer-box{border-color:var(--border);border-radius:var(--radius);box-shadow:0 10px 27px rgba(68,48,38,.11);transition:var(--transition)}
.composer-box.expanded{border-color:var(--accent-border);box-shadow:0 16px 38px rgba(68,48,38,.14)}
.voice,.send{display:grid;place-items:center}.voice{border-style:solid;border-color:var(--border)}.send{box-shadow:0 6px 14px rgba(155,63,33,.2)}
.tool-button{display:flex;align-items:center;gap:6px;font-size:12px}.attachment-state,.composer-hint{font-size:12px}.attachment-state{color:var(--primary)}
.decor-handwriting-a{display:none}

@media(max-width:800px){
  .chat-workspace{grid-template-columns:minmax(0,1fr)}
  .suggestion-notes{grid-template-columns:1fr;grid-template-rows:auto}
  .suggestion-notes button:first-child{grid-row:auto;padding:19px}
  .suggestion-notes button:first-child p{font-size:15px}
  .chat-welcome{text-align:left}
  .decor-handwriting{display:none}
}
</style>
