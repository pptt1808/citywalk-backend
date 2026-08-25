import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareGeneratedIllustration } from "../src/services/journalIllustrationService";
import { createFallbackJournalZineAnalysis } from "../src/services/journalZineAnalysisService";
import { compileJournalZinePrompt, JOURNAL_ZINE_WORKFLOWS } from "../src/services/journalZinePromptCompiler";
import { JOURNAL_GENERATABLE_ILLUSTRATION_MODES, JournalIllustrationRequest } from "../src/types/journal";

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
assert.equal(distilled.skill, "scene-distillation-zine-v1-3");
assert.equal(distilled.version, "v1.3");
assert.equal(distilled.prompt.split(/\n\n/u).length, 6, "场景蒸馏必须编译为说明头和五个紧凑段落");
assert.match(distilled.prompt, /scene-distillation-zine-v1-3/u);
assert.match(distilled.prompt, /竖版 3:5/u);
assert.match(distilled.prompt, /68%-85%/u);
assert.match(distilled.prompt, /12%-32%/u);
assert.match(distilled.prompt, /65%-90%/u);
assert.match(distilled.prompt, /2-4 个源锚点/u);
assert.match(distilled.prompt, /0\.8%-3%/u);
assert.match(distilled.prompt, /Do not reproduce, embed, crop, collage, trace, or retain photographic pixels or photorealistic regions from the reference\./u);
assert.match(distilled.prompt, /The final image must contain original illustration, paper, and typography only\./u);
assert.match(distilled.prompt, /标题与正文必须继续可编辑/u);
assert.doesNotMatch(distilled.prompt, /允许选择 fragment、photo crop/u);

const landscapeAnalysis = {
  ...createFallbackJournalZineAnalysis("distilled-contour"),
  sourceOrientation: "landscape" as const
};
const landscape = compileJournalZinePrompt(input, "distilled-contour", landscapeAnalysis);
assert.match(landscape.prompt, /横版 5:3/u);

const solidColorBlock = compileJournalZinePrompt(
  { ...input, stylePresetId: "solid-color-block", styleDescription: "用一块番茄红承载雨后的停顿" },
  "distilled-contour",
  createFallbackJournalZineAnalysis("distilled-contour")
);
assert.match(solidColorBlock.prompt, /Solid Color-Block Mode/u);
assert.match(solidColorBlock.prompt, /Use exactly one contiguous/u);
assert.match(solidColorBlock.prompt, /3%-12%/u);
assert.match(solidColorBlock.prompt, /不能拆成回声、圆点、条纹或多个色块/u);

const gathered = compileJournalZinePrompt(input, "gathered-collage", createFallbackJournalZineAnalysis("gathered-collage"));
assert.equal(gathered.skill, "gc-minimal-zine-poster-v0-1");
assert.equal(gathered.version, "v0.1");
assert.equal(gathered.prompt.split(/\n\n/u).length, 5, "极简纸刊必须编译为说明头和四个紧凑段落");
assert.match(gathered.prompt, /gc-minimal-zine-poster-v0-1/u);
assert.match(gathered.prompt, /material-redraw/u);
assert.match(gathered.prompt, /竖版 3:5/u);
assert.match(gathered.prompt, /lower-left-float/u);
assert.match(gathered.prompt, /重新绘制的旧印刷插图/u);
assert.match(gathered.prompt, /复印柔化/u);
assert.match(gathered.prompt, /phrase-against-image-edge/u);
assert.match(gathered.prompt, /memory 情绪/u);
assert.match(gathered.prompt, /Reference image is semantic evidence only/u);
assert.match(gathered.prompt, /严禁完整或局部原图/u);
assert.doesNotMatch(gathered.prompt, /允许且只允许一个经过主动裁切/u);
assert.match(gathered.prompt, /70%-90%/u);
assert.match(gathered.prompt, /8%-25%/u);
assert.match(gathered.prompt, /0\.8%-2\.5%/u);
assert.match(gathered.prompt, /平放扫描/u);
assert.match(gathered.prompt, /图片内不要生成文字/u);
assert.doesNotMatch(gathered.prompt, /最终绝不能保留、裁切、拼贴/u);

const oldPrint = compileJournalZinePrompt(
  { ...input, stylePresetId: "old-print-illustration" },
  "gathered-collage",
  createFallbackJournalZineAnalysis("gathered-collage")
);
assert.match(oldPrint.prompt, /material-redraw/u);
assert.match(oldPrint.prompt, /由源图主体重新绘制的旧印刷插图/u);
assert.match(oldPrint.prompt, /Do not reproduce, embed, crop, collage, trace, retain, or frame any photographic pixels/u);

const silhouette = compileJournalZinePrompt(
  { ...input, stylePresetId: "flat-silhouette" },
  "gathered-collage",
  createFallbackJournalZineAnalysis("gathered-collage")
);
assert.match(silhouette.prompt, /从照片主体关系提炼出的平面剪影/u);

const photoFragment = compileJournalZinePrompt(
  { ...input, stylePresetId: "xerox-photo-fragment" },
  "gathered-collage",
  createFallbackJournalZineAnalysis("gathered-collage")
);
assert.match(photoFragment.prompt, /explicit-photo-fragment/u);
assert.match(photoFragment.prompt, /允许且只允许一个经过主动裁切/u);
assert.match(photoFragment.prompt, /灰阶复印、半调退化、缺墨与不规则纤维撕边/u);
assert.doesNotMatch(photoFragment.prompt, /Reference image is semantic evidence only/u);

assert.deepEqual(Object.keys(JOURNAL_ZINE_WORKFLOWS).sort(), ["distilled-contour", "gathered-collage"]);
assert.deepEqual(
  [...JOURNAL_GENERATABLE_ILLUSTRATION_MODES],
  ["distilled-contour"],
  "产品只允许场景蒸馏生成新插画"
);

async function verifyPostProcessing() {
  const source = await sharp({
    create: { width: 80, height: 80, channels: 4, background: { r: 244, g: 240, b: 230, alpha: 1 } }
  }).composite([{ input: Buffer.from(`<svg width="80" height="80"><circle cx="40" cy="40" r="18" fill="#9d341d"/></svg>`) }]).png().toBuffer();
  const cutout = await prepareGeneratedIllustration(source, "distilled-contour");
  const gatheredOutput = await prepareGeneratedIllustration(source, "gathered-collage");
  assert.equal((await sharp(cutout).metadata()).hasAlpha, true, "轮廓模式必须输出透明通道");
  assert.notEqual((await sharp(gatheredOutput).metadata()).hasAlpha, true, "拾景模式必须保留不透明纸面");
  console.log("PASS journal zine: scene-distillation is the sole active workflow; legacy minimal assets remain render-compatible");
}

verifyPostProcessing().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
