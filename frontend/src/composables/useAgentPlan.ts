import { ref, computed, onScopeDispose } from 'vue'
import {
  apiCreatePlanStream,
  apiHealth,
  type PlanRequest,
  type PlanningResult,
  type StateEvent,
  type AgentPlanStep,
} from '../api/agent'
import { startNewMemoryThread } from '../utils/identity'

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
  let activeController: AbortController | undefined
  let generation = 0

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
    activeController?.abort()
    const runGeneration = ++generation
    const controller = new AbortController()
    activeController = controller
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
          if (runGeneration !== generation) return
          if (status.value === 'loading') status.value = 'streaming'
          visibleEvents.value.push(...events)
        },
        onResult(data) {
          if (runGeneration !== generation) return
          result.value = data
          rawJson.value = JSON.stringify(data, null, 2)
          visibleSteps.value = data.planSteps ?? []
          status.value = 'done'
        },
        onError(msg) {
          if (runGeneration !== generation) return
          error.value = msg
          status.value = 'error'
        }
      }, controller.signal)
    } catch (e) {
      if (runGeneration !== generation) return
      error.value = (e as Error).message
      status.value = 'error'
    } finally {
      if (activeController === controller) activeController = undefined
    }
  }

  function reset() {
    generation += 1
    activeController?.abort()
    activeController = undefined
    status.value = 'idle'
    result.value = null
    visibleEvents.value = []
    visibleSteps.value = []
    error.value = null
    rawJson.value = ''
    lastRequest.value = null
  }

  function loadResult(data: PlanningResult, request?: PlanRequest) {
    generation += 1
    activeController?.abort()
    activeController = undefined
    result.value = data
    visibleEvents.value = data.events ?? []
    visibleSteps.value = data.planSteps ?? []
    rawJson.value = JSON.stringify(data, null, 2)
    lastRequest.value = request ?? null
    error.value = null
    status.value = 'done'
  }

  function newConversation() {
    reset()
    startNewMemoryThread()
  }

  function cancel() {
    generation += 1
    activeController?.abort()
    activeController = undefined
    if (isRunning.value) status.value = 'idle'
  }

  onScopeDispose(cancel)

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
    loadResult,
    newConversation,
    cancel,
    checkHealth,
  }
}
