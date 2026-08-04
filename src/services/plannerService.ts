import { UrbanPulseAgent } from "../agents/urbanPulseAgent";
import { MapTool } from "../tools/mapTool";
import { WeatherTool } from "../tools/weatherTool";
import { historyStore } from "./historyStore";
import { memoryService } from "./memoryService";
import { AgentTrace, PlanningResult, PlanRequest, StateEvent } from "../types/plan";
import { throwIfAborted } from "../utils/httpClient";

class PlannerService {
  private readonly agent = new UrbanPulseAgent(new MapTool(), new WeatherTool());

  async createPlan(input: PlanRequest, signal?: AbortSignal): Promise<PlanningResult> {
    const result = await this.agent.plan(input, signal);
    await this.learnSafely(input, result, signal);
    throwIfAborted(signal);
    if (input.userId) historyStore.save(input, result);
    return result;
  }

  async createTrace(input: PlanRequest, signal?: AbortSignal): Promise<{ trace: AgentTrace }> {
    const result = await this.agent.plan(input, signal);
    if (!result.trace) {
      throw new Error("Agent did not produce an evaluation trace");
    }
    return { trace: result.trace };
  }

  async streamPlanWithStateEvents(input: PlanRequest, onDelta: (events: StateEvent[]) => void, signal?: AbortSignal): Promise<PlanningResult> {
    const result = await this.agent.planWithStateEventStream(input, onDelta, signal);
    await this.learnSafely(input, result, signal);
    throwIfAborted(signal);
    if (input.userId) historyStore.save(input, result);
    return result;
  }

  private async learnSafely(input: PlanRequest, result: PlanningResult, signal?: AbortSignal): Promise<void> {
    try {
      const learned = await memoryService.learnFromPlanning(input, result, signal);
      if (input.userId) {
        result.memory = {
          recalled: result.memory?.recalled ?? [],
          learned: learned.events.map((decision) => ({
            event: decision.event,
            key: decision.candidate?.key,
            text: decision.candidate?.text,
            reason: decision.reason
          }))
        };
      }
    } catch (error) {
      // Memory extraction has its own request timeout. It must not turn an
      // otherwise valid route into a failed stream.
      if (signal?.aborted) throw error;
      console.warn(`[MemoryService] learning failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const plannerService = new PlannerService();
