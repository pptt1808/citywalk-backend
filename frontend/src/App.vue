<script setup lang="ts">
import { provide, ref, onMounted } from 'vue'
import AppHeader from './components/AppHeader.vue'
import PlanInput from './components/PlanInput.vue'
import AgentConsole from './components/AgentConsole.vue'
import { useAgentPlan } from './composables/useAgentPlan'

const agent = useAgentPlan()
const showDebugJson = ref(false)

// Provide shared state to all children via injection
provide('agent', agent)
provide('showDebugJson', showDebugJson)

onMounted(() => {
  agent.checkHealth()
})
</script>

<template>
  <AppHeader />
  <div class="workspace">
    <PlanInput />
    <AgentConsole />
  </div>
</template>

<style scoped>
.workspace {
  flex: 1;
  display: grid;
  grid-template-columns: 320px 1fr;
  overflow: hidden;
}

@media (max-width: 768px) {
  .workspace {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    overflow-y: auto;
  }
}
</style>
