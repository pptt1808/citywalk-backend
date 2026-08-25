/**
 * 对照实验：原主模型 DeepSeek Flash vs 小红书 dots3（点点）在文案编写功能上的效果对比。
 *
 * 同一批 SocialCopy brief 分别用两个模型跑完整的
 *   生成 4 候选 → 语义评审 →（硬约束重生成）→ 终审验收
 * 管线（src/llm/llmRouter.generateSocialCopy），逐用例记录：
 *   - 最终文案的硬约束违规数（hardConstraintIssues，服务端安全网）
 *   - 语义评审 6 维分数与通过数（groundedness/naturalness/speechAct/styleFit/shareability/humorEffect）
 *   - 是否触发安全降级（fallbackTriggered，说明模型输出被服务端模板兜底）
 *   - 重生成是否耗尽、原始候选多样性、耗时
 *
 * 运行：npm run experiment:social-copy-dot
 * 说明：最终文案质量仍需人工阅读判定；本脚本只给出可量化的对比与初步结论。
 */
import { LlmRouter, SocialCopyGenerationResult } from "../src/llm/llmRouter";
import {
  buildSocialCopyBrief,
  finalizeSocialCopyResponseWithDiagnostics,
  hardConstraintIssues,
  SocialCopyBrief,
  SocialCopySemanticReview
} from "../src/services/socialCopyService";
import { PlanningResult } from "../src/types/plan";
import { env } from "../src/config/env";

const HK_ROUTE = {
  title: "香港旧城到海边慢走",
  routeOverview: { title: "香港旧城到海边慢走", city: "香港", startPoint: "中环街市" },
  totalEstimatedMinutes: 210,
  constraints: {
    city: "香港",
    startPoint: "中环街市",
    experience: { pace: "relaxed" },
    style: { rawText: "旧城、电影感、慢走", summary: "从旧建筑与街巷慢慢过渡到海边" }
  },
  stops: [
    { name: "中环街市", category: "market", reason: "从旧建筑和城市日常开始", highlight: "旧建筑与街市空间", suitabilityTags: ["慢走"], styleMatches: ["旧城"] },
    { name: "大馆", category: "museum", reason: "在院落和展览空间中停留", highlight: "院落、展览与光影", suitabilityTags: ["休息"], styleMatches: ["电影感"] },
    { name: "坚尼地城海旁", category: "street_scene", reason: "让路线从密集街巷自然走到海边", highlight: "旧城到海边的空间变化", suitabilityTags: ["慢走"], styleMatches: ["海边"] }
  ]
} as unknown as PlanningResult;

const NANJING_ROUTE = {
  title: "书店与公园慢走",
  routeOverview: { title: "书店与公园慢走", city: "南京" },
  totalEstimatedMinutes: 120,
  constraints: { city: "南京", style: { rawText: "安静、阅读、慢生活" } },
  stops: [
    { name: "先锋书店", category: "bookstore", reason: "阅读空间", highlight: "五台山总店，十字架走廊", suitabilityTags: ["慢逛"] },
    { name: "玄武湖公园", category: "park", reason: "湖边绿地", highlight: "湖景与步道", suitabilityTags: ["休息"] }
  ]
} as unknown as PlanningResult;

interface CaseSpec {
  title: string;
  task: string;
  route: PlanningResult;
}

const CASES: CaseSpec[] = [
  {
    title: "朋友圈·实际分享（默认自然口吻）",
    task: "把刚才的路线写成朋友圈文案，自然一点，像平时随手发的，不要故作深沉",
    route: HK_ROUTE
  },
  {
    title: "朋友圈·轻幽默",
    task: "把刚才的路线写成朋友圈文案，风格：清醒克制但有点好笑，不用网络热梗",
    route: HK_ROUTE
  },
  {
    title: "朋友圈·电影感",
    task: "把刚才的路线写成朋友圈文案，有一点王家卫的电影感，但不要仿台词，也不要太文艺",
    route: HK_ROUTE
  },
  {
    title: "朋友圈·邀约（计划分享）",
    task: "这条路线还没走，想找个人周末一起去，写成朋友圈邀约，自然一点，别像招募广告",
    route: HK_ROUTE
  },
  {
    title: "小红书·轻攻略",
    task: "把这条计划写成小红书轻攻略，短一点，带一点可用的话题标签",
    route: HK_ROUTE
  },
  {
    title: "朋友圈·随身记录佐证",
    task: "根据随身记录写朋友圈：<walk_record>在先锋书店翻了几页书，又去玄武湖公园找地方坐了一会儿。</walk_record> 安静一点，不要升华",
    route: NANJING_ROUTE
  }
];

