import { LlmRouter } from "../src/llm/llmRouter";
import {
  buildFallbackSocialCopyResponse,
  buildSocialCopyBrief,
  finalizeSocialCopyResponseWithDiagnostics
} from "../src/services/socialCopyService";
import { PlanningResult } from "../src/types/plan";

const route = {
  title: "香港旧城到海边慢走",
  routeOverview: {
    title: "香港旧城到海边慢走",
    city: "香港",
    startPoint: "中环街市"
  },
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

const cases = [
  "把刚才的路线写成朋友圈文案，自然一点，像平时随手发的，不要故作深沉",
  "把刚才的路线写成朋友圈文案，风格：清醒克制但有点好笑，不用网络热梗",
  "把刚才的路线写成朋友圈文案，有一点王家卫的电影感，但不要仿台词，也不要太文艺",
  "这条路线还没走，想找个人周末一起去，写成朋友圈邀约，自然一点，别像招募广告"
];

async function main() {
  const router = new LlmRouter();
  for (const task of cases) {
    const brief = buildSocialCopyBrief(task, route);
    const fallback = buildFallbackSocialCopyResponse(brief);
    let response = fallback;
    let source = "deterministic-fallback";
    try {
      const generated = await router.generateSocialCopy(task, brief, { referenceRoute: route }, "flash");
      if (generated) {
        const finalized = finalizeSocialCopyResponseWithDiagnostics(
          generated.data,
          brief,
          generated.semanticReview,
          generated.originalCandidates
        );
        response = finalized.response;
        source = finalized.diagnostics.fallbackTriggered
          ? `${generated.provider}:${generated.model} + safe-fallback(${finalized.diagnostics.fallbackVariants.length}/2)`
          : `${generated.provider}:${generated.model} + semantic-review`;
        console.log("\n[原始候选]");
        generated.originalCandidates.forEach((candidate, index) => {
          console.log(`#${index} variant=${candidate.variantIndex}: ${candidate.text}`);
        });
        console.log("[语义评审]");
        generated.semanticReview?.variants.forEach((verdict) => {
          console.log(`variant=${verdict.variantIndex}, selected=#${verdict.selectedCandidateIndex}, pass=${verdict.pass}, scores=${JSON.stringify(verdict.scores)}`);
          if (verdict.issues.length) console.log(`issues: ${verdict.issues.join("；")}`);
          if (verdict.revisedText) console.log(`rewrite: ${verdict.revisedText}`);
        });
        if (generated.regeneration?.attempted) {
          console.log(`[重生成] 已根据违规原因重新生成一次：${generated.regeneration.reasons.join('；')}`);
          console.log(`[重生成] ${generated.regeneration.exhausted ? '仍有硬约束未通过，将使用安全版本' : '重新生成后已通过硬约束'}`);
        }
        for (const degraded of finalized.diagnostics.fallbackVariants) {
          console.log(`[触发安全降级/${degraded.tone}]`);
          console.log(`原始入选文案：${degraded.originalText || "（模型未返回）"}`);
          console.log(`原因：${degraded.reasons.join("；")}`);
          console.log(`降级后：${degraded.fallbackText}`);
        }
      }
    } catch (error) {
      source = `fallback (${error instanceof Error ? error.message : String(error)})`;
    }
    console.log(`\n=== ${task} ===`);
    console.log(`mode=${brief.experienceMode}, style=${brief.styleProfile.rawText}, source=${source}`);
    for (const variant of response.socialCopy?.variants ?? []) {
      console.log(`[${variant.tone}] ${variant.text}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
