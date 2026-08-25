import assert from "node:assert/strict";
import {
  buildFallbackSocialCopyResponse,
  buildSocialCopyBrief,
  finalizeSocialCopyResponse,
  finalizeSocialCopyResponseWithDiagnostics,
  hardConstraintIssues
} from "../src/services/socialCopyService";
import { IntentResponsePayload, PlanningResult } from "../src/types/plan";

const route = {
  title: "香港旧城电影感漫步",
  routeOverview: { title: "香港旧城电影感漫步", city: "香港" },
  totalEstimatedMinutes: 210,
  constraints: { city: "香港" },
  stops: [
    { name: "中环街市", reason: "旧建筑与室内停留", suitabilityTags: ["慢走"], styleMatches: ["旧城"] },
    { name: "大馆", reason: "院落与展览空间", suitabilityTags: ["休息"], styleMatches: ["光影"] },
    { name: "坚尼地城海旁", reason: "路线收尾", suitabilityTags: ["看海"], styleMatches: ["傍晚"] }
  ]
} as unknown as PlanningResult;

function assertGrounded(texts: string[], names: string[]) {
  for (const text of texts) {
    assert.ok(names.some((name) => text.includes(name)) || text.length <= 45, `长文案必须锚定路线事实，短文案可以只保留个人表达：${text}`);
    assert.doesNotMatch(text, /家人们谁懂|闭眼冲|一定要收藏|保姆级|点赞关注/u);
    assert.doesNotMatch(text, /第一站|第二站|第三站|路线(?:依次|包括|包含|经过)/u);
  }
}

const custom = buildSocialCopyBrief(
  "根据刚才路线写朋友圈文案，风格：清醒克制但有点好笑",
  route
);
assert.equal(custom.platform, "moments");
assert.equal(custom.experienceMode, "visited", "普通的‘基于计划写文案’也默认使用实际分享口吻");
assert.equal(custom.invitationRequested, false);
assert.equal(custom.styleProfile.source, "custom");
assert.match(custom.styleProfile.rawText, /清醒克制但有点好笑/u);
assert.equal(custom.selectedCase.id, "dry-humor", "混合风格中的明确幽默要求不能被‘克制’预设覆盖");
assert.equal(custom.variantPlans.length, 2);
assert.deepEqual(custom.variantPlans.map((item) => item.label), ["完整版", "简短版"]);
assert.match(custom.shareAngle.candidateDirections.join(" "), /中环街市.*坚尼地城海旁/u);
assert.equal(custom.speechAct, "actual_share");
assert.equal(custom.evidence.level, "route_only");
assert.equal(custom.styleComposition.humorRequested, true);

const customFallback = buildFallbackSocialCopyResponse(custom);
assert.equal(customFallback.socialCopy?.variants.length, 2);
assert.ok(customFallback.socialCopy?.variants.every((variant) => variant.hashtags.length === 0));
assertGrounded(customFallback.socialCopy!.variants.map((variant) => variant.text), route.stops.map((stop) => stop.name));
assert.ok(customFallback.socialCopy?.variants.every((variant, index) => variant.tone === custom.variantPlans[index].label));
assert.ok(customFallback.socialCopy!.variants[0].text.length > customFallback.socialCopy!.variants[1].text.length);

const invitation = buildSocialCopyBrief(
  "路线还没走，想找个人周末一起去，写得自然一点，不要像招募广告",
  route
);
assert.equal(invitation.experienceMode, "planned");
assert.equal(invitation.invitationRequested, true);
assert.equal(invitation.speechAct, "invitation");
const invitationFallback = buildFallbackSocialCopyResponse(invitation);
assert.match(invitationFallback.socialCopy?.variants[0].text ?? "", /一起|同行|人/u);
assert.doesNotMatch(invitationFallback.socialCopy?.variants[0].text ?? "", /走过|这次从/u);

const planOnly = buildSocialCopyBrief("把刚才的计划写成朋友圈文案", route);
assert.equal(planOnly.experienceMode, "visited", "‘计划’是被引用的路线对象，不应自动切换为邀约口吻");
assert.equal(planOnly.speechAct, "actual_share");