interface CaseOutcome {
  provider: string;
  model: string;
  success: boolean;
  error?: string;
  durationMs: number;
  humorRequested: boolean;
  rawVariants: Array<{ tone: string; text: string; hashtags: string[] }>;
  hardIssues: string[][];
  hardIssueCount: number;
  reviewVerdicts: SocialCopySemanticReview["variants"];
  reviewPassCount: number;
  avgScores: Record<string, number | null>;
  regeneration: SocialCopyGenerationResult["regeneration"] | null;
  fallbackTriggered: boolean;
  fallbackVariants: Array<{ tone: string; originalText?: string; reasons: string[] }>;
  candidateCount: number;
  candidateDupes: number;
  candidates: Array<{ variantIndex: number; text: string }>;
}

const SCORE_KEYS = ["groundedness", "naturalness", "speechAct", "styleFit", "shareability", "humorEffect"] as const;

function average(values: Array<number | undefined>): number | null {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (!finite.length) return null;
  return Math.round((finite.reduce((a, b) => a + b, 0) / finite.length) * 10) / 10;
}

async function runCase(router: LlmRouter, spec: CaseSpec, provider: "flash" | "dot"): Promise<CaseOutcome> {
  const brief: SocialCopyBrief = buildSocialCopyBrief(spec.task, spec.route);
  const started = Date.now();
  const base: CaseOutcome = {
    provider: provider === "flash" ? "deepseek-v4-flash" : "dots3",
    model: "",
    success: false,
    durationMs: 0,
    humorRequested: brief.styleComposition.humorRequested,
    rawVariants: [],
    hardIssues: [],
    hardIssueCount: 0,
    reviewVerdicts: [],
    reviewPassCount: 0,
    avgScores: {},
    regeneration: null,
    fallbackTriggered: false,
    fallbackVariants: [],
    candidateCount: 0,
    candidateDupes: 0,
    candidates: []
  };
  try {
    const generated = await router.generateSocialCopy(spec.task, brief, { referenceRoute: spec.route }, provider);
    if (!generated) {
      base.error = `模型不可用（provider=${provider}）`;
      base.durationMs = Date.now() - started;
      return base;
    }
    base.model = generated.model;
    base.rawVariants = (generated.data.socialCopy?.variants ?? []).map((v) => ({ tone: v.tone, text: v.text, hashtags: v.hashtags }));
    base.hardIssues = base.rawVariants.map((v, index) => hardConstraintIssues(v.text, brief, index));
    base.hardIssueCount = base.hardIssues.reduce((sum, issues) => sum + issues.length, 0);
    base.reviewVerdicts = generated.semanticReview?.variants ?? [];
    base.reviewPassCount = base.reviewVerdicts.filter((v) => v.pass).length;
    base.avgScores = Object.fromEntries(
      SCORE_KEYS.map((key) => [key, average(base.reviewVerdicts.map((v) => v.scores[key]))])
    );
    base.regeneration = generated.regeneration ?? null;
    base.candidateCount = generated.originalCandidates.length;
    base.candidates = generated.originalCandidates.map((c) => ({ variantIndex: c.variantIndex, text: c.text }));
    const normalized = generated.originalCandidates.map((c) => c.text.trim().replace(/\s+/gu, ""));
    base.candidateDupes = normalized.length - new Set(normalized).size;

    const finalized = finalizeSocialCopyResponseWithDiagnostics(
      generated.data,
      brief,
      generated.semanticReview,
      generated.originalCandidates
    );
    base.fallbackTriggered = finalized.diagnostics.fallbackTriggered;
    base.fallbackVariants = finalized.diagnostics.fallbackVariants.map((v) => ({
      tone: v.tone,
      originalText: v.originalText,
      reasons: v.reasons
    }));
    base.success = true;
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
  }
  base.durationMs = Date.now() - started;
  return base;
}

