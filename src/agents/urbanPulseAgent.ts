import { CityWalkGraphRunner } from "../graph/citywalkGraph";
import { PlanningResult, PlanRequest, StateEvent, UserConstraints } from "../types/plan";
import { MapTool } from "../tools/mapTool";
import { WeatherTool } from "../tools/weatherTool";

export class UrbanPulseAgent {
  private readonly graphRunner: CityWalkGraphRunner;

  constructor(
    private readonly mapTool: MapTool,
    private readonly weatherTool: WeatherTool
  ) {
    this.graphRunner = new CityWalkGraphRunner(this.mapTool, this.weatherTool);
  }

  async plan(input: UserConstraints | PlanRequest): Promise<PlanningResult> {
    return this.graphRunner.run(input);
  }

  async planWithStateEventStream(input: PlanRequest, onDelta: (events: StateEvent[]) => void): Promise<PlanningResult> {
    return this.graphRunner.streamStateEvents(input, onDelta);
  }
}
