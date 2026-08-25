import assert from "node:assert/strict";
import { normalizeAiPlan } from "../src/services/journalLayoutService";
import { JournalLayoutRequest, JournalLayoutResponse } from "../src/types/journal";

const input: JournalLayoutRequest = {
  title: "路线叙事顺序测试",
  narrativeMode: "route-journey",
  blocks: [
    { id: "a", kind: "photo-text", title: "第一站", text: "a", journeyOrder: 0, journeyMomentId: "m1" },
    { id: "b", kind: "photo-text", title: "第二站", text: "b", journeyOrder: 1, journeyMomentId: "m2" },
    { id: "c", kind: "photo-text", title: "第二站分支", text: "c", journeyOrder: 1, journeyMomentId: "m2", journeyBranch: true },
    { id: "d", kind: "photo-text", title: "第三站", text: "d", journeyOrder: 2, journeyMomentId: "m3" }
  ]
};

const response: JournalLayoutResponse = {
  mode: "ai",
  aiCaption: "测试",
  spreads: [
    {
      id: "scrambled_1", blockIds: ["d", "a"], recipe: "dual-panel", anchorPage: "split",
      placements: [
        { blockId: "d", page: "left", x: 10, y: 30, width: 62, rotation: -1, zIndex: 1, textPlacement: "right", photoTreatment: "natural", tapePosition: "upper-left" },
        { blockId: "a", page: "right", x: 12, y: 31, width: 62, rotation: 1, zIndex: 2, textPlacement: "left", photoTreatment: "natural", tapePosition: "upper-right" }
      ],
      accent: "cobalt", headline: "乱序一", microtext: "TEST", rationale: "模型乱序"
    },
    {
      id: "scrambled_2", blockIds: ["c", "b"], recipe: "irregular-cutout", anchorPage: "split",
      placements: [
        { blockId: "c", page: "left", x: 10, y: 28, width: 62, rotation: -1, zIndex: 1, textPlacement: "right", photoTreatment: "natural", tapePosition: "upper-left" },
        { blockId: "b", page: "right", x: 12, y: 29, width: 62, rotation: 1, zIndex: 2, textPlacement: "left", photoTreatment: "natural", tapePosition: "upper-right" }
      ],
      accent: "tomato", headline: "乱序二", microtext: "TEST", rationale: "模型乱序"
    }
  ]
};

const normalized = normalizeAiPlan(input, response);
assert.deepEqual(normalized.spreads.map((spread) => spread.blockIds), [["a"], ["b", "c"], ["d"]]);
assert.deepEqual(normalized.spreads.flatMap((spread) => spread.blockIds), ["a", "b", "c", "d"]);
assert.ok(normalized.spreads.every((spread) => spread.blockIds.length === 1
  ? spread.placements?.length === 1
  : spread.placements?.[0].page === "left" && spread.placements?.[1].page === "right"));
assert.ok(normalized.spreads.flatMap((spread) => spread.placements ?? []).every((placement) => placement.photoTreatment === "natural"));
console.log("PASS journal journey: scrambled AI output is regrouped into chronological route spreads");
