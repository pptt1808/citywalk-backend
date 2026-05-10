import { UrbanPulseAgent } from "../agents/urbanPulseAgent";
import { MapTool } from "../tools/mapTool";
import { WeatherTool } from "../tools/weatherTool";
import { historyStore } from "./historyStore";
import { AgentTrace, PlanningResult, PlanRequest, StateEvent } from "../types/plan";

class PlannerService {
  private readonly agent = new UrbanPulseAgent(new MapTool(), new WeatherTool());

  async createPlan(input: PlanRequest): Promise<PlanningResult> {
    const result = await this.agent.plan(input);
    historyStore.save(input, result);
    return result;
  }

  async createTrace(input: PlanRequest): Promise<{ trace: AgentTrace }> {
    const result = await this.agent.plan(input);
    if (!result.trace) {
      throw new Error("Agent did not produce an evaluation trace");
    }
    return { trace: result.trace };
  }

  async streamPlanWithStateEvents(input: PlanRequest, onDelta: (events: StateEvent[]) => void): Promise<PlanningResult> {
    const result = await this.agent.planWithStateEventStream(input, onDelta);
    historyStore.save(input, result);
    return result;
  }
}

export const plannerService = new PlannerService();
