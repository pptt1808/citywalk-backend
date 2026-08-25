import assert from "node:assert/strict";

for (const key of [
  "AMAP_KEY", "QWEATHER_KEY", "HEFENG_KEY", "TAVILY_API_KEY", "DS_", "DEEPSEEK_API_KEY",
  "DEEPSEEK_FLASH_API_KEY", "DEEPSEEK_PRO_API_KEY", "DEEPSEEK_V3_API_KEY",
  "DSV4PRO_API_KEY", "EMBEDDING_API_KEY"
]) process.env[key] = "";

async function main() {
  const [{ UrbanPulseAgent }, { MapTool }, { WeatherTool }] = await Promise.all([
    import("../src/agents/urbanPulseAgent"),
    import("../src/tools/mapTool"),
    import("../src/tools/weatherTool")
  ]);
  type Poi = import("../src/tools/mapTool").Poi;
  type PoiSearchOptions = import("../src/tools/mapTool").PoiSearchOptions;
  type AgentSkillInput = import("../src/types/plan").AgentSkillInput;

  const candidates: Poi[] = [
    { name: "新街口热门打卡广场", category: "sight", averageCost: 0, location: "118.781,32.041", city: "南京", address: "中山路", rating: 4.9, distanceMeters: 260, tags: ["网红打卡", "游客扎堆", "热门景区"] },
    { name: "山顶旧塔", category: "sight", averageCost: 10, location: "118.790,32.052", city: "南京", address: "北坡路", rating: 4.8, distanceMeters: 900, tags: ["登山", "仅楼梯", "台阶较多"] },
    { name: "先锋独立书店", category: "bookstore", averageCost: 20, location: "118.784,32.044", city: "南京", address: "广州路", rating: 4.4, distanceMeters: 650, indoor: true, tags: ["独立书店", "人文", "阅读"] },
    { name: "城市美术馆", category: "museum", averageCost: 30, location: "118.788,32.046", city: "南京", address: "长江路", rating: 4.5, distanceMeters: 780, indoor: true, tags: ["当代艺术", "展览", "建筑"] },
    { name: "梧桐旧街巷", category: "street_scene", averageCost: 0, location: "118.793,32.047", city: "南京", address: "颐和路", rating: 4.2, distanceMeters: 1000, tags: ["老街巷", "民国建筑", "城市肌理"] },
    { name: "秦淮河岸步道", category: "street_scene", averageCost: 0, location: "118.797,32.042", city: "南京", address: "河岸路", rating: 4.3, distanceMeters: 1200, tags: ["水岸", "滨水步道", "开阔"] },
    { name: "绿博园湿地", category: "park", averageCost: 0, location: "118.765,32.031", city: "南京", address: "扬子江大道", rating: 4.4, distanceMeters: 1700, tags: ["湿地", "绿地", "观鸟", "生态"] },
    { name: "社区古着仓", category: "shop", averageCost: 55, location: "118.786,32.039", city: "南京", address: "南台巷", rating: 4.1, distanceMeters: 720, indoor: true, tags: ["古着", "独立小店", "社区"] },
    { name: "巷口甜品铺", category: "cafe", averageCost: 32, location: "118.789,32.038", city: "南京", address: "丰富路", rating: 4.3, distanceMeters: 820, indoor: true, tags: ["甜品", "可坐下", "卫生间"] },
    { name: "中央商业中心", category: "mall", averageCost: 45, location: "118.780,32.043", city: "南京", address: "中山南路", rating: 4.7, distanceMeters: 320, indoor: true, tags: ["商业综合体", "购物中心", "电梯", "无障碍卫生间"] },
    { name: "夜色酒吧", category: "shop", averageCost: 90, location: "118.782,32.039", city: "南京", address: "王府大街", rating: 4.9, distanceMeters: 300, indoor: true, tags: ["酒吧", "成人", "热门"] }
  ];

  const searches: Array<{ keywords: string[]; indoorOnly: boolean }> = [];
  class FakeMapTool extends MapTool {
    override async geocode(name: string): Promise<string> {
      return name.includes("新街口") ? "118.778,32.042" : "118.800,32.050";
    }
    override async searchNearbyPoi(keywords: string[], options: PoiSearchOptions): Promise<Poi[]> {
      searches.push({ keywords: [...keywords], indoorOnly: Boolean(options.indoorOnly) });
      return candidates.filter((poi) => !options.indoorOnly || poi.indoor);
    }
    override async searchPoi(keywords: string[], options: PoiSearchOptions): Promise<Poi[]> {
      return this.searchNearbyPoi(keywords, options);
    }
    override async resolvePoiCandidate(): Promise<Poi | undefined> { return undefined; }
    override async planRoute(origin: string, destinations: string[]) {
      return destinations.map((destination, index) => ({
        origin: index === 0 ? origin : destinations[index - 1],
        destination,
        distanceMeters: 650 + index * 110,
        durationMinutes: 9 + index * 2,
        mode: "walk" as const
      }));
    }
  }
  let weatherRisk: "low" | "medium" | "high" = "low";
  class FakeWeatherTool extends WeatherTool {
    override async getWeatherContext(city: string) {
      return { rainProbability: weatherRisk === "high" ? 80 : weatherRisk === "medium" ? 45 : 10, risk: weatherRisk, decisionUsable: true, forecastKind: "hourly" as const, summary: `${city}${weatherRisk === "low" ? "晴间多云" : "有降雨风险"}`, indices: [] };
    }
  }

  const existingSkills: AgentSkillInput[] = [
    {
      id: "family-friendly", name: "亲子友好",
      description: "用户明确带孩子时，降低连续步行负担，照顾年龄差异和沿途休息。",
      instruction: "仅依据用户本轮明确提供的同行人数与孩子年龄规划；不要自行补全人数或年龄。缩短连续步行，安排可坐下休息、卫生间和安全提示；亲子友好是路线筛选偏好，不要把所有地点改成儿童乐园。",
      applicableIntents: ["route_create"], priority: "preference"
    },
    {
      id: "accessible-rest", name: "轻松休息",
      description: "降低连续行动负担，优先安排可坐下休息和卫生间的停留点。",
      instruction: "采用轻松节奏，缩短连续步行，安排可坐下休息和卫生间；不要把休息条件当作安全设施保证，无法核验时明确标注。",
      applicableIntents: ["route_create"], priority: "requirement"
    },
    {
      id: "wheelchair-access", name: "轮椅无障碍",
      description: "用户明确需要轮椅或无障碍通行时，逐段核验设施并暴露无法确认的风险。",
      instruction: "用户选择此 Skill 表示需要轮椅无障碍通行：要求无台阶、可用电梯和无障碍卫生间，逐段核验入口、坡道与休息条件；无法从地图或公开来源确认时必须明确标注，不得凭地点名称猜测。",
      applicableIntents: ["route_create"], priority: "requirement"
    },
    {
      id: "weather-safe", name: "雨天室内备选",
      description: "选择后在指定时段出现降雨、高温或大风风险时切换室内优先方案。",
      instruction: "选择此 Skill 后，先核对用户指定日期和出发时段的天气；遇到降雨、高温或大风时采用室内优先，准备可执行的替代点并说明切换条件。天气正常时保留户外路线，不要擅自改城市或日期。",
      applicableIntents: ["route_create"], priority: "preference"
    },
    {
      id: "literary-city", name: "文艺城市观察",
      description: "围绕书店、展览、建筑和街巷建立主题联系，保留用户自定义风格。",
      instruction: "把用户的文艺或人文描述拆成可观察场景和地点线索；优先有内容关联的书店、展览、建筑与街巷，减少单纯打卡式串点。解释地点之间的主题联系，不要用“文艺”一词替代具体证据。",
      applicableIntents: ["route_create"], priority: "preference"
    },
    {
      id: "nature-explore", name: "自然探索",
      description: "将绿地、水岸和季节观察组织成有节奏的户外路线。",
      instruction: "优先连续绿地、水岸、湿地或生态观察点，结合日期与天气说明适合观察的内容；保留必要的城市补给点，不要为了“自然”强行删除休息和卫生间。提醒遵守开放区域和环境保护要求。",
      applicableIntents: ["route_create"], priority: "preference"
    },
    {
      id: "local-discovery", name: "在地小众发现",
      description: "用户明确想避开网红或游客扎堆时，寻找有公开线索且可地图核验的小店与街区。",
      instruction: "只有用户明确提出小众、冷门、避开网红或本地生活时才使用长尾发现；优先公开网页线索，再用地图核验名称、地址和坐标。不要把“评分低”当作小众证据，也不要为了小众牺牲安全、营业状态和交通可达性。",
      applicableIntents: ["route_create"], priority: "preference"
    }
  ];

  const agent = new UrbanPulseAgent(new FakeMapTool(), new FakeWeatherTool());
  const task = "请从南京新街口出发，明天下午安排4小时 CityWalk";
  const run = async (skill?: AgentSkillInput) => {
    searches.length = 0;
    const result = await agent.plan({ task, activeSkills: skill ? [skill] : [] });
    return {
      result,
      search: searches.at(-1) ?? { keywords: [], indoorOnly: false }
    };
  };

  const baseline = await run();
  assert.ok(baseline.result.stops.length > 0, "对照组必须生成可比较路线");
  const baselineStops = baseline.result.stops.map((stop) => stop.name);
  const observations: Array<Record<string, unknown>> = [];
  for (const skill of existingSkills) {
    const sample = await run(skill);
    const stops = sample.result.stops.map((stop) => stop.name);
    const routeChanged = JSON.stringify(stops) !== JSON.stringify(baselineStops);
    if (skill.id === "family-friendly") {
      assert.equal(sample.result.constraints.experience.pace, "relaxed");
      assert.equal(sample.result.constraints.experience.restStopRequired, true);
      assert.ok(routeChanged, "亲子 Skill 应改变节奏或最终站点");
    } else if (skill.id === "accessible-rest") {
      assert.equal(sample.result.constraints.experience.pace, "relaxed");
      assert.equal(sample.result.constraints.experience.restStopRequired, true);
      assert.equal(sample.result.constraints.accessibility.wheelchairAccessRequired, undefined, "轻松休息不得误升级为轮椅硬约束");
      assert.ok(routeChanged, "轻松休息 Skill 应改变节奏或最终站点");
    } else if (skill.id === "wheelchair-access") {
      assert.equal(sample.result.constraints.accessibility.wheelchairAccessRequired, true);
      assert.equal(sample.result.constraints.accessibility.stepFreeRequired, true);
      assert.ok(routeChanged, "无障碍 Skill 应改变过滤或最终站点");
    } else if (skill.id === "literary-city") {
      assert.ok(sample.search.keywords.some((keyword) => /书店|展览|街巷/u.test(keyword)));
      assert.ok(routeChanged, "文艺 Skill 应改变主题候选或最终站点");
    } else if (skill.id === "nature-explore") {
      assert.ok(sample.search.keywords.some((keyword) => /湿地|水岸|绿地/u.test(keyword)));
      assert.ok(routeChanged, "自然 Skill 应改变主题候选或最终站点");
    } else if (skill.id === "local-discovery") {
      assert.equal(sample.result.constraints.discoveryMode, "hidden_gems");
      assert.ok(sample.search.keywords.some((keyword) => /古着|独立|社区|菜市场/u.test(keyword)));
      assert.ok(routeChanged, "小众发现 Skill 应改变发现策略或最终站点");
    }
    observations.push({
      skill: skill.id,
      routeChanged,
      stops,
      keywords: sample.search.keywords,
      indoorOnly: sample.search.indoorOnly,
      pace: sample.result.constraints.experience.pace,
      restStop: sample.result.constraints.experience.restStopRequired ?? false,
      wheelchair: sample.result.constraints.accessibility.wheelchairAccessRequired ?? false,
      discoveryMode: sample.result.constraints.discoveryMode,
      execution: sample.result.skillExecutions?.[0]?.status
    });
  }

  // Medium risk is the useful discriminating case: the core planner already
  // forces indoor candidates on high risk, so a weather Skill must add an
  // observable indoor preference before that hard safety threshold.
  weatherRisk = "medium";
  const rainyBaseline = await run();
  const rainySkill = await run(existingSkills.find((skill) => skill.id === "weather-safe"));
  assert.ok(rainySkill.result.constraints.weatherPreference === "avoid_rain", "天气 Skill 应编译成条件性的避雨策略");
  assert.ok(rainySkill.search.indoorOnly, "中风险天气下天气 Skill 应把候选搜索切到室内优先");
  assert.ok(rainySkill.result.stops.some((stop) => stop.category === "mall" || stop.category === "museum" || stop.category === "bookstore" || stop.category === "cafe"), "中风险天气下应保留可执行室内点位");
  observations.push({
    skill: "weather-safe@medium-risk",
    routeChanged: JSON.stringify(rainySkill.result.stops.map((stop) => stop.name)) !== JSON.stringify(rainyBaseline.result.stops.map((stop) => stop.name)),
    baselineStops: rainyBaseline.result.stops.map((stop) => stop.name),
    stops: rainySkill.result.stops.map((stop) => stop.name),
    keywords: rainySkill.search.keywords,
    indoorOnly: rainySkill.search.indoorOnly,
    weatherPreference: rainySkill.result.constraints.weatherPreference
  });

  console.log(JSON.stringify({ baseline: baselineStops, observations }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
