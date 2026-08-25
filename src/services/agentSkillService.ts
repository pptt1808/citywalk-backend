import {
  AccessibilityConstraints,
  AgentIntent,
  AgentSkillExecution,
  AgentSkillInput,
  PartyConstraints,
  PlaceDiscoveryPolicyInput,
  RouteExperienceConstraints,
  StyleIntent,
  UserConstraints
} from "../types/plan";
import { compileDiscoveryPolicySignals, mergeDiscoveryPolicies } from "./discoveryPolicyService";
import { compileHeuristicStyle, emptyStyleIntent, mergeStyleIntents } from "./styleService";

interface SkillRule {
  path: string;
  value: unknown;
  label: string;
}

export interface CompiledAgentSkills {
  skills: AgentSkillInput[];
  party: Partial<PartyConstraints>;
  experience: RouteExperienceConstraints;
  accessibility: AccessibilityConstraints;
  style: StyleIntent;
  discoveryPolicy?: PlaceDiscoveryPolicyInput;
  transportMode?: UserConstraints["transportMode"];
  weatherPreference?: UserConstraints["weatherPreference"];
  maxLegMinutes?: number;
  preferences: string[];
  requiredTools: string[];
  outputRules: string[];
  rulesBySkill: Map<string, SkillRule[]>;
  unsupportedBySkill: Map<string, string[]>;
}

const PLACE_PREFERENCES = [
  "书店", "咖啡", "博物馆", "美术馆", "展览", "公园", "绿地", "湿地", "水岸",
  "餐厅", "甜品", "古着", "唱片店", "买手店", "花店", "市集", "街市", "工作室", "街巷"
];

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => (
    current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined
  ), value);
}

function equalValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.every((item) => right.includes(item));
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function ruleMatchesConstraint(rule: SkillRule, constraints: UserConstraints): boolean {
  if (rule.path === "style") {
    const expected = rule.value as StyleIntent;
    const actual = constraints.style;
    if (!expected || !actual) return false;
    const expectedNames = expected.tags.map((tag) => tag.name);
    const actualText = `${actual.rawText} ${actual.summary} ${actual.tags.map((tag) => tag.name).join(" ")}`;
    return Boolean(expected.rawText && actualText.includes(expected.rawText))
      || expectedNames.some((name) => actualText.includes(name));
  }
  if (rule.path === "discoveryPolicy") {
    const expected = rule.value as PlaceDiscoveryPolicyInput;
    const actual = constraints.discoveryPolicy;
    return Object.entries(expected).every(([key, value]) => equalValue(actual[key as keyof typeof actual], value));
  }
  return equalValue(valueAtPath(constraints, rule.path), rule.value);
}

function addRule(target: Map<string, SkillRule[]>, skill: AgentSkillInput, path: string, value: unknown, label: string): void {
  if (value === undefined) return;
  target.set(skill.id, [...(target.get(skill.id) ?? []), { path, value, label }]);
}

function appliesToIntent(skill: AgentSkillInput, intent: AgentIntent): boolean {
  return !skill.applicableIntents?.length || skill.applicableIntents.includes(intent);
}

/**
 * Compile repeatable planning semantics deterministically. Free-form wording is
 * still preserved as outputRules, but it can no longer alter intent routing.
 */