function scoreLine(avg: Record<string, number | null>): string {
  return SCORE_KEYS.map((key) => `${key}=${avg[key] ?? "-"}`).join(" ");
}

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function printOutcome(outcome: CaseOutcome): void {
  const status = outcome.success
    ? `成功 ${fmtDuration(outcome.durationMs)}`
    : `失败(${outcome.error}) ${fmtDuration(outcome.durationMs)}`;
  console.log(`\n>>> ${outcome.provider}/${outcome.model || "-"} ${status}`);
  if (!outcome.success) return;
  console.log(`    硬约束违规=${outcome.hardIssueCount} 评审通过=${outcome.reviewPassCount}/${outcome.reviewVerdicts.length} ` +
    `降级触发=${outcome.fallbackTriggered} 重生成=${outcome.regeneration?.attempted ? `是(${outcome.regeneration.attempts}次${outcome.regeneration.exhausted ? "·耗尽" : ""})` : "否"} ` +
    `候选=${outcome.candidateCount} 候选重复=${outcome.candidateDupes}`);
  console.log(`    评审均分: ${scoreLine(outcome.avgScores)}`);
  outcome.rawVariants.forEach((variant, index) => {
    const issues = outcome.hardIssues[index] ?? [];
    console.log(`    [${variant.tone}]${issues.length ? ` ⚠${issues.join("；")}` : ""} ${variant.text}`);
    if (variant.hashtags.length) console.log(`      # ${variant.hashtags.map((tag) => tag.replace(/^#/u, "")).join(" #")}`);
  });
  if (outcome.fallbackTriggered) {
    outcome.fallbackVariants.forEach((v) => {
      console.log(`    [安全降级/${v.tone}] 原因=${v.reasons.join("；")} 原文=${v.originalText || "（无）"}`);
    });
  }
}