const explicitPlanShare = buildSocialCopyBrief(
  "请用参考写法写朋友圈计划分享，只迁移节奏和留白",
  route
);
assert.equal(explicitPlanShare.experienceMode, "planned", "显式要求‘计划分享’时必须使用计划口吻");
assert.equal(explicitPlanShare.speechAct, "plan_share");

const cinematic = buildSocialCopyBrief("把刚才的香港路线写成王家卫特色的朋友圈文案", route);
assert.equal(cinematic.selectedCase.id, "cinematic-fragment");
assert.match(cinematic.styleProfile.rawText, /王家卫/u);

const reference = buildSocialCopyBrief(
  "按这段声口写路线文案：<style_reference>路走了一半，风先替我们拐了弯。剩下的，明天再说。</style_reference>",
  route
);
assert.equal(reference.styleProfile.source, "reference");
assert.equal(reference.referenceSamples.length, 1);

const xhs = buildSocialCopyBrief("把这条计划写成小红书轻攻略，短一点", route);
const xhsFallback = buildFallbackSocialCopyResponse(xhs);
assert.equal(xhs.platform, "xiaohongshu");
assert.equal(xhs.selectedCase.id, "light-guide");
assert.ok(xhsFallback.socialCopy?.variants.every((variant) => variant.hashtags.length <= 4));

const lowQuality: IntentResponsePayload = {
  title: "文案",
  answer: "完成",
  sections: [],
  socialCopy: {
    basedOnRoute: true,
    variants: [
      { tone: "版本 A", text: "家人们谁懂，这条路线一定要收藏！", hashtags: ["爆款"] },
      { tone: "版本 B", text: "第一站中环街市，第二站大馆，第三站坚尼地城海旁。", hashtags: [] }
    ]
  }
};
const repaired = finalizeSocialCopyResponse(lowQuality, custom);
assert.equal(repaired.socialCopy?.styleProfile?.label, custom.styleProfile.label);
assert.deepEqual(
  repaired.socialCopy?.variants.map((variant) => variant.tone),
  custom.variantPlans.map((plan) => plan.label)
);
assertGrounded(repaired.socialCopy!.variants.map((variant) => variant.text), route.stops.map((stop) => stop.name));
assert.ok(repaired.socialCopy?.variants.every((variant) => variant.hashtags.length === 0));

const diagnosticRepair = finalizeSocialCopyResponseWithDiagnostics(lowQuality, custom);
assert.equal(diagnosticRepair.diagnostics.fallbackTriggered, true);
assert.equal(diagnosticRepair.diagnostics.fallbackVariants[0].originalText, lowQuality.socialCopy?.variants[0].text);
assert.ok(diagnosticRepair.diagnostics.fallbackVariants[0].reasons.length > 0);

assert.ok(hardConstraintIssues("从中环街市走到坚尼地城海旁，走完才发现，今天喜欢的是这段过渡本身。", custom, 0).some((issue) => /设计术语/u.test(issue)));
assert.equal(hardConstraintIssues("中环街市逛完，一路晃到坚尼地城海旁。旧楼还在身后，海风已经先到了。", custom, 0).length, 0);
assert.equal(hardConstraintIssues("从旧城走到海边，路线很乖，我也很乖。", custom, 1).length, 0);
assert.equal(hardConstraintIssues("计划很努力，我也确实没听它的。", custom, 1).length, 0);
assert.equal(hardConstraintIssues("走到海边那一刻，觉得这210分钟挺值。", custom, 1).length, 0);
assert.equal(hardConstraintIssues("中环街市起步，海边收尾，中间没走丢。", custom, 1).length, 0);
assert.ok(custom.evidence.safeInferences.some((item) => /海风/u.test(item)));
assert.ok(custom.evidence.safeInferences.some((item) => /旧楼/u.test(item)));
assert.ok(custom.evidence.safeInferences.some((item) => /海边.*坐一会|坐一会.*海边/u.test(item)));
assert.equal(
  hardConstraintIssues("在坚尼地城海旁坐下吹了会儿海风，回来才发现今天走得比计划慢。", custom, 0).length,
  0,
  "滨海地点的坐下、停留和海风应属于 demo 文案的低风险创作许可"
);
assert.equal(hardConstraintIssues("周末想从中环街市走到坚尼地城海边，有人一起吗？", invitation, 1).length, 0);
assert.equal(hardConstraintIssues("从中环街市到海边，三小时。", custom, 1).some((issue) => /时长/u.test(issue)), false, "半小时级别的朋友圈约数可以接受");
assert.ok(hardConstraintIssues("从中环街市到海边，两小时。", custom, 1).some((issue) => /时长/u.test(issue)));
assert.equal(hardConstraintIssues("从中环街市到海边，三个半小时。", custom, 1).some((issue) => /时长/u.test(issue)), false);
assert.ok(hardConstraintIssues("周末想去香港，想有人一起看。", invitation, 1).some((issue) => /可以回应/u.test(issue)));
assert.ok(hardConstraintIssues("在大馆排队四十分钟，买票花了80元。", custom, 0).some((issue) => /精确事件/u.test(issue)));
assert.ok(hardConstraintIssues("店员说今天临时闭馆。", custom, 0).some((issue) => /精确事件/u.test(issue)));

