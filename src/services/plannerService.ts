import { UrbanPulseAgent } from "../agents/urbanPulseAgent";
import { MapTool } from "../tools/mapTool";
import { WeatherTool } from "../tools/weatherTool";
import { PlanningResult, UserConstraints } from "../types/plan";

class PlannerService {
  private readonly agent = new UrbanPulseAgent(new MapTool(), new WeatherTool());

  async createPlan(input: UserConstraints): Promise<PlanningResult> {
    return this.agent.plan(input);
  }
}

export const plannerService = new PlannerService();