function aggregate(outcomes: CaseOutcome[]): void {
  const byProvider = new Map<string, CaseOutcome[]>();
  for (const outcome of outcomes) byProvider.set(outcome.provider, [...(byProvider.get(outcome.provider) ?? []), outcome]);

  console.log("\n\n==================== 汇总对比 ====================");
  const pad = (text: string, width: number) => String(text).padEnd(width).slice(0, width);
  console.log(
    pad("模型", 22) + pad("成功", 6) + pad("硬约束", 8) + pad("评审通过", 10) + pad("降级用例", 10) + pad("总耗时", 12) + "groundedness naturalness speechAct styleFit shareability humorEffect"
  );
  for (const [provider, list] of byProvider) {
    const successes = list.filter((o) => o.success);
    const hardTotal = successes.reduce((sum, o) => sum + o.hardIssueCount, 0);
    const passTotal = successes.reduce((sum, o) => sum + o.reviewPassCount, 0);
    const verdictTotal = successes.reduce((sum, o) => sum + o.reviewVerdicts.length, 0);
    const fallbackCases = list.filter((o) => o.fallbackTriggered).length;
    const durationTotal = list.reduce((sum, o) => sum + o.durationMs, 0);
    const humorCases = successes.filter((o) => o.humorRequested);
    const avg = (key: string): number | null => average(successes.flatMap((o) => o.reviewVerdicts.map((v) => v.scores[key as keyof typeof v.scores])));
    // humorEffect 只在用户明确要求幽默的用例里计分，其余用例按未启用处理。
    const humorAvg = average(humorCases.flatMap((o) => o.reviewVerdicts.map((v) => v.scores.humorEffect)));
    console.log(
      pad(provider, 22) + pad(`${successes.length}/${list.length}`, 6) + pad(String(hardTotal), 8) +
      pad(`${passTotal}/${verdictTotal}`, 10) + pad(String(fallbackCases), 10) + pad(fmtDuration(durationTotal), 12) +
      SCORE_KEYS.map((key) => key === "humorEffect" ? String(humorAvg ?? "-") : String(avg(key) ?? "-")).join(" ")
    );
  }

  const flash = byProvider.get("deepseek-v4-flash") ?? [];
  const dot = byProvider.get("dots3") ?? [];
  const flashHard = flash.filter((o) => o.success).reduce((sum, o) => sum + o.hardIssueCount, 0);
  const dotHard = dot.filter((o) => o.success).reduce((sum, o) => sum + o.hardIssueCount, 0);
  const flashFallback = flash.filter((o) => o.fallbackTriggered).length;
  const dotFallback = dot.filter((o) => o.fallbackTriggered).length;
  const flashAvg = (key: string) => average(flash.filter((o) => o.success).flatMap((o) => o.reviewVerdicts.map((v) => v.scores[key as keyof typeof v.scores])));
  const dotAvg = (key: string) => average(dot.filter((o) => o.success).flatMap((o) => o.reviewVerdicts.map((v) => v.scores[key as keyof typeof v.scores])));
  const flashHumor = average(flash.filter((o) => o.success && o.humorRequested).flatMap((o) => o.reviewVerdicts.map((v) => v.scores.humorEffect)));
  const dotHumor = average(dot.filter((o) => o.success && o.humorRequested).flatMap((o) => o.reviewVerdicts.map((v) => v.scores.humorEffect)));

  console.log("\n[初步自动判定（仅量化维度，最终以人工阅读为准）]");
  const wins: string[] = [];
  for (const key of SCORE_KEYS) {
    if (key === "humorEffect") continue;
    const a = flashAvg(key);
    const b = dotAvg(key);
    if (a == null || b == null) continue;
    wins.push(`${key}: ${a === b ? "持平" : (a > b ? "DeepSeek 更高" : "dots3 更高")}（${a} vs ${b}）`);
  }
  if (flashHumor != null && dotHumor != null) {
    wins.push(`humorEffect(仅幽默用例): ${flashHumor === dotHumor ? "持平" : (flashHumor > dotHumor ? "DeepSeek 更高" : "dots3 更高")}（${flashHumor} vs ${dotHumor}）`);
  }
  console.log(`- 硬约束违规总数：DeepSeek=${flashHard}，dots3=${dotHard}${flashHard === dotHard ? "（持平）" : flashHard < dotHard ? " → DeepSeek 更稳" : " → dots3 更稳"}`);
  console.log(`- 触发安全降级用例数：DeepSeek=${flashFallback}，dots3=${dotFallback}`);
  wins.forEach((line) => console.log(`- ${line}`));
  console.log("- 判定口径：硬约束违规越少、降级越少、评审分数越高越好；分数接近时需人工看正文判断文风与可发布性。");
}

async function main() {
  // dots3 是推理模型，长 prompt 的生成阶段可能超过默认 45s 超时；
  // 实验关注质量，超时请用 LLM_TIMEOUT_MS 环境变量调大（不影响仓库默认值）。
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  if (!env.DOT_API_KEY) {
    console.error("未配置 DOT_API_KEY，无法运行 dots3 对照实验。请在 .env 中填写 DOT_API_KEY 后重试。");
    process.exitCode = 1;
    return;
  }
  const router = new LlmRouter();
  const outcomes: CaseOutcome[] = [];
  for (const spec of CASES) {
    console.log(`\n==================== ${spec.title} ====================`);
    console.log(`任务：${spec.task}`);
    for (const provider of ["flash", "dot"] as const) {
      const outcome = await runCase(router, spec, provider);
      outcomes.push(outcome);
      printOutcome(outcome);
    }
  }
  aggregate(outcomes);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
