import { UrbanPulseAgent } from "../agents/urbanPulseAgent";
import { MapTool } from "../tools/mapTool";
import { WeatherTool } from "../tools/weatherTool";
import { AgentTrace, PlanningResult, PlanRequest } from "../types/plan";

class PlannerService {
  private readonly agent = new UrbanPulseAgent(new MapTool(), new WeatherTool());

  async createPlan(input: PlanRequest): Promise<PlanningResult> {
    return this.agent.plan(input);
  }

  async createTrace(input: PlanRequest): Promise<{ trace: AgentTrace }> {
    const result = await this.agent.plan(input);
    if (!result.trace) {
      throw new Error("Agent did not produce an evaluation trace");
    }
    return { trace: result.trace };
  }
}

export const plannerService = new PlannerService();
