<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { PhArrowRight, PhBooks, PhCompass, PhPath, PhPlus, PhSparkle } from '@phosphor-icons/vue'
import { apiListFavoriteRoutes, apiListMemories, type FavoriteRoute, type MemoryItem, type PlanningResult } from '../api/agent'
import type { useAuth } from '../composables/useAuth'
import type { JournalController, ScrapbookEntry } from '../composables/useJournal'
import type { SkillController, SkillDraft, UserSkill } from '../composables/useSkills'
import type { NavigateWorkspace } from '../workspace'
import { getMemoryUserId } from '../utils/identity'

const auth = inject<ReturnType<typeof useAuth>>('auth')!
const journal = inject<JournalController>('journal')!
const skills = inject<SkillController>('skills')!
const navigate = inject<NavigateWorkspace>('navigate')!
const favorites = ref<FavoriteRoute[]>([])
const memories = ref<MemoryItem[]>([])
const loading = ref(true)
const skillEditorOpen = ref(false)
const editingSkillId = ref<string | null>(null)
const skillFormError = ref('')
const skillDraft = ref<SkillDraft>({ name: '', description: '', instruction: '', enabled: true })

const displayName = computed(() => auth.user.value?.username ?? 'Urban Explorer')
const initials = computed(() => displayName.value.slice(0, 2).toUpperCase())
const cities = computed(() => new Set([
  ...favorites.value.map(item => item.result.routeOverview?.city).filter(Boolean),
  ...journal.entries.value.map(item => item.city).filter(Boolean)
]).size)
const tags = computed(() => {
  const preferred = memories.value.filter(item => item.kind === 'semantic' || item.kind === 'procedural')
    .map(item => item.text.replace(/[。；]/g, '').slice(0, 12)).slice(0, 4)
  return preferred.length ? preferred : ['随性漫步', '街巷故事', '在地生活']
})
const enabledSkillCount = computed(() => skills.skills.value.filter(skill => skill.enabled).length)

function newSkill() {
  editingSkillId.value = null
  skillDraft.value = { name: '', description: '', instruction: '', enabled: true }
  skillFormError.value = ''
  skillEditorOpen.value = true
}

function editSkill(skill: UserSkill) {
  editingSkillId.value = skill.id
  skillDraft.value = {
    name: skill.name,
    description: skill.description,
    instruction: skill.instruction,
    enabled: skill.enabled,
  }
  skillFormError.value = ''
  skillEditorOpen.value = true
}

function cancelSkillEdit() {
  skillEditorOpen.value = false
  editingSkillId.value = null
  skillFormError.value = ''
}

function saveSkill() {
  const draft = skillDraft.value
  if (!draft.name.trim()) {
    skillFormError.value = '请先给 Skill 起一个容易识别的名字。'
    return
  }
  if (!draft.instruction.trim()) {
    skillFormError.value = '执行指令不能为空，Agent 需要知道这项能力具体要怎么做。'
    return
  }
  if (editingSkillId.value) skills.updateSkill(editingSkillId.value, draft)
  else skills.createSkill(draft)
  cancelSkillEdit()
}

function deleteSkill(skill: UserSkill) {
  if (!window.confirm(`确定删除 Skill「${skill.name}」吗？删除后无法恢复。`)) return
  skills.removeSkill(skill.id)
  if (editingSkillId.value === skill.id) cancelSkillEdit()
}

function startWalk(route: PlanningResult) {
  journal.startWalk(route)
  navigate('walk')
}

function editEntry(entry?: ScrapbookEntry) {
  if (!entry) journal.createEntry()
  navigate('scrapbook')
}

async function loadProfile() {
  const userId = getMemoryUserId()
  if (!userId) { loading.value = false; return }
  const [favoriteResult, memoryResult] = await Promise.allSettled([
    apiListFavoriteRoutes(userId), apiListMemories(userId)
  ])
  if (favoriteResult.status === 'fulfilled') favorites.value = favoriteResult.value.entries
  if (memoryResult.status === 'fulfilled') memories.value = memoryResult.value.entries
  loading.value = false
}

onMounted(loadProfile)
</script>

