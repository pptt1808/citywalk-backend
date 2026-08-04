import fs from "node:fs/promises";
import path from "node:path";
import { plannerService } from "../src/services/plannerService";
import { PlanRequest, TraceStep } from "../src/types/plan";

interface AgentCase {
  id: string;
  name: string;
  input: PlanRequest;
  expect?: {
    expectedTools?: string[];
    expectedMaxSteps?: number;
  };
}

function toolCalls(steps: TraceStep[]): string[] {
  return steps
    .filter((step) => step.type === "tool_call")
    .map((step) => step.tool)
    .filter((tool): tool is string => Boolean(tool));
}

function finalAnswer(steps: TraceStep[]): string {
  return [...steps].reverse().find((step) => step.type === "final_answer")?.content ?? "";
}

function checkCase(testCase: AgentCase, steps: TraceStep[]) {
  const tools = toolCalls(steps);
  const missingTools = (testCase.expect?.expectedTools ?? []).filter((tool) => {
    // No map key or missing geocode falls back from nearby search to city-wide search.
    if (tool === "search_poi_nearby") return !tools.includes("search_poi_nearby") && !tools.includes("search_poi");
    return !tools.includes(tool);
  });
  const tooManySteps =
    typeof testCase.expect?.expectedMaxSteps === "number" && steps.length > testCase.expect.expectedMaxSteps;

  return {
    passed: missingTools.length === 0,
    missingTools,
    tooManySteps
  };
}

async function main() {
  const casesPath = path.resolve("test-cases", "citywalk-agent-cases.json");
  const allCases = JSON.parse(await fs.readFile(casesPath, "utf8")) as AgentCase[];
  const caseId = getArgValue("--case");
  const limit = Number(getArgValue("--limit") ?? allCases.length);
  const cases = allCases
    .filter((testCase) => !caseId || testCase.id === caseId)
    .slice(0, Number.isFinite(limit) ? limit : allCases.length);

  console.log(`Running ${cases.length} CityWalk Agent cases...\n`);

  let passed = 0;
  for (const testCase of cases) {
    const startedAt = Date.now();
    try {
      const { trace } = await plannerService.createTrace(testCase.input);
      const result = checkCase(testCase, trace.steps);
      const tools = toolCalls(trace.steps);
      const answer = finalAnswer(trace.steps);
      const elapsed = Date.now() - startedAt;

      if (result.passed) {
        passed += 1;
      }

      console.log(`${result.passed ? "PASS" : "FAIL"} ${testCase.id} - ${testCase.name}`);
      console.log(`  model: ${trace.metadata?.model ?? "unknown"}`);
      console.log(`  steps: ${trace.steps.length}, tools: ${tools.join(" -> ") || "none"}, elapsed: ${elapsed}ms`);
      if (result.missingTools.length > 0) {
        console.log(`  missing tools: ${result.missingTools.join(", ")}`);
      }
      if (result.tooManySteps) {
        console.log(`  warning: steps ${trace.steps.length} > expected ${testCase.expect?.expectedMaxSteps}`);
      }
      console.log(`  final: ${answer.slice(0, 140)}${answer.length > 140 ? "..." : ""}\n`);
    } catch (error) {
      console.log(`ERROR ${testCase.id} - ${testCase.name}`);
      console.log(`  ${(error as Error).message}\n`);
    }
  }

  console.log(`Summary: ${passed}/${cases.length} passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function getArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
