import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { env } from "../src/config/env";
import { walkSessionStore } from "../src/services/walkSessionStore";

const username = process.argv[2]?.trim();
const resetActive = process.argv.includes("--reset-active");
if (!username) {
  throw new Error("用法：npm run seed:mobile-route -- <username>");
}

const authDb = new Database(path.resolve(process.cwd(), env.AUTH_DB_PATH), { readonly: true });
const user = authDb.prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE")
  .get(username) as { id: string; username: string } | undefined;
authDb.close();

if (!user) throw new Error(`没有找到账号：${username}`);

if (resetActive) {
  const active = walkSessionStore.getActive<{ id: string }>(user.id);
  if (active) walkSessionStore.finish(user.id, active.walk.id);
}

const route = {
  responseKind: "route" as const,
  title: "南京老城南：巷子、园林与夜色",
  summary: "从武定门出发，在老城南用约两小时慢慢穿过园林、旧巷和城墙下的夜色。",
  totalEstimatedCost: 36,
  totalEstimatedMinutes: 125,
  startLocation: "118.788120,32.018240",
  constraints: {
    city: "南京",
    startPoint: "武定门地铁站",
    durationMinutes: 125,
    budget: 80,
    preferences: ["老街", "园林", "夜景", "轻松步行"],
    peopleCount: 1,
    party: { total: 1, mobilityNeeds: [] },
    experience: { pace: "relaxed", restStopRequired: true, avoidCrowds: true },
    accessibility: {},
    style: {
      rawText: "年轻人喜欢的老城南松弛感路线",
      summary: "旧巷烟火与园林夜色",
      tags: [{ name: "老城松弛感", weight: 0.9 }, { name: "夜色", weight: 0.75 }],
      desiredScenes: [{ description: "有生活气的旧巷和不过度商业化的街角", importance: 0.9 }],
      avoidances: ["赶景点", "长距离折返"],
      searchHints: ["老城南", "园林", "城墙"],
      narrativeArc: ["从城门进入旧城", "在园林里放慢", "穿过生活巷道", "在城墙夜色收尾"],
      confidence: 0.92
    },
    constraintLedger: [],
    transportMode: "walk"
  },
  routeOverview: {
    title: "南京老城南：巷子、园林与夜色",
    city: "南京",
    startPoint: "武定门地铁站",
    endPoint: "老门东牌坊",
    stopCount: 4,
    partyLabel: "1 人轻松漫步",
    time: { totalMinutes: 125, travelMinutes: 35, stayMinutes: 90 },
    cost: { total: 36, perPerson: 36, budget: 80 },
    weather: {
      summary: "体验路线未锁定出发日期，请以手机当天实况为准",
      risk: "low",
      rainProbability: 0,
      advice: ["穿适合石板路的鞋", "晚间注意城墙附近照明"]
    },
    importantNotes: ["全程约 2.8 公里", "愚园可坐下休息", "任意时刻都可以用“改路线”缩短剩余行程"]
  },
  stops: [
    {
      name: "武定门地铁站 3 号口",
      category: "sight" as const,
      estimatedCost: 0,
      estimatedStayMinutes: 5,
      reason: "定位清晰、适合测试自动到站和开始记录。",
      location: "118.788120,32.018240",
      address: "秦淮区长乐路与江宁路附近",
      city: "南京",
      suitabilityTags: ["地铁直达", "起点明确"]
    },
    {
      name: "愚园",
      category: "park" as const,
      estimatedCost: 18,
      estimatedStayMinutes: 35,
      reason: "园林空间安静，有亭廊和座椅，可以体验到站、拍照与文字记录。",
      location: "118.780520,32.019530",
      address: "秦淮区集庆路胡家花园 1 号",
      city: "南京",
      suitabilityTags: ["可休息", "适合拍照", "慢节奏"]
    },
    {
      name: "小西湖历史风貌区",
      category: "sight" as const,
      estimatedCost: 18,
      estimatedStayMinutes: 30,
      reason: "旧巷、社区小店和新旧建筑交错，适合测试沿途临时记录与路线调整。",
      location: "118.784250,32.021520",
      address: "秦淮区马道街小西湖片区",
      city: "南京",
      suitabilityTags: ["街巷探索", "咖啡休息", "年轻氛围"]
    },
    {
      name: "老门东牌坊",
      category: "sight" as const,
      estimatedCost: 0,
      estimatedStayMinutes: 20,
      reason: "夜间氛围完整，适合作为结束点并体验完成同步。",
      location: "118.788860,32.022460",
      address: "秦淮区剪子巷 54 号",
      city: "南京",
      suitabilityTags: ["夜景", "公共交通方便", "终点明确"]
    }
  ],
  routeLegs: [
    { origin: "118.788120,32.018240", destination: "118.780520,32.019530", originName: "武定门地铁站 3 号口", destinationName: "愚园", distanceMeters: 1050, durationMinutes: 14, mode: "walk" as const, estimated: true },
    { origin: "118.780520,32.019530", destination: "118.784250,32.021520", originName: "愚园", destinationName: "小西湖历史风貌区", distanceMeters: 650, durationMinutes: 9, mode: "walk" as const, estimated: true },
    { origin: "118.784250,32.021520", destination: "118.788860,32.022460", originName: "小西湖历史风貌区", destinationName: "老门东牌坊", distanceMeters: 800, durationMinutes: 12, mode: "walk" as const, estimated: true }
  ],
  decisionLog: [
    "把首站设为地铁口，方便模拟器或真机快速建立定位。",
    "路线只保留四站，便于完整体验记录、改路和结束同步。"
  ]
};

const handoff = walkSessionStore.saveHandoff(user.id, {
  id: `handoff_${randomUUID().replace(/-/gu, "").slice(0, 20)}`,
  route,
  source: "demo",
  createdAt: new Date().toISOString()
});

console.log(`已为 ${user.username} 投递路线：${route.title}`);
console.log(`接力编号：${handoff.id}；${route.stops.length} 站，约 ${route.totalEstimatedMinutes} 分钟。`);
if (resetActive) console.log("旧的进行中路线已清理，本次从待领取状态开始。")