<template>
  <main class="profile-page paper-canvas">
    <section class="profile-hero">
      <div class="avatar-wrap"><span>{{ initials }}</span><i><PhCompass :size="18" weight="duotone" /></i></div>
      <div class="profile-title">
        <span class="passport-label">CITYWALK PASSPORT · NO. {{ auth.user.value?.id.slice(-5).toUpperCase() }}</span>
        <h2>{{ displayName }}</h2>
        <p>“收集脚步，也收集每条街巷不经意的好故事。”</p>
        <div class="vibe-tags"><span v-for="tag in tags" :key="tag">#{{ tag }}</span></div>
      </div>
      <div class="profile-stats">
        <div><strong>{{ cities }}</strong><small>走过城市</small></div>
        <div><strong>{{ favorites.length }}</strong><small>收藏路线</small></div>
        <div><strong>{{ journal.entries.value.length }}</strong><small>手账篇章</small></div>
      </div>
    </section>

    <section class="profile-section skills-section">
      <header class="section-heading">
        <div><span class="heading-icon"><PhSparkle :size="27" weight="duotone" /></span><div><small>MY AGENT SKILLS</small><h3>Agent Skill 编辑</h3></div></div>
        <div class="skill-heading-actions"><span>{{ enabledSkillCount }} 项已启用</span><button class="primary-small" @click="newSkill"><PhPlus :size="16" weight="bold" /> 新建 Skill</button></div>
      </header>
      <p class="skill-intro">这里的指令会在你从对话输入框选择 Skill 时随本轮需求一起交给 Agent。名字用于选择，执行指令决定它具体如何工作。</p>

      <div class="skill-layout" :class="{ editing: skillEditorOpen }">
        <div class="skill-list">
          <article v-for="skill in skills.skills.value" :key="skill.id" class="skill-item" :class="{ disabled: !skill.enabled, selected: editingSkillId === skill.id }">
            <button class="skill-switch" role="switch" :aria-checked="skill.enabled" :aria-label="`${skill.enabled ? '停用' : '启用'} ${skill.name}`" @click="skills.toggleSkill(skill.id)"><i /></button>
            <div class="skill-copy"><div><strong>{{ skill.name }}</strong><span>{{ skill.enabled ? '已启用' : '已停用' }}</span></div><p>{{ skill.description || '还没有填写简短说明。' }}</p><small>{{ skill.instruction }}</small></div>
            <div class="skill-actions"><button @click="editSkill(skill)">编辑</button><button class="danger" @click="deleteSkill(skill)">删除</button></div>
          </article>
          <div v-if="!skills.skills.value.length" class="empty-skill"><strong>还没有自定义能力</strong><p>新建一个 Skill，把你经常提出的规划要求保存下来。</p><button @click="newSkill">创建第一个 Skill</button></div>
        </div>

        <aside v-if="skillEditorOpen" class="skill-editor">
          <header><div><small>{{ editingSkillId ? 'EDIT SKILL' : 'NEW SKILL' }}</small><h4>{{ editingSkillId ? '编辑能力' : '创建能力' }}</h4></div><button title="关闭" @click="cancelSkillEdit">×</button></header>
          <label><span>Skill 名称</span><input v-model="skillDraft.name" maxlength="24" placeholder="例如：雨天博物馆路线" /></label>
          <label><span>简短说明</span><input v-model="skillDraft.description" maxlength="80" placeholder="说明它适合什么场景" /></label>
          <label><span>执行指令</span><textarea v-model="skillDraft.instruction" rows="7" maxlength="800" placeholder="明确告诉 Agent 应关注什么、遵循哪些规则、最终输出什么。可以自由描述，不受枚举限制。" /></label>
          <label class="editor-enabled"><button class="skill-switch" role="switch" :aria-checked="skillDraft.enabled" @click="skillDraft.enabled = !skillDraft.enabled"><i /></button><span>保存后立即启用</span></label>
          <p v-if="skillFormError" class="skill-form-error">{{ skillFormError }}</p>
          <footer><button class="cancel" @click="cancelSkillEdit">取消</button><button class="save" @click="saveSkill">保存 Skill</button></footer>
        </aside>
      </div>
    </section>

    <section class="profile-section">
      <header class="section-heading">
        <div><span class="heading-icon"><PhBooks :size="27" weight="duotone" /></span><div><small>MY TRAVEL SCRAPBOOK</small><h3>手账书架</h3></div></div>
        <button class="primary-small" @click="editEntry()"><PhPlus :size="16" weight="bold" /> 创建新手账</button>
      </header>

      <div v-if="journal.entries.value.length" class="scrap-grid">
        <article v-for="(entry, index) in journal.entries.value" :key="entry.id" class="journal-book" :class="`book-tone-${index % 3}`" @click="editEntry(entry)">
          <div class="book-object">
            <span class="book-spine" />
            <div class="book-cover">
              <small>CITYWALK JOURNAL · {{ String(index + 1).padStart(2, '0') }}</small>
              <span class="cover-seal"><PhCompass :size="25" weight="duotone" /></span>
              <h4>{{ entry.title || 'BLANK JOURNAL' }}</h4>
              <p>{{ entry.city || 'URBAN WANDERER' }}</p>
              <div class="cover-route"><i/><i/><i/><span/></div>
              <b>{{ new Date(entry.createdAt).getFullYear() }}</b>
            </div>
            <span class="book-pages" />
          </div>
          <footer><strong>{{ entry.title || '空白手账' }}</strong><span>{{ entry.photos.length ? `${entry.photos.length} 张照片` : '空白手账' }} · 点击打开</span></footer>
        </article>
      </div>
      <div v-else class="empty-book" @click="editEntry()">
        <span>＋</span><strong>这里不再是照片墙</strong><p>选择一条路线或几个喜欢的地点，上传照片和文字，让 AI 帮你排成第一篇手绘手账。</p>
      </div>
    </section>

    <section class="profile-section routes-section">
      <header class="section-heading">
        <div><span class="heading-icon"><PhPath :size="27" weight="duotone" /></span><div><small>SAVED ROUTES</small><h3>准备出发的路线</h3></div></div>
        <span class="loading-note" v-if="loading">正在翻找收藏…</span>
      </header>
      <div v-if="favorites.length" class="route-shelf">
        <article v-for="favorite in favorites" :key="favorite.id" class="saved-route">
          <div class="route-line"><i v-for="stop in favorite.result.stops.slice(0, 6)" :key="stop.name" /><span /></div>
          <div class="saved-main"><small>{{ favorite.result.routeOverview?.city || '城市漫游' }}</small><h4>{{ favorite.result.title }}</h4><p>{{ favorite.result.stops.map(stop => stop.name).join(' → ') }}</p></div>
          <div class="route-meta"><span>{{ favorite.result.totalEstimatedMinutes }} 分钟</span><span>¥{{ favorite.result.totalEstimatedCost }}</span></div>
          <div class="route-actions"><button class="go" @click="startWalk(favorite.result)">进入随身记录 <PhArrowRight :size="15" /></button></div>
        </article>
      </div>
      <div v-else-if="!loading" class="empty-route">还没有收藏路线。先去和 Agent 聊聊，把喜欢的路线收藏到这里。</div>
    </section>
  </main>
