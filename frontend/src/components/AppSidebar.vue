<script setup lang="ts">
import { computed, inject, type Ref } from 'vue'
import type { useAgentPlan } from '../composables/useAgentPlan'
import type { useAuth } from '../composables/useAuth'
import type { JournalController } from '../composables/useJournal'
import type { NavigateWorkspace, WorkspacePage } from '../workspace'

const agent = inject<ReturnType<typeof useAgentPlan>>('agent')!
const auth = inject<ReturnType<typeof useAuth>>('auth')!
const journal = inject<JournalController>('journal')!
const activePage = inject<Ref<WorkspacePage>>('activePage')!
const navigate = inject<NavigateWorkspace>('navigate')!

const initials = computed(() => (auth.user.value?.username ?? 'W').slice(0, 2).toUpperCase())
const journeyCount = computed(() => journal.entries.value.length)

const navItems: Array<{ page: WorkspacePage; label: string; icon: string }> = [
  { page: 'chat', label: '漫游 Agent', icon: '✦' },
  { page: 'scrapbook', label: '手账书架', icon: '▤' },
  { page: 'walk', label: '随身记录', icon: '⌁' },
  { page: 'profile', label: '旅行者档案', icon: '◌' },
]

function newWalk() {
  agent.newConversation()
  navigate('chat')
}

function openPage(page: WorkspacePage) {
  if (page === 'walk' && !journal.activeWalk.value && agent.result.value?.responseKind === 'route') {
    journal.startWalk(agent.result.value)
  }
  navigate(page)
}

async function logout() {
  await auth.logout()
  agent.reset()
}
</script>

<template>
  <aside class="app-sidebar">
    <button class="side-brand" @click="openPage('chat')" aria-label="返回 Agent">
      <span class="brand-map">⌑</span>
      <span>CityWalk</span>
    </button>

    <button class="traveler-card" @click="openPage('profile')">
      <span class="avatar-stamp">{{ initials }}</span>
      <span class="traveler-copy">
        <strong>{{ auth.user.value?.username }}</strong>
        <small>{{ journeyCount }} 段旅程已收藏</small>
      </span>
      <span class="traveler-arrow">›</span>
    </button>

    <button class="new-walk" @click="newWalk"><span>＋</span> 发起新漫游</button>

    <nav class="side-nav" aria-label="主导航">
      <button
        v-for="item in navItems"
        :key="item.page"
        :class="{ active: activePage === item.page, live: item.page === 'walk' && journal.activeWalk.value }"
        @click="openPage(item.page)"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        <span>{{ item.label }}</span>
        <i v-if="item.page === 'walk' && journal.activeWalk.value" />
      </button>
    </nav>

    <div class="side-bottom">
      <div class="api-state">
        <span :class="agent.backendOnline.value ? 'online' : 'offline'" />
        {{ agent.backendOnline.value === null ? '正在连接服务' : agent.backendOnline.value ? 'Agent 服务在线' : 'Agent 服务离线' }}
      </div>
      <button class="sign-out" @click="logout">↪ 退出登录</button>
    </div>
  </aside>
</template>