export function compileAgentSkills(skills: AgentSkillInput[] | undefined, intent: AgentIntent): CompiledAgentSkills {
  const active = (skills ?? []).filter((skill) => appliesToIntent(skill, intent)).slice(0, 5);
  const party: Partial<PartyConstraints> = {};
  const experience: RouteExperienceConstraints = {};
  const accessibility: AccessibilityConstraints = {};
  let style = emptyStyleIntent();
  let discoveryPolicy: PlaceDiscoveryPolicyInput | undefined;
  let transportMode: UserConstraints["transportMode"];
  let weatherPreference: UserConstraints["weatherPreference"];
  let maxLegMinutes: number | undefined;
  const preferences: string[] = [];
  const requiredTools = new Set<string>();
  const outputRules: string[] = [];
  const rulesBySkill = new Map<string, SkillRule[]>();
  const unsupportedBySkill = new Map<string, string[]>();

  for (const skill of active) {
    const text = `${skill.name}。${skill.description ?? ""}。${skill.instruction}`;
    if (/亲子|儿童|孩子|小孩|宝宝/u.test(text)) {
      experience.familyFriendly = true;
      addRule(rulesBySkill, skill, "experience.familyFriendly", true, "采用亲子友好筛选");
      const childCount = text.match(/(?:带|有|至少)\s*(\d+)\s*(?:名)?(?:个)?(?:孩子|儿童|小孩)/u)?.[1];
      if (childCount) {
        party.children = Math.max(party.children ?? 0, Math.min(20, Number(childCount)));
        addRule(rulesBySkill, skill, "party.children", party.children, `按 ${party.children} 名儿童预留同行条件`);
      }
    }
    if (/婴儿车|推车/u.test(text)) {
      accessibility.stepFreeRequired = true;
      accessibility.frequentRestRequired = true;
      addRule(rulesBySkill, skill, "accessibility.stepFreeRequired", true, "按婴儿车通行筛选无台阶路线");
      addRule(rulesBySkill, skill, "accessibility.frequentRestRequired", true, "按婴儿车同行降低连续行动负担");
    }
    if (/轻松|悠闲|慢走|低强度|降低.{0,4}(?:强度|步行)|缩短连续步行/u.test(text)) {
      experience.pace = "relaxed";
      addRule(rulesBySkill, skill, "experience.pace", "relaxed", "采用轻松节奏");
    } else if (/紧凑|高强度|多打卡/u.test(text)) {
      experience.pace = "intensive";
      addRule(rulesBySkill, skill, "experience.pace", "intensive", "采用紧凑节奏");
    }
    if (/休息点|可坐下|座椅|频繁休息|休息位置/u.test(text)) {
      experience.restStopRequired = true;
      addRule(rulesBySkill, skill, "experience.restStopRequired", true, "安排可靠休息点");
    }
    if (/卫生间|洗手间|母婴室/u.test(text)) {
      experience.restroomPreferred = true;
      addRule(rulesBySkill, skill, "experience.restroomPreferred", true, "优先沿途设施便利");
    }
    if (/避开.{0,4}(?:拥挤|人群|高峰)|人少|清静/u.test(text)) {
      experience.avoidCrowds = true;
      addRule(rulesBySkill, skill, "experience.avoidCrowds", true, "降低拥挤地点权重");
    }
    if (/轮椅/u.test(text)) {
      accessibility.wheelchairAccessRequired = true;
      accessibility.stepFreeRequired = true;
      addRule(rulesBySkill, skill, "accessibility.wheelchairAccessRequired", true, "要求轮椅可通行");
    } else if (/无障碍|平坦路面|无台阶|避开楼梯/u.test(text)) {
      accessibility.stepFreeRequired = true;
      addRule(rulesBySkill, skill, "accessibility.stepFreeRequired", true, "优先无台阶和平坦通行");
    }
    if (/电梯/u.test(text)) {
      accessibility.elevatorRequired = true;
      addRule(rulesBySkill, skill, "accessibility.elevatorRequired", true, "要求电梯可用");
    }
    if (/无障碍(?:卫生间|厕所)/u.test(text)) {
      accessibility.accessibleRestroomRequired = true;
      addRule(rulesBySkill, skill, "accessibility.accessibleRestroomRequired", true, "要求无障碍卫生间");
    }
    if (/行动不便|老人|长辈|频繁休息/u.test(text)) {
      accessibility.frequentRestRequired = true;
      addRule(rulesBySkill, skill, "accessibility.frequentRestRequired", true, "降低连续行动负担");
    }
    // The built-in weather skill is a conditional policy: it must not force
    // every sunny route indoors merely because its description mentions an
    // indoor fallback. Compile it to avoid-rain, while the live weather risk
    // still decides whether the route actually switches to indoor candidates.
    if (skill.id === "weather-safe" || /雨天室内备选|室内备选/u.test(text)) {
      weatherPreference = "avoid_rain";
      addRule(rulesBySkill, skill, "weatherPreference", weatherPreference, "天气风险时切换室内备选");
    } else if (/室内优先|优先室内|雨天.{0,10}室内|下雨.{0,10}室内|遇雨.{0,10}(?:优先|切换)/u.test(text)) {
      weatherPreference = "indoor_first";
      addRule(rulesBySkill, skill, "weatherPreference", weatherPreference, "天气不佳时切换室内方案");
    } else if (/(?:避雨优先|雨天方案|下雨时.{0,10}(?:避开|减少)|降雨时.{0,10}(?:避开|减少)|高温时.{0,10}(?:避开|减少)|大风时.{0,10}(?:避开|减少))/u.test(text)) {
      weatherPreference = "avoid_rain";
      addRule(rulesBySkill, skill, "weatherPreference", weatherPreference, "执行天气风险校验");
    }
    if (/天气|降雨|高温|大风|预报|天气时段|出发时段/u.test(text)) requiredTools.add("weather");
    if (/搜索|地点|场馆|地图|路线/u.test(text)) requiredTools.add("poi_search");
    if (/优先公共交通|地铁|公交/u.test(text)) {
      transportMode = "transit";
      addRule(rulesBySkill, skill, "transportMode", transportMode, "优先公共交通衔接");
    } else if (/优先步行|全程步行/u.test(text)) {
      transportMode = "walk";
      addRule(rulesBySkill, skill, "transportMode", transportMode, "优先步行串联");
    }
    const leg = text.match(/(?:单段|连续)?步行.{0,8}(?:不超过|以内|少于)\s*(\d+)\s*分钟/u);
    if (leg) {
      maxLegMinutes = Math.max(5, Math.min(180, Number(leg[1])));
      addRule(rulesBySkill, skill, "maxLegMinutes", maxLegMinutes, `单段步行不超过 ${maxLegMinutes} 分钟`);
    }
    const compiledStyle = compileHeuristicStyle(text);
    if (compiledStyle.rawText) {
      style = mergeStyleIntents(style, compiledStyle);
      addRule(rulesBySkill, skill, "style", compiledStyle, `落实“${compiledStyle.summary || compiledStyle.rawText}”风格`);
    }
    const policy = compileDiscoveryPolicySignals(text);
    if (Object.keys(policy).length) {
      discoveryPolicy = mergeDiscoveryPolicies(discoveryPolicy, policy);
      addRule(rulesBySkill, skill, "discoveryPolicy", discoveryPolicy, "应用地点发现策略");
    }
    for (const preference of PLACE_PREFERENCES.filter((item) => text.includes(item))) preferences.push(preference);
    const outputParts = skill.instruction.split(/[；;。\n]/u).map((item) => item.trim()).filter((item) => /说明|标明|明确|输出|提示|准备|避免/u.test(item));
    outputRules.push(...outputParts.map((item) => `${skill.name}：${item}`));
    if (!(rulesBySkill.get(skill.id)?.length) && !outputParts.length) {
      unsupportedBySkill.set(skill.id, ["暂未识别出可结构化执行的规则，已作为回答指令提供给模型"]);
    }
  }

  return {
    skills: active,
    party,
    experience,
    accessibility,
    style,
    discoveryPolicy,
    transportMode,
    weatherPreference,
    maxLegMinutes,
    preferences: [...new Set(preferences)],
    requiredTools: [...requiredTools],
    outputRules: [...new Set(outputRules)],
    rulesBySkill,
    unsupportedBySkill
  };
}