</template>

<style scoped>
.profile-page { flex: 1; min-height: 0; overflow-y: auto; padding: 42px clamp(24px, 5vw, 70px) 90px; }
.profile-hero { display: grid; grid-template-columns: auto minmax(280px, 1fr) auto; align-items: center; gap: 28px; max-width: 1180px; margin: 0 auto 48px; }
.avatar-wrap { width: 138px; height: 138px; border-radius: 50%; padding: 7px; background: #fff; border: 1px solid rgba(138,114,102,.25); box-shadow: 0 9px 24px rgba(86,67,56,.15); position: relative; transform: rotate(-2deg); }
.avatar-wrap > span { width: 100%; height: 100%; display: grid; place-items: center; border-radius: 50%; color: #fff; background: radial-gradient(circle at 30% 20%, #c37a42, #6f2f00); font: 800 34px var(--font-display); }
.avatar-wrap i { position: absolute; right: 2px; bottom: 11px; width: 37px; height: 37px; display: grid; place-items: center; border-radius: 50%; background: var(--primary); color: #fff; border: 3px solid #fff; font-style: normal; }
.passport-label { color: var(--primary); font-size: 9px; font-weight: 800; letter-spacing: .17em; }
.profile-title h2 { margin: 5px 0 7px; color: var(--primary); font: 800 clamp(38px, 5vw, 62px)/1 var(--font-display); letter-spacing: -.045em; }
.profile-title p { max-width: 650px; color: var(--text); font: italic 18px/1.55 var(--font-display); }
.vibe-tags { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 18px; }
.vibe-tags span { padding: 5px 13px; border-radius: 999px 4px 999px 4px; border: 1px solid rgba(73,104,0,.18); background: rgba(200,241,122,.48); color: #405900; font-size: 11px; transform: rotate(-.7deg); }
.vibe-tags span:nth-child(even) { background: var(--tertiary-fixed); border-color: rgba(138,77,14,.16); color: #6e3900; transform: rotate(.7deg); }
.profile-stats { display: flex; padding: 17px 22px; border-radius: 18px; background: rgba(255,255,255,.58); border: 1px solid rgba(138,114,102,.16); box-shadow: var(--shadow-paper); }
.profile-stats div { min-width: 82px; display: grid; text-align: center; }
.profile-stats div + div { border-left: 1px dashed rgba(138,114,102,.24); }
.profile-stats strong { color: var(--primary); font: 800 25px var(--font-display); }
.profile-stats small { color: var(--text-muted); font-size: 10px; }
.profile-section { max-width: 1180px; margin: 0 auto 52px; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 26px; padding-bottom: 16px; border-bottom: 1px dashed rgba(138,114,102,.26); }
.section-heading > div { display: flex; align-items: center; gap: 13px; }
.heading-icon { color: var(--primary); font: 700 27px var(--font-display); }
.section-heading small { color: var(--text-muted); font-size: 9px; font-weight: 800; letter-spacing: .16em; }
.section-heading h3 { color: #8a3d00; font: 700 25px var(--font-display); }
.primary-small { padding: 10px 17px; border: 0; border-radius: 999px; background: var(--primary); color: white; font-weight: 700; cursor: pointer; }
.skill-heading-actions{display:flex;align-items:center;gap:12px}.skill-heading-actions>span{color:var(--secondary);font-size:12px;font-weight:800}.skill-intro{max-width:780px;margin:-12px 0 22px;color:var(--text-muted);font-size:13px;line-height:1.75}.skill-layout{display:grid;gap:20px}.skill-layout.editing{grid-template-columns:minmax(0,1fr) 390px;align-items:start}.skill-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.skill-layout.editing .skill-list{grid-template-columns:1fr}.skill-item{min-width:0;display:grid;grid-template-columns:38px minmax(0,1fr) auto;align-items:start;gap:12px;padding:17px;border:1px solid rgba(138,114,102,.18);border-radius:5px 17px 8px 15px;background:rgba(255,255,255,.64);box-shadow:0 5px 15px rgba(86,67,56,.06);transition:.18s}.skill-item:hover,.skill-item.selected{border-color:rgba(151,68,0,.3);box-shadow:0 8px 20px rgba(86,67,56,.1)}.skill-item.disabled{opacity:.58;background:rgba(241,238,229,.6)}.skill-switch{width:36px;height:21px;padding:2px;border:0;border-radius:999px;background:#c8c2b8;cursor:pointer;transition:.18s}.skill-switch i{display:block;width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.2);transition:.18s}.skill-switch[aria-checked="true"]{background:var(--secondary)}.skill-switch[aria-checked="true"] i{transform:translateX(15px)}.skill-copy{min-width:0}.skill-copy>div{display:flex;align-items:center;gap:8px}.skill-copy strong{color:var(--text-h);font:700 16px var(--font-display)}.skill-copy>div span{padding:2px 6px;border-radius:999px;background:rgba(200,241,122,.48);color:var(--on-secondary-container);font-size:9px;font-weight:800}.skill-item.disabled .skill-copy>div span{background:var(--surface-container-high);color:var(--text-muted)}.skill-copy p{margin-top:4px;color:var(--text);font-size:12px;line-height:1.55}.skill-copy small{display:-webkit-box;margin-top:7px;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:var(--text-muted);font-size:11px;line-height:1.55}.skill-actions{display:grid;gap:4px}.skill-actions button{padding:4px 7px;border:0;background:transparent;color:var(--primary);font-size:10px;font-weight:800;cursor:pointer}.skill-actions button:hover{text-decoration:underline}.skill-actions .danger{color:#93000a}.empty-skill{grid-column:1/-1;padding:28px;border:1px dashed rgba(138,114,102,.3);border-radius:18px;text-align:center;background:rgba(255,255,255,.35)}.empty-skill strong{color:var(--text-h);font:700 18px var(--font-display)}.empty-skill p{margin:5px 0 14px;color:var(--text-muted);font-size:12px}.empty-skill button{padding:8px 14px;border:0;border-radius:999px;background:var(--primary);color:#fff;font-size:11px;font-weight:800;cursor:pointer}.skill-editor{position:sticky;top:8px;padding:22px;border:1px solid rgba(138,114,102,.22);border-radius:7px 22px 9px 18px;background:#fffdf7;box-shadow:0 14px 32px rgba(86,67,56,.13)}.skill-editor::before{content:'';position:absolute;top:-8px;left:70px;width:76px;height:18px;background:rgba(200,241,122,.45);transform:rotate(-2deg)}.skill-editor>header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:18px}.skill-editor>header small{color:var(--primary);font-size:9px;font-weight:900;letter-spacing:.18em}.skill-editor>header h4{font-size:22px;color:var(--primary)}.skill-editor>header>button{width:30px;height:30px;border:0;border-radius:50%;background:var(--surface-container);color:var(--text);font-size:20px;cursor:pointer}.skill-editor>label:not(.editor-enabled){display:grid;gap:6px;margin-top:13px}.skill-editor>label>span{color:var(--text-h);font-size:11px;font-weight:800}.skill-editor input,.skill-editor textarea{width:100%;padding:10px 12px;border:1px solid rgba(138,114,102,.24);border-radius:9px;background:rgba(252,249,240,.72);color:var(--text-h);font-size:13px;outline:0}.skill-editor textarea{resize:vertical;line-height:1.65}.skill-editor input:focus,.skill-editor textarea:focus{border-color:rgba(151,68,0,.48);background:#fff}.editor-enabled{display:flex;align-items:center;gap:10px;margin-top:15px}.editor-enabled>span{font-size:12px!important}.skill-form-error{margin-top:12px;color:#93000a;font-size:11px}.skill-editor>footer{display:flex;justify-content:flex-end;gap:8px;margin-top:20px;padding-top:15px;border-top:1px dashed rgba(138,114,102,.22)}.skill-editor>footer button{padding:8px 14px;border-radius:999px;font-size:11px;font-weight:800;cursor:pointer}.skill-editor .cancel{border:1px solid var(--border);background:transparent;color:var(--text)}.skill-editor .save{border:1px solid var(--primary);background:var(--primary);color:#fff}
.scrap-grid { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:34px;align-items:start;perspective:1200px }
.journal-book{min-width:0;cursor:pointer}.book-object{height:270px;position:relative;transform-style:preserve-3d;transition:.35s ease;filter:drop-shadow(12px 15px 14px rgba(86,67,56,.2))}.journal-book:hover .book-object{transform:translateY(-9px) rotateY(-9deg) rotateX(2deg)}.book-cover{position:absolute;inset:0 8px 9px 9px;padding:24px 20px;border:1px solid rgba(50,25,10,.26);border-radius:4px 13px 11px 4px;background:#a94e0a;color:#fff;overflow:hidden;box-shadow:inset 8px 0 14px rgba(45,19,0,.18),inset -1px 0 rgba(255,255,255,.2)}.book-tone-1 .book-cover{background:#587600}.book-tone-2 .book-cover{background:#8a4d0e}.book-cover::after{content:'';position:absolute;inset:7px;border:1px solid rgba(255,255,255,.28);border-radius:2px 9px 8px 2px;pointer-events:none}.book-cover small{font-size:7px;font-weight:800;letter-spacing:.17em;opacity:.72}.cover-seal{width:52px;height:52px;margin:26px auto 14px;display:grid;place-items:center;border:3px double rgba(255,255,255,.56);border-radius:50%;font-size:22px;transform:rotate(-8deg)}.book-cover h4{color:#fff;text-align:center;font:700 19px/1.2 var(--font-display)}.book-cover p{text-align:center;font:13px var(--font-hand);opacity:.78;margin-top:5px}.book-cover>b{position:absolute;left:0;right:0;bottom:18px;text-align:center;font-size:8px;letter-spacing:.2em;opacity:.55}.book-spine{position:absolute;z-index:4;left:0;top:2px;bottom:11px;width:15px;border-radius:4px 0 0 4px;background:rgba(76,30,0,.42);box-shadow:inset -2px 0 rgba(255,255,255,.14)}.book-pages{position:absolute;z-index:-1;left:12px;right:0;bottom:0;height:17px;border-radius:0 0 10px 3px;background:repeating-linear-gradient(#fffdf6 0 2px,#ded9cb 2px 3px);transform:skewX(-15deg)}.cover-route{position:absolute;left:26px;right:26px;bottom:47px;height:24px}.cover-route span{position:absolute;left:6px;right:6px;top:10px;border-top:1px dashed rgba(255,255,255,.5)}.cover-route i{position:absolute;z-index:1;top:7px;width:7px;height:7px;border-radius:50%;background:#fff}.cover-route i:nth-child(1){left:3px}.cover-route i:nth-child(2){left:48%}.cover-route i:nth-child(3){right:3px}.journal-book>footer{display:grid;gap:2px;margin-top:12px;text-align:center}.journal-book>footer strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-h);font:700 13px var(--font-display)}.journal-book>footer span{color:var(--text-muted);font-size:9px}
.empty-book { min-height: 235px; display: grid; place-items: center; align-content: center; gap: 9px; padding: 30px; border: 2px dashed rgba(138,114,102,.25); border-radius: 24px 8px 24px 8px; background: rgba(255,255,255,.35); text-align: center; cursor: pointer; }
.empty-book span { width: 52px; height: 52px; display: grid; place-items: center; border-radius: 50%; background: var(--secondary-container); color: var(--on-secondary-container); font-size: 25px; }
.empty-book strong { color: var(--text-h); font: 700 20px var(--font-display); }
.empty-book p { max-width: 500px; color: var(--text-muted); }
.loading-note { color: var(--text-muted); font: italic 12px var(--font-display); }
.route-shelf { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 18px; }
.saved-route { display: grid; grid-template-columns: 42px 1fr auto; gap: 14px; padding: 20px; border: 1px solid rgba(138,114,102,.18); border-radius: 18px; background: rgba(255,255,255,.6); box-shadow: var(--shadow-paper); }
.route-line { display: flex; flex-direction: column; align-items: center; position: relative; gap: 6px; padding-top: 4px; }
.route-line i { width: 9px; height: 9px; border-radius: 50%; background: var(--secondary); z-index: 1; border: 2px solid #fff; box-shadow: 0 0 0 1px var(--secondary); }
.route-line span { position: absolute; top: 8px; bottom: 8px; width: 2px; border-left: 2px dashed rgba(73,104,0,.35); }
.saved-main { min-width: 0; }
.saved-main small { color: var(--primary); font-size: 9px; font-weight: 800; letter-spacing: .1em; }
.saved-main h4 { color: var(--text-h); font: 700 17px var(--font-display); margin: 3px 0 7px; }
.saved-main p { color: var(--text-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.route-meta { display: flex; gap: 6px; align-self: start; }
.route-meta span { padding: 5px 8px; border-radius: 999px; background: var(--surface-container); color: var(--text-muted); font-size: 10px; white-space: nowrap; }
.route-actions { grid-column: 2 / -1; display: flex; justify-content: flex-end; gap: 8px; }
.route-actions button { padding: 7px 11px; border: 1px solid rgba(138,114,102,.2); border-radius: 999px; background: transparent; color: var(--text); font-weight: 700; font-size: 11px; cursor: pointer; }
.route-actions .go { background: var(--primary); border-color: var(--primary); color: #fff; }
.empty-route { padding: 24px; color: var(--text-muted); border-radius: 16px; background: rgba(255,255,255,.4); text-align: center; }

/* Readability pass: passport labels and supporting copy must remain legible. */
.passport-label{font-size:11px}.profile-stats small{font-size:12px}.section-heading small{font-size:11px}.vibe-tags span{font-size:12px}.book-cover small{font-size:9px}.book-cover>b{font-size:10px}.journal-book>footer strong{font-size:15px}.journal-book>footer span{font-size:11px}.saved-main small{font-size:11px}.saved-main p{font-size:12px}.route-meta span{font-size:11px}.route-actions button{font-size:12px}.loading-note{font-size:13px}

@media (max-width: 1050px) { .profile-hero { grid-template-columns: auto 1fr; }.profile-stats { grid-column: 1 / -1; justify-content: center; }.skill-layout.editing{grid-template-columns:1fr}.skill-editor{position:relative;top:auto;grid-row:1}.scrap-grid { grid-template-columns: repeat(2,1fr); }.route-shelf { grid-template-columns: 1fr; } }
@media (max-width: 760px) { .skill-list{grid-template-columns:1fr} }
@media (max-width: 650px) { .profile-page { padding: 28px 18px 110px; }.profile-hero { grid-template-columns: 1fr; text-align: center; }.avatar-wrap { margin: auto; width: 110px; height: 110px; }.vibe-tags { justify-content: center; }.profile-stats { width: 100%; padding: 12px 5px; }.profile-stats div { min-width: 0; flex: 1; }.scrap-grid { grid-template-columns: 1fr; }.section-heading { align-items: flex-end; }.section-heading h3 { font-size: 20px; }.skill-heading-actions{display:grid;justify-items:end}.skill-heading-actions>span{font-size:10px}.skill-item{grid-template-columns:36px minmax(0,1fr)}.skill-actions{grid-column:2;display:flex}.primary-small { font-size: 10px; padding: 8px 10px; }.saved-route { grid-template-columns: 32px 1fr; }.route-meta { grid-column: 2; }.route-actions { grid-column: 2; } }

/* Taste Skill redesign layer: quieter profile surface and larger working text. */
.profile-title h2{font-size:clamp(36px,4.2vw,52px);color:var(--primary)}
.profile-title p{font-size:17px;text-wrap:pretty}.passport-label{letter-spacing:.08em}
.vibe-tags span,.vibe-tags span:nth-child(even){padding:5px 11px;border-radius:999px;border-color:var(--accent-border);background:var(--primary-fixed);color:var(--primary);font-size:12px;transform:none}
.profile-stats{border-radius:var(--radius);box-shadow:none}.profile-stats small{font-size:12px}
.section-heading{border-color:var(--border)}.section-heading small{display:none}.section-heading h3{color:var(--primary);font-size:26px}.heading-icon{display:grid}
.primary-small{display:flex;align-items:center;justify-content:center;gap:6px;font-size:13px}
.skill-heading-actions>span{color:var(--primary);font-size:13px}.skill-intro{font-size:14px}
.skill-item{border-color:var(--border-subtle);border-radius:var(--radius);background:rgba(255,255,255,.68);box-shadow:none;transition:var(--transition)}
.skill-item:hover,.skill-item.selected{border-color:var(--accent-border);box-shadow:0 8px 20px rgba(68,48,38,.08)}
.skill-copy>div span{background:var(--primary-fixed);color:var(--primary);font-size:11px}.skill-copy p{font-size:13px}.skill-copy small{font-size:12px}.skill-actions button{font-size:12px}
.empty-skill{border-radius:var(--radius)}.empty-skill p,.empty-skill button{font-size:13px}
.skill-editor{border-color:var(--border);border-radius:var(--radius);box-shadow:var(--shadow)}.skill-editor::before{background:rgba(155,63,33,.13)}
.skill-editor>header small{font-size:11px;letter-spacing:.05em}.skill-editor>label>span{font-size:13px}.skill-editor input,.skill-editor textarea{border-radius:var(--radius-sm);font-size:14px}.skill-editor>footer button{font-size:12px}
.book-cover{background:var(--primary)}.book-tone-1 .book-cover{background:#745043}.book-tone-2 .book-cover{background:#813b31}
.empty-book{border-radius:var(--radius)}
.saved-route{border-color:var(--border-subtle);border-radius:var(--radius);box-shadow:none}.saved-main small{font-size:12px}.saved-main p{font-size:13px}.route-meta span{font-size:12px}.route-actions .go{display:flex;align-items:center;gap:6px;font-size:13px}

@media(max-width:650px){.primary-small{font-size:12px}.skill-heading-actions>span{font-size:12px}}
</style>
