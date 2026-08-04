<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import ChatWorkspace from './components/ChatWorkspace.vue'
import AuthPanel from './components/AuthPanel.vue'
import ProfilePage from './components/ProfilePage.vue'
import ScrapbookPage from './components/ScrapbookPage.vue'
import WalkRecorder from './components/WalkRecorder.vue'
import PreferencesPage from './components/PreferencesPage.vue'
import { useAgentPlan } from './composables/useAgentPlan'
import { useAuth } from './composables/useAuth'
import { useJournal } from './composables/useJournal'
import { useSkills } from './composables/useSkills'
import type { WorkspacePage } from './workspace'

const agent = useAgentPlan()
const auth = useAuth()
const journal = useJournal(computed(() => auth.user.value?.id))
const skills = useSkills(computed(() => auth.user.value?.id))
const validPages: WorkspacePage[] = ['chat', 'profile', 'preferences', 'scrapbook', 'walk']
const hashPage = window.location.hash.replace(/^#\/?/, '') as WorkspacePage
const activePage = ref<WorkspacePage>(validPages.includes(hashPage) ? hashPage : 'chat')

function navigate(page: WorkspacePage) {
  activePage.value = page
  window.history.replaceState(null, '', `#/${page}`)
}

provide('agent', agent)
provide('auth', auth)
provide('journal', journal)
provide('skills', skills)
provide('activePage', activePage)
provide('navigate', navigate)

watch(() => auth.user.value?.id, userId => {
  if (userId) void agent.checkHealth()
  else navigate('chat')
})

onMounted(async () => {
  await auth.checkMe()
  if (auth.user.value) void agent.checkHealth()
})
</script>

<template>
  <a class="skip-link" href="#workspace-main">跳到主要内容</a>
  <div v-if="auth.loading.value" class="auth-loading"><span>CW</span><p>正在翻开 CityWalk 手账...</p></div>
  <AuthPanel v-else-if="!auth.user.value" />
  <div v-else id="workspace-main" class="app-shell">
    <section class="shell-main">
      <AppHeader />
      <ChatWorkspace v-if="activePage === 'chat'" />
      <ProfilePage v-else-if="activePage === 'profile'" />
      <PreferencesPage v-else-if="activePage === 'preferences'" />
      <ScrapbookPage v-else-if="activePage === 'scrapbook'" />
      <WalkRecorder v-else />
    </section>
  </div>
</template>

<style scoped>
.app-shell { height: 100dvh; min-height: 100dvh; display: flex; overflow: hidden; background: var(--bg); }
.shell-main { min-width: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.auth-loading { min-height: 100dvh; display: grid; place-items: center; align-content: center; gap: 12px; color: var(--text-muted); background: var(--bg); }
.auth-loading span { width: 56px; height: 56px; display: grid; place-items: center; border: 2px double var(--primary); border-radius: 50%; color: var(--primary); font-size: 25px; animation: spin 3s linear infinite; }
.auth-loading p { font: 600 13px var(--font-display); }

</style>
