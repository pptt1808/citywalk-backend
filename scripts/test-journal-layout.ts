import assert from "node:assert/strict";

process.env.DEEPSEEK_API_KEY = "";
process.env.DEEPSEEK_FLASH_API_KEY = "";
process.env.DEEPSEEK_PRO_API_KEY = "";
process.env.DS_ = "";
process.env.DEEPSEEK_V3_API_KEY = "";
process.env.DSV4PRO_API_KEY = "";
process.env.ARK_API_KEY = "";
process.env.VOLCENGINE_ARK_API_KEY = "";

async function main() {
  const { JournalLayoutService } = await import("../src/services/journalLayoutService");
  const result = await new JournalLayoutService().generate({
    title: "上下错落回归测试",
    blocks: [
      { id: "a", kind: "photo-text", renderMode: "gathered-collage", title: "左页照片", text: "左页文字", orientation: "portrait" },
      { id: "b", kind: "photo-text", renderMode: "cutout-illustration", title: "右页照片", text: "右页文字", orientation: "portrait" },
      { id: "c", kind: "photo-text", title: "第二跨页左图", text: "第二跨页左文", orientation: "landscape" },
      { id: "d", kind: "text", title: "第二跨页右文", text: "一段纯文字内容" }
    ]
  });

  assert.equal(result.spreads.length, 2);
  const first = result.spreads[0].placements ?? [];
  const second = result.spreads[1].placements ?? [];
  assert.equal(first.length, 2);
  assert.equal(second.length, 2);
  assert.ok(Math.abs(first[0].y - first[1].y) >= 8, "同一跨页的左右图文簇必须上下错落");
  assert.ok(Math.abs(second[0].y - second[1].y) >= 8, "每个双内容跨页都必须保留纵向节奏");
  assert.ok(first[0].y < first[1].y, "首个跨页应左高右低");
  assert.ok(second[0].y > second[1].y, "相邻跨页应交替为左低右高");
  assert.ok([...first, ...second].every((placement) => placement.y >= 20 && placement.y <= 50));
  assert.equal(first[0].tapePosition, "none", "拾景拼贴不得附加胶带");
  assert.equal(first[1].tapePosition, "none", "透明轮廓插画不得附加胶带");
  assert.notEqual(first[0].textPlacement, "overlay", "拾景拼贴文字不得覆盖图像");
  assert.notEqual(first[1].textPlacement, "overlay", "透明轮廓插画文字不得覆盖图像");

  console.log("PASS journal layout: paired blocks keep rhythm and generated art stays non-overlapping");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
