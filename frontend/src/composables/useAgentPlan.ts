import { ref, computed } from 'vue'
import {
  apiCreatePlan,
  apiHealth,
  type PlanRequest,
  type PlanningResult,
  type StateEvent,
  type AgentPlanStep,
} from '../api/agent'

export type RunStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

// Delay between each event card animation (ms) — longer = more visible
const EVENT_REVEAL_DELAY = 360
// Extra pause after last event before switching to result view
const POST_STREAM_PAUSE = 900

export function useAgentPlan() {
  const status = ref<RunStatus>('idle')
  const result = ref<PlanningResult | null>(null)
  const visibleEvents = ref<StateEvent[]>([])
  const visibleSteps = ref<AgentPlanStep[]>([])
  const error = ref<string | null>(null)
  const backendOnline = ref<boolean | null>(null)
  const lastRequest = ref<PlanRequest | null>(null)
  const rawJson = ref<string>('')

  const isRunning = computed(() => status.value === 'loading' || status.value === 'streaming')
  const isDone = computed(() => status.value === 'done')
  const isError = computed(() => status.value === 'error')

  async function checkHealth() {
    try {
      await apiHealth()
      backendOnline.value = true
    } catch {
      backendOnline.value = false
    }
  }

  async function run(req: PlanRequest) {
    status.value = 'loading'
    visibleEvents.value = []
    visibleSteps.value = []
    result.value = null
    error.value = null
    lastRequest.value = req
    rawJson.value = ''

    try {
      const data = await apiCreatePlan(req)
      result.value = data
      rawJson.value = JSON.stringify(data, null, 2)

      // Immediately show plan steps (they're already status=done from backend)
      visibleSteps.value = data.planSteps ?? []

      // Progressively reveal events — one by one so the user can read each step
      const events = data.events ?? []
      status.value = 'streaming'
      for (const ev of events) {
        await new Promise<void>(r => setTimeout(r, EVENT_REVEAL_DELAY))
        visibleEvents.value.push(ev)
      }
      // Linger on the last event so the user sees it before the result view appears
      await new Promise<void>(r => setTimeout(r, POST_STREAM_PAUSE))
      status.value = 'done'
    } catch (e) {
      error.value = (e as Error).message
      status.value = 'error'
    }
  }

  function reset() {
    status.value = 'idle'
    result.value = null
    visibleEvents.value = []
    visibleSteps.value = []
    error.value = null
    rawJson.value = ''
  }

  return {
    status,
    result,
    visibleEvents,
    visibleSteps,
    error,
    backendOnline,
    isRunning,
    isDone,
    isError,
    rawJson,
    lastRequest,
    run,
    reset,
    checkHealth,
  }
}
