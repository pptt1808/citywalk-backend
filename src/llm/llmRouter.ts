import { env } from "../config/env";
import { AgentPlanStep, PlanRequest, UserConstraints } from "../types/plan";

type ChatRole = "system" | "user" | "assistant";

interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface LlmModelConfig {
  provider: "deepseek-v4-flash" | "deepseek-v4-pro";
  apiKey?: string;
  baseUrl: string;
  model: string;
  thinking: boolean;
}

interface LlmJsonResult<T> {
  provider: string;
  model: string;
  data: T;
}

export class LlmRouter {
  private readonly primary: LlmModelConfig = {
    provider: "deepseek-v4-flash",
    apiKey: env.DEEPSEEK_FLASH_API_KEY,
    baseUrl: env.DEEPSEEK_FLASH_BASE_URL,
    model: env.DEEPSEEK_FLASH_MODEL,
    thinking: false
  };

  private readonly advanced: LlmModelConfig = {
    provider: "deepseek-v4-pro",
    apiKey: env.DEEPSEEK_PRO_API_KEY,
    baseUrl: env.DEEPSEEK_PRO_BASE_URL,
    model: env.DEEPSEEK_PRO_MODEL,
    thinking: true
  };

  async parseConstraints(task: string, rawInput: PlanRequest): Promise<LlmJsonResult<Partial<UserConstraints>> | undefined> {
    const model = this.selectModel(task, "parse");
    if (!model.apiKey) {
      return undefined;
    }

    const data = await this.completeJson<Partial<UserConstraints>>(model, [
      {
        role: "system",
        content:
          "你是 CityWalk Pulse 的约束解析器。只输出 JSON，不要 Markdown。字段包括 city,startPoint,durationMinutes,budget,preferences,peopleCount,transportMode,weatherPreference,weatherRisk。缺失字段不要编造得过细，可使用合理默认值。"
      },
      {
        role: "user",
        content: JSON.stringify({ task, rawInput })
      }
    ]);

    return { provider: model.provider, model: model.model, data };
  }

  async planSteps(task: string, constraints: UserConstraints): Promise<LlmJsonResult<AgentPlanStep[]> | undefined> {
    const model = this.selectModel(`${task} ${constraints.preferences.join(" ")}`, "plan");
    if (!model.apiKey) {
      return undefined;
    }

    const data = await this.completeJson<AgentPlanStep[] | { steps?: AgentPlanStep[] }>(model, [
      {
        role: "system",
        content:
          "你是 CityWalk Pulse 的 Planner。只输出 JSON 对象，格式为 {\"steps\":[...]}，最多 6 步。每步字段为 id,description,toolHint,dependsOn,status。toolHint 只能是 weather,poi_search,route_plan,constraint_check；status 固定 pending。必须体现 plan-and-execute 外层计划，不要直接给最终路线。"
      },
      {
        role: "user",
        content: JSON.stringify({ task, constraints })
      }
    ]);

    return {
      provider: model.provider,
      model: model.model,
      data: this.normalizePlanSteps(data)
    };
  }

  private selectModel(task: string, stage: "parse" | "plan"): LlmModelConfig {
    const useAdvanced = this.isComplexTask(task) || this.hashBucket(`${stage}:${task}`) < env.LLM_ADVANCED_RATIO;
    if (useAdvanced && this.advanced.apiKey) {
      return this.advanced;
    }
    if (this.primary.apiKey) {
      return this.primary;
    }
    return this.advanced;
  }

  private isComplexTask(task: string): boolean {
    const signals = ["多方案", "雨天", "避雨", "预算", "老人", "儿童", "地铁", "公交", "空气", "预警", "比较", "不要", "必须"];
    const hits = signals.filter((signal) => task.includes(signal)).length;
    return hits >= 3 || task.length > 80;
  }

  private hashBucket(input: string): number {
    let hash = 2166136261;
    for (const char of input) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0xffffffff;
  }

  private async completeJson<T>(model: LlmModelConfig, messages: ChatMessage[]): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.LLM_TIMEOUT_MS);

    try {
      const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}${this.normalizedChatPath()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${model.apiKey}`
        },
        body: JSON.stringify(this.buildRequestBody(model, messages)),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`LLM ${model.provider} HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(`LLM ${model.provider} returned empty content`);
      }
      return this.parseJsonContent<T>(content);
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseJsonContent<T>(content: string): T {
    const trimmed = content.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!match) {
        throw new Error("LLM response is not JSON");
      }
      return JSON.parse(match[0]) as T;
    }
  }

  private buildRequestBody(model: LlmModelConfig, messages: ChatMessage[]) {
    return {
      model: model.model,
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
      stream: false,
      ...(model.thinking
        ? {
            thinking: { type: "enabled" },
            reasoning_effort: "high"
          }
        : {})
    };
  }

  private normalizedChatPath(): string {
    return env.DEEPSEEK_CHAT_COMPLETIONS_PATH.startsWith("/")
      ? env.DEEPSEEK_CHAT_COMPLETIONS_PATH
      : `/${env.DEEPSEEK_CHAT_COMPLETIONS_PATH}`;
  }

  private normalizePlanSteps(payload: AgentPlanStep[] | { steps?: AgentPlanStep[] }): AgentPlanStep[] {
    const steps = Array.isArray(payload) ? payload : payload.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error("LLM plan steps must be a non-empty array");
    }

    const allowed = new Set(["weather", "poi_search", "route_plan", "constraint_check"]);
    return steps.slice(0, 6).map((step, index) => ({
      id: step.id || `step_${index + 1}`,
      description: step.description || "执行 CityWalk 子任务",
      toolHint: allowed.has(step.toolHint) ? step.toolHint : "constraint_check",
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
      status: "pending"
    }));
  }
}
