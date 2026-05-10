import { ref, computed } from 'vue'
import {
  apiCreatePlanStream,
  apiHealth,
  type PlanRequest,
  type PlanningResult,
  type StateEvent,
  type AgentPlanStep,
} from '../api/agent'

export type RunStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error'

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
      await apiCreatePlanStream(req, {
        onEvents(events) {
          if (status.value === 'loading') status.value = 'streaming'
          visibleEvents.value.push(...events)
        },
        onResult(data) {
          result.value = data
          rawJson.value = JSON.stringify(data, null, 2)
          visibleSteps.value = data.planSteps ?? []
          status.value = 'done'
        },
        onError(msg) {
          error.value = msg
          status.value = 'error'
        }
      })
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
