import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareGeneratedIllustration } from "../src/services/journalIllustrationService";
import { createFallbackJournalZineAnalysis } from "../src/services/journalZineAnalysisService";
import { compileJournalZinePrompt, JOURNAL_ZINE_WORKFLOWS } from "../src/services/journalZinePromptCompiler";
import { JournalIllustrationRequest } from "../src/types/journal";

const input: JournalIllustrationRequest = {
  sourceImage: "data:image/png;base64,AA==",
  blockId: "block_test",
  photoId: "photo_test",
  city: "香港",
  title: "雨后电车",
  text: "保留可编辑的现场文字",
  styleDescription: "旧报纸的松动钢笔线与少量暗红"
};

const distilled = compileJournalZinePrompt(input, "distilled-contour", createFallbackJournalZineAnalysis("distilled-contour"));
assert.equal(distilled.skill, "scene-distillation-zine");
assert.equal(distilled.version, "v1.3");
assert.match(distilled.prompt, /scene-distillation-zine-v1-3/u);
assert.match(distilled.prompt, /不得复制、嵌入、裁切、拼贴、描摹或保留任何摄影像素/u);
assert.match(distilled.prompt, /68%-85%/u);
assert.match(distilled.prompt, /独立、可编辑的 DOM 层/u);
assert.match(distilled.prompt, /Visual Card: safe fallback/u);

const gathered = compileJournalZinePrompt(input, "gathered-collage", createFallbackJournalZineAnalysis("gathered-collage"));
assert.equal(gathered.skill, "scenes-gathered-zine");
assert.equal(gathered.version, "v1.3");
assert.match(gathered.prompt, /scenes-gathered-zine-v1-3/u);
assert.match(gathered.prompt, /一个真实照片锚点/u);
assert.match(gathered.prompt, /手工纤维撕边/u);
assert.match(gathered.prompt, /完整的不透明 PNG/u);
assert.match(gathered.prompt, /严禁生成任何文字/u);

assert.deepEqual(Object.keys(JOURNAL_ZINE_WORKFLOWS).sort(), ["distilled-contour", "gathered-collage"]);

async function verifyPostProcessing() {
  const source = await sharp({
    create: { width: 80, height: 80, channels: 4, background: { r: 244, g: 240, b: 230, alpha: 1 } }
  }).composite([{ input: Buffer.from(`<svg width="80" height="80"><circle cx="40" cy="40" r="18" fill="#9d341d"/></svg>`) }]).png().toBuffer();
  const cutout = await prepareGeneratedIllustration(source, "distilled-contour");
  const gatheredOutput = await prepareGeneratedIllustration(source, "gathered-collage");
  assert.equal((await sharp(cutout).metadata()).hasAlpha, true, "轮廓模式必须输出透明通道");
  assert.notEqual((await sharp(gatheredOutput).metadata()).hasAlpha, true, "拾景模式必须保留不透明纸面");
  console.log("PASS journal zine: both v1.3 workflows compile prompts and preserve distinct alpha behavior");
}

verifyPostProcessing().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