<style scoped>
.app-sidebar {
  width: 244px; flex: 0 0 244px; min-height: 0; padding: 26px 20px 22px;
  display: flex; flex-direction: column; background: rgba(246,243,234,.92);
  border-right: 1px solid rgba(138,114,102,.18); position: relative; z-index: 20;
}
.side-brand { display: flex; align-items: center; gap: 10px; border: 0; background: transparent; color: var(--primary); font: 800 25px var(--font-display); cursor: pointer; margin: 0 8px 28px; }
.brand-map { width: 32px; height: 32px; display: grid; place-items: center; border: 1px solid var(--primary); border-radius: 9px; font-size: 20px; transform: rotate(-2deg); }
.traveler-card { width: 100%; display: flex; align-items: center; gap: 11px; padding: 13px; border-radius: 18px; border: 1px solid rgba(138,114,102,.2); background: rgba(255,255,255,.72); color: var(--text-h); text-align: left; cursor: pointer; box-shadow: var(--shadow-paper); transform: rotate(-.4deg); }
.avatar-stamp { width: 43px; height: 43px; border-radius: 50%; display: grid; place-items: center; color: #fff; background: linear-gradient(145deg, var(--primary), #d27a37); border: 3px solid #fff; box-shadow: 0 0 0 1px var(--primary); font: 700 13px var(--font-display); }
.traveler-copy { min-width: 0; display: flex; flex: 1; flex-direction: column; }
.traveler-copy strong { overflow: hidden; text-overflow: ellipsis; color: var(--text-h); font-size: 14px; }
.traveler-copy small { color: var(--text-muted); font-size: 10px; margin-top: 2px; }
.traveler-arrow { color: var(--outline); font-size: 22px; }
.new-walk { margin: 24px 0 30px; width: 100%; border: 0; border-radius: 999px; padding: 13px 16px; background: var(--primary); color: white; font: 700 14px var(--font-sans); box-shadow: 0 7px 18px rgba(151,68,0,.2); cursor: pointer; transition: .2s ease; }
.new-walk:hover { transform: translateY(-2px) rotate(-.3deg); background: var(--primary-hover); }
.new-walk span { font-size: 20px; vertical-align: -1px; margin-right: 5px; }
.side-nav { display: grid; gap: 7px; }
.side-nav button { min-height: 48px; display: flex; align-items: center; gap: 13px; padding: 0 16px; border: 1px solid transparent; border-radius: 14px; background: transparent; color: var(--text); font: 600 14px var(--font-sans); cursor: pointer; text-align: left; transition: .18s ease; }
.side-nav button:hover { background: var(--surface-container); color: var(--text-h); transform: translateX(2px); }
.side-nav button.active { background: var(--secondary-container); color: var(--on-secondary-container); border-color: rgba(73,104,0,.14); box-shadow: 0 5px 12px rgba(73,104,0,.11); transform: rotate(-.5deg); }
.side-nav button i { width: 7px; height: 7px; margin-left: auto; border-radius: 50%; background: #5e8100; box-shadow: 0 0 0 4px rgba(73,104,0,.12); animation: pulse-dot 1.4s infinite; }
.nav-icon { width: 23px; font: 700 20px var(--font-display); text-align: center; }
.side-bottom { margin-top: auto; padding-top: 20px; border-top: 1px solid rgba(138,114,102,.15); display: grid; gap: 12px; }
.api-state { display: flex; align-items: center; gap: 8px; padding: 0 8px; color: var(--text-muted); font-size: 11px; }
.api-state span { width: 7px; height: 7px; border-radius: 50%; }
.api-state .online { background: #648900; box-shadow: 0 0 7px #648900; }
.api-state .offline { background: #ba1a1a; }
.sign-out { padding: 9px 8px; border: 0; background: transparent; color: #9a3412; text-align: left; cursor: pointer; font: 600 12px var(--font-sans); }

@media (max-width: 760px) {
  .app-sidebar { position: fixed; bottom: 0; left: 0; right: 0; width: 100%; height: 70px; min-height: 70px; padding: 8px 14px; flex-direction: row; align-items: center; border-right: 0; border-top: 1px solid rgba(138,114,102,.2); backdrop-filter: blur(18px); }
  .side-brand, .traveler-card, .new-walk, .side-bottom { display: none; }
  .side-nav { width: 100%; display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
  .side-nav button { min-height: 52px; padding: 4px; flex-direction: column; justify-content: center; gap: 1px; font-size: 10px; border-radius: 12px; }
  .side-nav button.active { transform: none; }
  .nav-icon { height: 23px; font-size: 18px; }
  .side-nav button i { position: absolute; margin: -33px 0 0 27px; }
}
</style>
