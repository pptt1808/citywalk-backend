import assert from "node:assert/strict";
import { buildPromptSuggestions } from "../frontend/src/utils/promptSuggestions";
import type { FavoriteRoute, MemoryItem, PlanningResult } from "../frontend/src/api/agent";

const route = {
  responseKind: "route",
  title: "香港胶片街巷路线",
  stops: [
    { name: "中环街市", category: "mall" },
    { name: "大馆", category: "museum" },
    { name: "坚尼地城海旁", category: "sight" }
  ],
  constraints: { city: "香港" },
  routeOverview: { city: "香港" }
} as unknown as PlanningResult;

const memories = [
  {
    id: "m1", userId: "u1", kind: "semantic", key: "preference:category:咖啡",
    text: "喜欢咖啡", data: { category: "咖啡" }, polarity: "positive", confidence: .82,
    source: "system_observed", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  },
  {
    id: "m2", userId: "u1", kind: "procedural", key: "planning:experience",
    text: "喜欢轻松路线", data: { pace: "relaxed", restStopRequired: true }, polarity: "neutral", confidence: .7,
    source: "system_observed", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
] as MemoryItem[];
const favorites = [{ id: "f1", userId: "u1", createdAt: new Date().toISOString(), result: route }] as FavoriteRoute[];

const starter = buildPromptSuggestions({ memories: [], favorites: [], history: [], now: new Date("2026-08-09T09:00:00+08:00") });
assert.equal(starter.length, 3);
assert.ok(starter.every(item => !item.text.includes("南京")), "通用推荐不能写死城市");

const personalized = buildPromptSuggestions({ memories, favorites, history: [], now: new Date("2026-08-09T19:00:00+08:00") });
assert.equal(personalized.length, 3);
assert.ok(personalized[0].text.includes("香港") && personalized[0].text.includes("咖啡"));
assert.ok(personalized.some(item => item.basis === "route" && item.text.includes("不要擅自换城市")));
assert.ok(personalized.some(item => item.basis === "moment" && item.label === "今晚走走"));

console.log("PASS prompt suggestions: no fixed city / memory taste / favorite variation / time scene");
