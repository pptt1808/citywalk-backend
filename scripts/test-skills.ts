import assert from "node:assert/strict";
import { buildSkillExecutions, compileAgentSkills } from "../src/services/agentSkillService";

const skills = compileAgentSkills([
  {
    id: "family",
    name: "周末带娃",
    description: "",
    instruction: "亲子友好，轻松慢走，安排休息点和卫生间；路线要核对天气。",
    priority: "requirement",
    applicableIntents: ["route_create"]
  },
  {
    id: "quiet",
    name: "避开网红",
    description: "",
    instruction: "避开拥挤和高峰，优先安静的古着店、书店和街巷。",
    priority: "preference",
    applicableIntents: ["route_create"]
  }
], "route_create");

assert.equal(skills.experience.familyFriendly, true);
assert.equal(skills.experience.pace, "relaxed");
assert.equal(skills.experience.restStopRequired, true);
assert.equal(skills.experience.restroomPreferred, true);
assert.equal(skills.experience.avoidCrowds, true);
assert.equal(skills.party.children, undefined, "Skill 不应在用户未给出人数时擅自发明儿童人数");
assert.equal(skills.discoveryPolicy?.avoidOverexposed, true);
assert.ok(skills.preferences.includes("古着") && skills.preferences.includes("书店"));
assert.ok(skills.requiredTools.includes("weather"));

const executions = buildSkillExecutions(skills, {
  experience: { familyFriendly: true, pace: "intensive" },
  party: { total: 2, mobilityNeeds: [] },
  accessibility: {},
  style: { rawText: "", summary: "", tags: [], desiredScenes: [], avoidances: [], searchHints: [], narrativeArc: [], confidence: 0 },
  discoveryPolicy: { sourcePolicy: "map_only", noveltyPreference: "neutral", avoidOverexposed: true, exposureScopes: ["all"], exposureStrength: "soft" }
} as never);
assert.equal(executions.find(item => item.skillId === "family")?.status, "partially_applied");
assert.ok((executions.find(item => item.skillId === "family")?.overriddenRules.length ?? 0) > 0);

const stroller = compileAgentSkills([{
  id: "stroller", name: "婴儿车同行", instruction: "携带婴儿车时优先无台阶，并安排频繁休息。",
  applicableIntents: ["route_create"]
}], "route_create");
assert.equal(stroller.party.stroller, undefined, "编译器不能把技能描述误当成用户已携带婴儿车");
assert.equal(stroller.accessibility.stepFreeRequired, true);
assert.equal(stroller.accessibility.frequentRestRequired, true);

const counted = compileAgentSkills([{
  id: "counted", name: "带娃规则", instruction: "如果带 2 名孩子，安排可坐下休息的位置。",
  applicableIntents: ["route_create"]
}], "route_create");
assert.equal(counted.party.children, 2);
console.log("PASS skills: structured compilation / intent scope / conflict diagnostics");