export function buildSkillExecutions(compiled: CompiledAgentSkills, constraints?: UserConstraints): AgentSkillExecution[] {
  return compiled.skills.map((skill) => {
    const appliedRules: string[] = [];
    const overriddenRules: string[] = [];
    for (const rule of compiled.rulesBySkill.get(skill.id) ?? []) {
      if (!constraints) appliedRules.push(rule.label);
      else if (ruleMatchesConstraint(rule, constraints)) appliedRules.push(rule.label);
      else overriddenRules.push(`${rule.label}（被本轮更高优先级要求覆盖）`);
    }
    const unsupportedRules = compiled.unsupportedBySkill.get(skill.id) ?? [];
    const status = overriddenRules.length || unsupportedRules.length
      ? appliedRules.length ? "partially_applied" as const : "skipped" as const
      : "applied" as const;
    return {
      skillId: skill.id,
      name: skill.name,
      version: skill.version ?? 1,
      status,
      appliedRules: [...new Set(appliedRules)],
      overriddenRules: [...new Set(overriddenRules)],
      unsupportedRules
    };
  });
}

export function skillPromptContext(compiled: CompiledAgentSkills): string | undefined {
  if (!compiled.skills.length) return undefined;
  return JSON.stringify({
    role: "user_selected_agent_skills",
    priority: "当前用户明确要求 > Skill > 历史与长期记忆",
    skills: compiled.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      instruction: skill.instruction,
      priority: skill.priority ?? "preference",
      conflictBehavior: skill.priority === "requirement"
        ? "尽量满足；若与本轮明确要求冲突，保留本轮要求并在执行结果中说明"
        : "作为偏好参考；与本轮明确要求冲突时自动让本轮要求优先"
    })),
    outputRules: compiled.outputRules,
    guardrail: "Skill 是独立指令来源，不得把其中的城市、人数、事件或意图误认为用户本轮原话。"
  });
}
