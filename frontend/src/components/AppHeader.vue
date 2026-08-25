<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue'
import {
  PhArrowLeft, PhBooks, PhCaretDown, PhCaretRight, PhMapPinLine,
  PhMapTrifold, PhSignOut, PhSlidersHorizontal, PhUserCircle,
} from '@phosphor-icons/vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { useAuth } from '../composables/useAuth'
import type { JournalController } from '../composables/useJournal'
import type { WorkspacePage, NavigateWorkspace } from '../workspace'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const auth = inject<ReturnType<typeof useAuth>>('auth')!
const journal = inject<JournalController>('journal')!
const activePage = inject<Ref<WorkspacePage>>('activePage')!
const navigate = inject<NavigateWorkspace>('navigate')!
const menuOpen = ref(false)

const initials = computed(() => (auth.user.value?.username ?? 'W').slice(0, 2).toUpperCase())
const pageTitle = computed(() => ({ chat: '对话手账', profile: '旅行者档案', preferences: '个人偏好', scrapbook: '手账书架', walk: '手机路线接力' })[activePage.value])

function go(page: WorkspacePage) {
  navigate(page)
  menuOpen.value = false
}

async function logout() {
  menuOpen.value = false
  await auth.logout()
  agent.reset()
}
</script>

<template>
  <header class="app-header">
    <button class="header-brand" @click="go('chat')"><span><PhMapTrifold :size="20" weight="duotone" /></span><strong>CityWalk Agent</strong></button>
    <div class="header-page"><span>/</span>{{ pageTitle }}</div>
    <div class="header-spacer" />
    <button v-if="activePage !== 'chat'" class="back-chat" @click="go('chat')"><PhArrowLeft :size="15" /> 返回对话</button>
    <span class="service-dot" :class="{ online: agent.backendOnline.value }"><i/>{{ agent.backendOnline.value ? '在线' : '连接中' }}</span>
    <div class="profile-menu-wrap">
      <button class="profile-trigger" :class="{ active: menuOpen }" @click="menuOpen = !menuOpen">
        <span>{{ initials }}</span><strong>{{ auth.user.value?.username }}</strong><PhCaretDown :size="14" />
      </button>
      <Transition name="menu">
        <div v-if="menuOpen" class="profile-menu">
          <div class="menu-passport"><span>{{ initials }}</span><div><small>CITYWALK PASSPORT</small><strong>{{ auth.user.value?.username }}</strong><p>{{ journal.entries.value.length }} 本手账 · {{ journal.activeWalk.value ? '正在漫步' : '等待下一次出发' }}</p></div></div>
          <button @click="go('profile')"><PhUserCircle class="menu-icon" :size="21" /><div><strong>个人资料</strong><small>旅行者档案与收藏概览</small></div><PhCaretRight :size="14" /></button>
          <button @click="go('preferences')"><PhSlidersHorizontal class="menu-icon" :size="21" /><div><strong>个人偏好与 Agent 设置</strong><small>记忆、节奏和默认规划方式</small></div><PhCaretRight :size="14" /></button>
          <button @click="go('scrapbook')"><PhBooks class="menu-icon" :size="21" /><div><strong>手账书架</strong><small>编辑、排版与翻阅</small></div><PhCaretRight :size="14" /></button>
          <button @click="go('walk')"><PhMapPinLine class="menu-icon" :size="21" /><div><strong>手机路线接力</strong><small>发送路线并查看漫步状态</small></div><PhCaretRight :size="14" /></button>
          <button class="logout" @click="logout"><PhSignOut :size="16" /> 退出当前账号</button>
        </div>
      </Transition>
    </div>
  </header>
</template>

<style scoped>
.app-header{height:70px;flex:0 0 70px;display:flex;align-items:center;gap:14px;padding:0 25px;background:rgba(247,244,237,.94);border-bottom:1px solid var(--border-subtle);position:relative;z-index:80;backdrop-filter:blur(15px)}.header-brand{display:flex;align-items:center;gap:9px;border:0;background:transparent;color:var(--primary);cursor:pointer}.header-brand span{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--primary);border-radius:var(--radius-sm);transform:rotate(-2deg)}.header-brand strong{font:800 20px var(--font-display)}.header-page{display:flex;gap:12px;color:var(--text-muted);font-size:13px}.header-page span{opacity:.35}.header-spacer{flex:1}.back-chat{display:flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.55);color:var(--text);font-size:13px;font-weight:700;cursor:pointer}.service-dot{display:flex;align-items:center;gap:6px;color:var(--text-muted);font-size:12px}.service-dot i{width:7px;height:7px;border-radius:50%;background:#a79991}.service-dot.online i{background:#56704d}.profile-menu-wrap{position:relative}.profile-trigger{display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.64);color:var(--text);cursor:pointer}.profile-trigger>span{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:var(--primary);color:#fff;font:800 12px var(--font-display)}.profile-trigger strong{max-width:140px;overflow:hidden;text-overflow:ellipsis;font-size:13px}.profile-trigger.active{border-color:var(--primary);box-shadow:0 0 0 3px var(--accent-dim)}
.profile-menu{position:absolute;right:0;top:52px;width:340px;padding:13px;border:1px solid var(--border);border-radius:var(--radius);background:rgba(247,244,237,.98);box-shadow:0 22px 50px rgba(49,31,18,.2);backdrop-filter:blur(18px)}.profile-menu::before{content:'';position:absolute;top:-8px;right:52px;width:70px;height:18px;background:rgba(155,63,33,.13);transform:rotate(2deg)}.menu-passport{display:flex;align-items:center;gap:12px;padding:11px 10px 15px;border-bottom:1px dashed var(--border);margin-bottom:6px}.menu-passport>span{width:50px;height:50px;display:grid;place-items:center;border-radius:50%;border:3px double var(--primary);color:var(--primary);font:800 13px var(--font-display);transform:rotate(-5deg)}.menu-passport div{display:grid}.menu-passport small{color:var(--primary);font-size:11px;font-weight:800;letter-spacing:.08em}.menu-passport strong{font:700 17px var(--font-display)}.menu-passport p{color:var(--text-muted);font-size:12px}.profile-menu>button:not(.logout){width:100%;display:grid;grid-template-columns:33px 1fr auto;align-items:center;gap:10px;padding:11px;border:0;border-radius:var(--radius-control);background:transparent;color:var(--text);text-align:left;cursor:pointer}.profile-menu>button:not(.logout):hover{background:var(--surface-container)}.menu-icon{color:var(--primary);justify-self:center}.profile-menu>button>div{display:grid}.profile-menu>button strong{font-size:13px}.profile-menu>button small{color:var(--text-muted);font-size:12px}.profile-menu>button>svg:last-child{color:var(--text-muted)}.logout{width:100%;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:6px;padding:10px;border:0;border-radius:999px;background:rgba(147,0,10,.08);color:#8b332c;font-size:12px;font-weight:800;cursor:pointer}.menu-enter-active,.menu-leave-active{transition:var(--transition)}.menu-enter-from,.menu-leave-to{opacity:0;transform:translateY(-7px) scale(.97)}
@media(max-width:650px){.app-header{height:60px;flex-basis:60px;padding:0 13px}.header-brand strong{font-size:15px}.header-page,.service-dot,.back-chat,.profile-trigger strong{display:none}.profile-menu{position:fixed;top:66px;right:10px;left:10px;width:auto}}
</style>
