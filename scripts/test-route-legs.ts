import assert from "node:assert/strict";

process.env.AMAP_KEY = "route-leg-test-key";
process.env.DEEPSEEK_API_KEY = "";
process.env.DEEPSEEK_FLASH_API_KEY = "";
process.env.DEEPSEEK_PRO_API_KEY = "";

async function main() {
  const [{ MapTool }, { env }, routeLegService] = await Promise.all([
    import("../src/tools/mapTool"),
    import("../src/config/env"),
    import("../src/services/routeLegService")
  ]);
  env.AMAP_KEY = "route-leg-test-key";

  const map = new MapTool();
  (map as unknown as {
    fetchAmap: (path: string) => Promise<unknown>;
  }).fetchAmap = async (path: string) => {
    if (path.includes("transit")) return { route: { transits: [] } };
    if (path.includes("walking")) return { route: { paths: [{ distance: "560", duration: "420" }] } };
    throw new Error(`unexpected test path: ${path}`);
  };

  const transitFallback = await map.planRoute("121.458744,31.215150", ["121.457341,31.220033"], "transit", "上海");
  assert.equal(transitFallback.length, 1);
  assert.equal(transitFallback[0].mode, "walk", "近距离无公交方案时应使用真实步行路径");
  assert.equal(transitFallback[0].distanceMeters, 560);
  assert.equal(transitFallback[0].durationMinutes, 7);
  assert.match(transitFallback[0].fallbackReason ?? "", /改用步行/u);

  const providerLegs = [
    {
      origin: "121.458744,31.215150",
      destination: "121.457341,31.220033",
      distanceMeters: 0,
      durationMinutes: 1,
      mode: "transit" as const
    },
    {
      origin: "121.457341,31.220033",
      destination: "121.462200,31.222300",
      distanceMeters: 0,
      durationMinutes: 1,
      mode: "transit" as const
    },
    {
      origin: "121.462200,31.222300",
      destination: "121.475000,31.230000",
      distanceMeters: 1601,
      durationMinutes: 16,
      mode: "transit" as const
    }
  ];
  const completed = routeLegService.completeRouteLegs(
    "121.458744,31.215150",
    ["121.457341,31.220033", "121.462200,31.222300", "121.475000,31.230000"],
    providerLegs
  );
  assert.equal(completed.length, 3, "部分有效的响应也必须逐段补齐");
  assert.equal(completed[0].estimated, true);
  assert.ok(completed[0].distanceMeters > 0 && completed[0].durationMinutes > 1);
  assert.equal(completed[1].estimated, true);
  assert.ok(completed[1].distanceMeters > 0 && completed[1].durationMinutes > 1);
  assert.equal(completed[2].distanceMeters, 1601, "真实的有效路段不能被兜底覆盖");
  assert.equal(completed[2].estimated, undefined);
  assert.ok(!completed.some((leg) => leg.distanceMeters === 0 && leg.durationMinutes === 1));

  const samePlace = routeLegService.completeRouteLegs(
    "118.786000,32.040000",
    ["118.786000,32.040000"],
    [{
      origin: "118.786000,32.040000",
      destination: "118.786000,32.040000",
      distanceMeters: 0,
      durationMinutes: 1,
      mode: "transit"
    }]
  );
  assert.equal(samePlace.length, 1);
  assert.equal(samePlace[0].samePlaceTransfer, true);
  assert.equal(samePlace[0].distanceMeters, 0);
  assert.equal(samePlace[0].durationMinutes, 0, "同一地点应显示场馆内移动，而不是虚假的 0m/1分钟");

  console.log("route leg fallback tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