const creativeRoute = {
  title: "书店与公园慢走",
  routeOverview: { title: "书店与公园慢走", city: "南京" },
  totalEstimatedMinutes: 120,
  constraints: { city: "南京" },
  stops: [
    { name: "先锋书店", category: "书店", reason: "阅读空间", suitabilityTags: ["慢逛"] },
    { name: "玄武湖公园", category: "公园", reason: "湖边绿地", suitabilityTags: ["休息"] }
  ]
} as unknown as PlanningResult;
const creativeBrief = buildSocialCopyBrief("把刚才路线写成自然一点的朋友圈文案", creativeRoute);
assert.ok(creativeBrief.evidence.safeInferences.some((item) => /翻书/u.test(item)));
assert.ok(creativeBrief.evidence.safeInferences.some((item) => /公园.*坐一会/u.test(item)));
assert.equal(
  hardConstraintIssues("在先锋书店翻了几页书，又去玄武湖公园找地方坐了一会，回来以后还觉得这个下午很舒服。", creativeBrief, 0).length,
  0,
  "书店翻书和公园坐一会应视为与场景匹配的合理体验补充"
);

const plausibleSocialCopy: IntentResponsePayload = {
  title: "文案",
  answer: "",
  sections: [],
  socialCopy: {
    basedOnRoute: true,
    variants: [
      { tone: "完整版", text: "中环街市逛完，一路晃到坚尼地城海旁。旧楼还在身后，海风已经先到了。", hashtags: [] },
      { tone: "简短版", text: "从旧城晃到海边，海风先到了。", hashtags: [] }
    ]
  }
};
const plausibleReview = {
  variants: [0, 1].map((variantIndex) => ({
    variantIndex,
    selectedCandidateIndex: variantIndex,
    pass: false,
    scores: { groundedness: 7, naturalness: 7, speechAct: 7, styleFit: 7, shareability: 7 },
    issues: ["评审主观认为画面略多"]
  }))
};
const plausibleFinal = finalizeSocialCopyResponseWithDiagnostics(plausibleSocialCopy, custom, plausibleReview);
assert.equal(plausibleFinal.diagnostics.fallbackTriggered, false, "合理叙事和场景推断不能因主观评分触发模板覆盖");
assert.match(plausibleFinal.response.socialCopy?.variants[0].text ?? "", /逛完.*海风/u);

const suppliedEvidence = buildSocialCopyBrief(
  "根据随身记录写朋友圈：<walk_record>在大馆坐了四十分钟，原计划完全没执行。</walk_record> 写得清醒克制但有点好笑",
  route
);
assert.equal(suppliedEvidence.evidence.level, "walk_record");
assert.match(suppliedEvidence.evidence.suppliedFragments.join(" "), /大馆坐了四十分钟/u);

console.log("PASS social copy: default actual voice / explicit invitation / full+concise / open style / anti-summary gate");
