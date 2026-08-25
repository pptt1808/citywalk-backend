import {
  IntentResponsePayload,
  PlanningResult,
  SocialCopyPlatform,
  SocialCopyResult,
  SocialCopyStyleProfile
} from "../types/plan";

type ExperienceMode = "planned" | "visited";
export type SocialCopySpeechAct = "actual_share" | "plan_share" | "invitation";
export type SocialCopyEvidenceLevel = "route_only" | "user_fragments" | "walk_record";
type CopyLengthHint = "short" | "standard" | "long";

interface SocialCopyAngle {
  goal: string;
  candidateDirections: string[];
  anchorOptions: string[];
  forbiddenConversions: string[];
}

interface SocialCopyCase {
  id: string;
  label: string;
  cues: RegExp[];
  signature: SocialCopyStyleProfile["signature"];
  avoidances: string[];
  exemplar: {
    facts: string[];
    text: string;
    transferNotes: string[];
  };
}

export interface SocialCopyBrief {
  platform: SocialCopyPlatform;
  /** Compatibility field for older clients. Prefer speechAct for generation. */
  experienceMode: ExperienceMode;
  invitationRequested: boolean;
  speechAct: SocialCopySpeechAct;
  evidence: {
    level: SocialCopyEvidenceLevel;
    suppliedFragments: string[];
    allowedClaims: string[];
    safeInferences: string[];
    prohibitedClaims: string[];
  };
  lengthHint: CopyLengthHint;
  styleProfile: SocialCopyStyleProfile;
  styleComposition: {
    requestedVoice: string;
    humorRequested: boolean;
    techniqueReferences: Array<{ id: string; label: string }>;
    instruction: string;
  };
  referenceSamples: string[];
  selectedCase: SocialCopyCase["exemplar"] & { id: string; label: string };
  routeFacts: {
    basedOnRoute: boolean;
    title?: string;
    city?: string;
    startPoint?: string;
    totalMinutes?: number;
    stopNames: string[];
    stops: Array<{ name: string; category?: string; reason?: string; highlight?: string; tags: string[] }>;
    pace?: string;
    styleSummary?: string;
  };
  shareAngle: SocialCopyAngle;
  variantPlans: Array<{ label: string; composition: string }>;
  qualityCriteria: string[];
  factualBoundary: string;
}

export interface SocialCopyFallbackVariantDiagnostic {
  variantIndex: number;
  tone: string;
  originalText?: string;
  reasons: string[];
  fallbackText: string;
}

export interface SocialCopyFinalizationDiagnostics {
  fallbackTriggered: boolean;
  fallbackVariants: SocialCopyFallbackVariantDiagnostic[];
  regeneration?: {
    attempted: boolean;
    attempts: number;
    reasons: string[];
    exhausted: boolean;
  };
}

export interface SocialCopySemanticVerdict {
  variantIndex: number;
  selectedCandidateIndex: number;
  pass: boolean;
  scores: {
    groundedness: number;
    naturalness: number;
    speechAct: number;
    styleFit: number;
    shareability: number;
    humorEffect?: number;
  };
  issues: string[];
  revisedText?: string;
}

export interface SocialCopySemanticReview {
  variants: SocialCopySemanticVerdict[];
}

const STYLE_CASES: SocialCopyCase[] = [
  {
    id: "daily-note",
    label: "松弛随记",
    cues: [/松弛/u, /随手/u, /碎碎念/u, /像发给朋友/u, /自然一点/u, /不刻意/u, /日常/u],
    signature: {
      sentenceRhythm: "12-28 字的口语句与一个稍长句交替，允许轻微不齐整",
      narrativeMove: "从一个具体停顿开场，写当时的小想法，不总结旅行意义",
      detailLens: "只选一个地点、一个动作和一个计划外的小细节",
      diction: "日常动词和第一人称，少用抽象名词与成套形容词",
      ending: "停在动作、犹疑或未说满的判断上"
    },
    avoidances: ["空泛治愈", "整齐排比", "原来快乐很简单", "家人们谁懂", "强行升华"],
    exemplar: {
      facts: ["午后走到颐和路", "临时进书店坐了一会儿", "咖啡放凉"],
      text: "走到颐和路时刚好起风。后来在书店坐得太久，咖啡都凉了，也没觉得可惜。",
      transferNotes: ["以发生过的小事代替风格形容词", "两句长短不同", "结尾保留个人判断但不升华"]
    }
  },
  {
    id: "cinematic-fragment",
    label: "电影片段",
    cues: [/电影感/u, /镜头感/u, /王家卫/u, /港风/u, /跳切/u, /光影/u, /胶片/u],
    signature: {
      sentenceRhythm: "短句切镜与一处延迟解释，句间保留时间空隙",
      narrativeMove: "用时间、光线或移动建立两个镜头，再让人物关系从缝隙里出现",
      detailLens: "选择可见的天气、交通或街道物件，不罗列全部站点",
      diction: "具体名词优先，隐喻最多一个，克制使用情绪词",
      ending: "落在时间错位、去留或没完成的动作上"
    },
    avoidances: ["连续金句", "仿写影视台词", "霓虹雨夜刻板套装", "华丽意象堆砌", "虚构相遇"],
    exemplar: {
      facts: ["雨停", "坐了三站电车", "一条街没有走完"],
      text: "雨停在第三站。车继续往前，我把那条没走完的街留给了晚上。",
      transferNotes: ["两个可见镜头承载情绪", "不解释为什么遗憾", "不复制特定电影台词"]
    }
  },
  {
    id: "dry-humor",
    label: "轻吐槽",
    cues: [/幽默/u, /吐槽/u, /自嘲/u, /好笑/u, /冷幽默/u, /发疯/u, /有梗/u],
    signature: {
      sentenceRhythm: "先正常陈述，再用一个短句完成反差，不连续抛梗",
      narrativeMove: "让计划与实际的小偏差形成笑点，笑点落在自己而非地点或同行人",
      detailLens: "使用等待、走错、坐太久等低风险真实细节",
      diction: "口语、轻微自嘲，不使用网络热梗拼盘",
      ending: "用一句不完全认输的自我辩解收尾"
    },
    avoidances: ["机械玩梗", "家人们", "显眼包", "夸张到失真", "嘲讽同行人"],
    exemplar: {
      facts: ["计划三小时走完", "第一家书店停了四十分钟"],
      text: "本来计划三小时拿下老城南，结果第一家书店就坐了四十分钟。计划很努力，我也确实没听它的。",
      transferNotes: ["笑点来自事实反差", "只在结尾抖一次包袱", "不依赖流行语"]
    }
  },
  {
    id: "togetherness",
    label: "同行关系",
    cues: [/恋爱/u, /情侣/u, /约会/u, /和朋友/u, /跟朋友/u, /朋友(?:一起|同行|出游|散步|约会)/u, /闺蜜/u, /家人/u, /同行/u, /我们/u],
    signature: {
      sentenceRhythm: "自然复句为主，穿插一句很短的共同反应",
      narrativeMove: "地点只是背景，重点写两个人如何决定、等待或同时注意到一件事",
      detailLens: "选择共享动作、分歧和默契，不替同行人发明心理活动",
      diction: "使用我们与具体动作，少用关系口号",
      ending: "落在下一次约定或仍在继续的共同动作上"
    },
    avoidances: ["爱情大道理", "替对方发言", "永远永恒", "命中注定", "景点清单式秀恩爱"],
    exemplar: {
      facts: ["两个人在岔路口选了不同方向", "最后一起进了路边小店"],
      text: "在路口争了半分钟往哪边走，最后谁也没赢，一起拐进了旁边的小店。今天最像约会的部分，反而没写在路线里。",
      transferNotes: ["关系由共同动作呈现", "不替对方描述感受", "地点退到背景"]
    }
  },
  {
    id: "quiet-rest",
    label: "安静留白",
    cues: [/治愈/u, /温柔/u, /安静/u, /克制/u, /清醒/u, /留白/u, /低饱和/u, /平静/u],
    signature: {
      sentenceRhythm: "句子偏短但不碎，停顿少而明确",
      narrativeMove: "从身体感受或环境变化进入，只写一次情绪变化",
      detailLens: "选风、树影、脚步或坐下等可感知细节，避免万能景色",
      diction: "低强度词语和直接动词，不堆温柔、治愈、浪漫",
      ending: "停在一个安静动作，不给生活下结论"
    },
    avoidances: ["岁月静好", "治愈一切", "城市画卷", "温柔以待", "正能量缝合"],
    exemplar: {
      facts: ["走累后在湖边坐下", "风变小", "没有继续赶下一站"],
      text: "走到湖边时有点累，就坐了一会儿。风慢下来以后，我们也没再赶下一站。",
      transferNotes: ["情绪来自身体动作", "不使用治愈等标签", "结尾不解释意义"]
    }
  },
  {
    id: "light-guide",
    label: "轻攻略",
    cues: [/攻略/u, /实用/u, /避坑/u, /推荐/u, /路线分享/u, /清单/u, /怎么走/u],
    signature: {
      sentenceRhythm: "先一句结论，再用两到三句自然补充，不做十项清单",
      narrativeMove: "说明这条路线适合谁、最值得停在哪里、一个真实注意点",
      detailLens: "保留地点顺序与行动建议，主观感受明确标成个人判断",
      diction: "像朋友复述走法，避免专家口吻、流量词和命令式收藏提示",
      ending: "给一个可执行的小提醒，不做互动号召"
    },
    avoidances: ["闭眼冲", "一定要收藏", "保姆级", "宝藏路线", "点赞关注", "SEO 标签堆叠"],
    exemplar: {
      facts: ["路线包含书店、老街和河边", "全程适合慢走", "下午河边较晒"],
      text: "这条线适合不赶时间地走：先逛书店，再穿过老街去河边。下午河边会晒，我更建议四点以后再过去。",
      transferNotes: ["一句说清适用场景", "只给一个有来源的提醒", "没有营销式行动号召"]
    }
  }
];

const DEFAULT_CASE = STYLE_CASES[0];

function compact(value: string, max = 500): string {
  return value.replace(/\r\n?/gu, "\n").replace(/[ \t]+/gu, " ").trim().slice(0, max);
}

function extractReferenceSamples(task: string): string[] {
  const tagged = [...task.matchAll(/<style_reference>([\s\S]{10,800}?)<\/style_reference>/giu)].map((match) => compact(match[1], 600));
  const marked = task.match(/(?:参考文案|参考文本|参考样例|模仿这段|照着这段写)[：:]\s*[“「"]?([\s\S]{10,700})/u)?.[1];
  const values = [...tagged, ...(marked ? [compact(marked.replace(/[”」"]\s*$/u, ""), 600)] : [])];
  return [...new Set(values.filter(Boolean))].slice(0, 2);
}

function extractStylePhrase(task: string): string | undefined {
  const platformTail = task.match(/(?:朋友圈|微信动态)(?:文案|邀约)?[，,:：]\s*([\s\S]{2,100})$/u)?.[1]
    ?.replace(/^(?:文案)?(?:风格|语气|口吻)[：:]?\s*/u, "")
    .trim();
  if (platformTail && !/^(?:根据|基于|把|将)路线/u.test(platformTail)) return platformTail.slice(0, 80);
  const patterns = [
    /(?:文案)?(?:风格|语气|口吻)\s*(?:想要|要|用|按|为|是|像)?[：:]?\s*[“「"]?([^。；;\n”」"]{2,80})/u,
    /(?:写成|写得|来点|想要)\s*([^。；;\n]{2,60}?)(?:一点|的感觉|的口吻|风格)(?:[，。；;\n]|$)/u
  ];
  for (const pattern of patterns) {
    const matched = task.match(pattern)?.[1]
      ?.replace(/(?:一点|风格|口吻)$/u, "")
      .replace(/[”」"]$/u, "")
      .trim();
    if (matched && !/不同|三种|多个|区分/u.test(matched)) return matched.slice(0, 80);
  }
  const cues = STYLE_CASES.flatMap((item) => item.cues.flatMap((cue) => task.match(cue)?.[0] ?? [])).filter(Boolean);
  return cues.length ? [...new Set(cues)].slice(0, 3).join("、") : undefined;
}

function scoreCases(task: string): Array<{ item: SocialCopyCase; score: number }> {
  return STYLE_CASES.map((item) => ({ item, score: item.cues.reduce((sum, cue) => sum + Number(cue.test(task)), 0) }))
    .sort((left, right) => right.score - left.score);
}

function resolveStyle(task: string, referenceSamples: string[]): { profile: SocialCopyStyleProfile; selected: SocialCopyCase } {
  const rawText = extractStylePhrase(task);
  const ranked = scoreCases(`${task}\n${rawText ?? ""}`);
  const explicitlyHumorous = Boolean(rawText && /好笑|幽默|吐槽|自嘲|冷幽默|有梗/u.test(rawText));
  const selected = explicitlyHumorous
    ? STYLE_CASES.find((item) => item.id === "dry-humor") ?? DEFAULT_CASE
    : ranked[0]?.score ? ranked[0].item : DEFAULT_CASE;
  const secondary = ranked.find((entry) => entry.score && entry.item.id !== selected.id)?.item;
  const exactPreset = Boolean(rawText && (
    rawText === selected.label
    || selected.cues.some((cue) => rawText.match(cue)?.[0] === rawText)
  ));
  const source: SocialCopyStyleProfile["source"] = referenceSamples.length
    ? "reference"
    : rawText
      ? exactPreset ? "preset" : "custom"
      : "default";
  const label = referenceSamples.length ? (rawText || "参考样例声口") : (rawText || "自然朋友圈");
  const signature = secondary && secondary.id !== selected.id
    ? {
        ...selected.signature,
        narrativeMove: `${selected.signature.narrativeMove}；辅以：${secondary.signature.narrativeMove}`,
        detailLens: `${selected.signature.detailLens}；同时注意：${secondary.signature.detailLens}`
      }
    : selected.signature;
  return {
    selected,
    profile: {
      label: label.slice(0, 40),
      rawText: rawText || label,
      source,
      signature,
      avoidances: [...new Set([...selected.avoidances, ...(secondary?.avoidances ?? [])])].slice(0, 10)
    }
  };
}

function resolvePlatform(task: string): SocialCopyPlatform {
  if (/朋友圈|微信动态/u.test(task)) return "moments";
  if (/小红书|rednote/iu.test(task)) return "xiaohongshu";
  if (/微博/u.test(task)) return "weibo";
  if (/caption|ins\b|instagram/iu.test(task)) return "caption";
  return "general";
}

function explicitlyRequestsPlan(task: string): boolean {
  // “计划分享/计划文案” describes the speech act directly even when the
  // user does not also say “还没去” or “准备出发”。Keep this explicit cue
  // ahead of the default completed-route premise so the generated copy uses
  // future/planning tense instead of claiming the walk already happened.
  return /计划(?:分享|文案|发布)|还没(?:去|出发)|尚未(?:去|出发)|准备(?:去|出发)|打算去|下次(?:去|想)|改天(?:去|想)|周末想去|想找.{0,8}(?:一起|同行)|找人(?:一起|同行)|有没有人.{0,8}(?:一起|同行)|谁.{0,8}(?:一起去|同行)|约人|邀约|求搭子|招募搭子|一起去吗/u.test(task);
}

function explicitlyRequestsInvitation(task: string): boolean {
  return /想找.{0,8}(?:一起|同行)|找人(?:一起|同行)|有没有人.{0,8}(?:一起|同行)|谁.{0,8}(?:一起去|同行)|约人|邀约|求搭子|招募搭子|一起去吗/u.test(task);
}

function resolveSpeechAct(task: string): SocialCopySpeechAct {
  if (explicitlyRequestsInvitation(task)) return "invitation";
  if (explicitlyRequestsPlan(task)) return "plan_share";
  return "actual_share";
}

function resolveExperienceMode(task: string): ExperienceMode {
  return resolveSpeechAct(task) === "actual_share" ? "visited" : "planned";
}

function sceneInferences(facts: SocialCopyBrief["routeFacts"]): string[] {
  const corpus = `${facts.title ?? ""} ${facts.styleSummary ?? ""} ${facts.stops.map((stop) => (
    `${stop.name} ${stop.category ?? ""} ${stop.reason ?? ""} ${stop.highlight ?? ""} ${stop.tags.join(" ")}`
  )).join(" ")}`;
  return [
    /海|海边|海旁|滨水|waterfront/iu.test(corpus)
      ? "滨海地点允许写吹海风、看看海、在海边找地方坐一会或停一停，以及海边、开阔等常识性氛围；海风是地点氛围联想，不代表实时天气数据"
      : undefined,
    /江|河|湖|溪|水岸|滨江|滨河/u.test(corpus)
      ? "滨水地点允许写在岸边停一停或坐一会、看看水面，以及水边、水面、岸边等常识性氛围"
      : undefined,
    /公园|花园|绿地|草地|植物园|森林|树林/u.test(corpus)
      ? "公园与绿地允许写散步、看树影、找地方坐一会或短暂停留；不得凭空断言有长椅、花期或具体景观"
      : undefined,
    /书店|书局|书屋|图书馆|书架/u.test(corpus)
      ? "书店与阅读空间允许写翻书、在书架间慢慢逛或停留一会；不得凭空写购买、价格、库存或具体书名"
      : undefined,
    /咖啡|茶馆|茶室|餐厅|小店/u.test(corpus)
      ? "咖啡馆、茶馆或休息型小店允许写进去坐一会或歇脚；不得凭空写点单、消费、味道或服务经历"
      : undefined,
    /博物馆|美术馆|艺术馆|展览|展厅|画廊/u.test(corpus)
      ? "展览与文化空间允许写进去看看、慢慢逛展或在作品前停一停；不得凭空写具体展品、开放状态或购票经历"
      : undefined,
    /街市|市集|市场|摊位/u.test(corpus)
      ? "街市与市集允许写逛摊位、看看街市或短暂停留；不得凭空写购买、食用、价格或摊主互动"
      : undefined,
    /旧|老城|历史|街市|街巷|建筑/u.test(corpus) ? "旧城与历史建筑允许使用旧楼、街巷、院落等概括性场景词，也可写慢慢逛、看看建筑或在转角停一停" : undefined,
    /光影|光线|采光|院落|庭院/u.test(corpus) ? "路线资料明确提到光影或院落时，可以做克制的光线与空间描写" : undefined,
    facts.pace === "relaxed" ? "轻松节奏允许使用慢慢走、晃过去、不着急等非精确动作表达" : undefined
  ].filter((item): item is string => Boolean(item));
}

function extractEvidence(
  task: string,
  facts: SocialCopyBrief["routeFacts"],
  speechAct: SocialCopySpeechAct
): SocialCopyBrief["evidence"] {
  const tagged = [
    ...task.matchAll(/<(?:walk_record|experience_fragment|actual_note)>([\s\S]{2,800}?)<\/(?:walk_record|experience_fragment|actual_note)>/giu)
  ].map((match) => compact(match[1], 500));
  const marked = [...task.matchAll(/(?:实际记录|随身记录|游玩记录|我当时写了|我的原话)[：:]\s*([^\n]{2,500})/gu)]
    .map((match) => compact(match[1], 500));
  const suppliedFragments = [...new Set([...tagged, ...marked].filter(Boolean))].slice(0, 8);
  const level: SocialCopyEvidenceLevel = /<walk_record>/iu.test(task) || /随身记录|游玩记录/u.test(task)
    ? "walk_record"
    : suppliedFragments.length
      ? "user_fragments"
      : "route_only";
  if (level !== "route_only") {
    return {
      level,
      suppliedFragments,
      allowedClaims: ["路线中的地点与顺序", "用户记录中明确出现的动作、观察、同行互动与感受"],
      safeInferences: sceneInferences(facts),
      prohibitedClaims: ["记录中没有出现的天气、消费、偶遇、对话、同行人心理和现场事件"]
    };
  }
  return {
    level,
    suppliedFragments,
    allowedClaims: [
      "路线中的地点、顺序、类别、主题、时长和规划节奏",
      speechAct === "actual_share"
        ? "产品将路线视为已经完成并默认采用实际分享口吻；可以使用走过、逛完、坐一会、停一停、看看、翻翻等完成时动作，以及与地点类别相符的低风险体验联想"
        : "保持计划或邀约时态，不写成已经完成",
      "可以加入不带精确事实承诺的轻微感受、自嘲、比喻、氛围描写和朋友圈修辞"
    ],
    safeInferences: sceneInferences(facts),
    prohibitedClaims: [
      "与路线地点、时长、顺序、计划状态直接冲突的陈述",
      "没有来源的实时或精确天气、消费金额、等待或停留时长、营业预约情况和交通结果",
      "没有记录的具体吃喝购买、味道评价、偶遇、对话、同行人反应和可核验事件",
      "生硬照搬‘过渡、叙事、节奏、整体感受’等设计术语"
    ]
  };
}

function resolveLengthHint(task: string): CopyLengthHint {
  if (/一句话|一句|短一点|简短|短句/u.test(task)) return "short";
  if (/长一点|详细|完整一点|小作文/u.test(task)) return "long";
  return "standard";
}

function variantPlans(length: CopyLengthHint): SocialCopyBrief["variantPlans"] {
  const fullRange = length === "short" ? "40-75 字" : length === "long" ? "90-160 字" : "55-110 字";
  const conciseRange = length === "short" ? "12-28 字" : length === "long" ? "25-50 字" : "15-40 字";
  return [
    {
      label: "完整版",
      composition: `围绕同一个分享角度自然展开两到四句，保留一个具体路线锚点和一个个人判断，不逐站报幕，控制在 ${fullRange}`
    },
    {
      label: "简短版",
      composition: `压缩同一个分享角度，只保留最有辨识度的事实或判断，不是完整版的机械截断，控制在 ${conciseRange}`
    }
  ];
}

function routeFacts(route?: PlanningResult): SocialCopyBrief["routeFacts"] {
  const stops = route?.stops.slice(0, 8).map((stop) => ({
    name: stop.name,
    category: stop.category,
    reason: compact(stop.reason ?? "", 160) || undefined,
    highlight: compact(stop.highlight ?? "", 120) || undefined,
    tags: [...new Set([...(stop.suitabilityTags ?? []), ...(stop.styleMatches ?? [])])].slice(0, 5)
  })) ?? [];
  return {
    basedOnRoute: stops.length > 0,
    title: route?.routeOverview?.title ?? route?.title,
    city: route?.routeOverview?.city ?? route?.constraints.city,
    startPoint: route?.routeOverview?.startPoint ?? route?.constraints.startPoint,
    totalMinutes: route?.totalEstimatedMinutes,
    stopNames: stops.map((stop) => stop.name),
    stops,
    pace: route?.constraints?.experience?.pace,
    styleSummary: route?.constraints?.style?.summary || route?.constraints?.style?.rawText || undefined
  };
}

function buildShareAngle(
  facts: SocialCopyBrief["routeFacts"],
  speechAct: SocialCopySpeechAct,
  evidence: SocialCopyBrief["evidence"],
  selectedCase: SocialCopyCase
): SocialCopyAngle {
  const first = facts.stopNames[0];
  const last = facts.stopNames.at(-1);
  const strongestStop = facts.stops.find((stop) => stop.highlight || stop.reason || stop.tags.length)?.name;
  const routeSpan = first && last && first !== last ? `从${first}走到${last}` : first ? `在${first}附近慢慢走` : undefined;
  const observedSceneTypes = [...new Set(facts.stops.flatMap((stop) => [stop.category, ...stop.tags]).filter(Boolean))].slice(0, 5);
  const anchorOptions = [
    routeSpan,
    strongestStop ? `可以只点到${strongestStop}，不要顺次列出所有站点` : undefined,
    facts.city ? `城市：${facts.city}` : undefined,
    observedSceneTypes.length ? `路线明确提供的场景线索：${observedSceneTypes.join("、")}` : undefined
  ].filter((item): item is string => Boolean(item));
  const candidateDirections = [
    routeSpan ? `以“${routeSpan}”作为事实骨架，只选择一处场景关系展开` : "从用户明示的事实里找一个可说清的重点",
    facts.styleSummary ? `可以转述路线主题“${facts.styleSummary}”，但要换成日常可观察的说法，不能把设计术语当作用户感受` : undefined,
    speechAct === "invitation" ? "重点是向读者发出明确、自然、可回应的同行邀请；路线只说明去哪里" : undefined,
    speechAct === "plan_share" ? "重点是分享准备怎么走，不伪装已经发生，也不强行招募同行者" : undefined,
    speechAct === "actual_share" && evidence.level === "route_only"
      ? "保持实际分享口吻，并把路线视为已经完成；除走到、逛完外，也可按 safeInferences 写坐一会、停一停、看看、翻书等低风险体验和合理氛围，但不要新增精确天气、消费或可核验现场事件"
      : undefined,
    selectedCase.id === "dry-humor" && evidence.level === "route_only"
      ? "幽默可以来自路线规划、轻微自嘲和模糊的执行反差；不得捏造可核验的具体事故、等待时长或消费事件"
      : undefined
  ].filter((item): item is string => Boolean(item));
  return {
    goal: speechAct === "invitation"
      ? "让看到朋友圈的熟人清楚感到自己被自然邀请，并知道大致去哪儿"
      : speechAct === "plan_share"
        ? "像向熟人分享接下来的 CityWalk 计划，而不是发布攻略"
        : "像向熟人分享一段已经完成的 CityWalk，不写成路线总结，也不编造高风险、可核验的硬事实",
    candidateDirections,
    anchorOptions,
    forbiddenConversions: [
      "不得把路线风格摘要直接改写成‘我喜欢的是……’",
      "不得原样照搬‘空间过渡、叙事、节奏、整体感受’等产品设计术语",
      "轻微修辞可以使用，但不要编造能被外部验证为真假的具体事件"
    ]
  };
}

export function buildSocialCopyBrief(task: string, route?: PlanningResult): SocialCopyBrief {
  const referenceSamples = extractReferenceSamples(task);
  const { profile, selected } = resolveStyle(task, referenceSamples);
  const facts = routeFacts(route);
  const speechAct = resolveSpeechAct(task);
  const experienceMode = resolveExperienceMode(task);
  const invitationRequested = speechAct === "invitation";
  const evidence = extractEvidence(task, facts, speechAct);
  const lengthHint = resolveLengthHint(task);
  const techniqueReferences = scoreCases(`${task}\n${profile.rawText}`)
    .filter((entry) => entry.score > 0)
    .slice(0, 3)
    .map((entry) => ({ id: entry.item.id, label: entry.item.label }));
  return {
    platform: resolvePlatform(task),
    experienceMode,
    invitationRequested,
    speechAct,
    evidence,
    lengthHint,
    styleProfile: profile,
    styleComposition: {
      requestedVoice: profile.rawText,
      humorRequested: /好笑|幽默|吐槽|自嘲|冷幽默|有梗/u.test(profile.rawText),
      techniqueReferences,
      instruction: "用户原始风格是最高约束；techniqueReferences 只是可组合的写作技法，不是把请求归入单一预设"
    },
    referenceSamples,
    selectedCase: { id: selected.id, label: selected.label, ...selected.exemplar },
    routeFacts: facts,
    shareAngle: buildShareAngle(facts, speechAct, evidence, selected),
    variantPlans: variantPlans(lengthHint),
    qualityCriteria: [
      "两版必须落实用户原始风格描述，并保持同一声口",
      "先完成对应的表达行为：实际分享、计划分享或明确邀约；不要只拼出相关词语",
      "允许与地点类别相符的低风险动作、氛围和轻微主观感受；不要用精确细节把合理联想伪装成可核验事实",
      "最多自然点到一至两个地点，不按路线顺序罗列站点",
      "读起来像发给认识自己的人，不像路线总结、导游词或营销文案",
      "自然度包括搭配、指代和语用是否符合日常中文，不能只靠关键词达标",
      "幽默必须存在读者可以识别的反差或自嘲机制；出现‘但、结果、认真’等词不等于好笑",
      "邀约必须面向读者形成可回应的邀请，不能只陈述‘想有人陪’",
      "未提供的实时天气、具体吃喝与味道、消费、拍照结果、偶遇和同行人反应不得虚构；海风等地点氛围不等同于实时天气"
    ],
    factualBoundary: compact(task.replace(/<citywalk_ui_context>[\s\S]*$/u, ""), 1200)
  };
}

function routeWords(brief: SocialCopyBrief): { first: string; middle: string; last: string } {
  const names = brief.routeFacts.stopNames;
  return {
    first: names[0] ?? "街口",
    middle: names[Math.min(1, Math.max(0, names.length - 1))] ?? names[0] ?? "路边小店",
    last: names.at(-1) ?? names[0] ?? "另一头"
  };
}

function fallbackTexts(brief: SocialCopyBrief): string[] {
  const words = routeWords(brief);
  const routeSpan = words.first === words.last ? words.first : `${words.first}走到${words.last}`;
  const duration = brief.routeFacts.totalMinutes
    ? brief.routeFacts.totalMinutes < 60
      ? `${brief.routeFacts.totalMinutes}分钟`
      : brief.routeFacts.totalMinutes % 60 === 0
        ? `${brief.routeFacts.totalMinutes / 60}小时`
        : brief.routeFacts.totalMinutes % 60 === 30
          ? `${Math.floor(brief.routeFacts.totalMinutes / 60)}个半小时`
          : `${Math.floor(brief.routeFacts.totalMinutes / 60)}小时${brief.routeFacts.totalMinutes % 60}分钟`
    : undefined;
  if (brief.speechAct === "invitation") {
    return [
      `周末想从${routeSpan}。路线已经选好了，有人想一起走走吗？`,
      `周末从${routeSpan}，有人一起吗？`
    ];
  }
  if (brief.speechAct === "plan_share") {
    return [
      `接下来想从${routeSpan}。先沿着这条线走一遍，其他安排到时候再定。`,
      `接下来想从${routeSpan}。`
    ];
  }
  if (brief.styleComposition.humorRequested) {
    return [
      `从${routeSpan}${duration ? `，${duration}` : ""}。路线说是慢走，行程表写得比上班还认真。`,
      `${duration ? `${duration}的` : ""}慢走：松弛的是名字，认真的是行程表。`
    ];
  }
  if (brief.selectedCase.id === "cinematic-fragment") {
    const supportedScenes = brief.evidence.safeInferences.join(" ");
    const hasSea = /海|海边|海风|滨海/u.test(supportedScenes);
    const hasOldCity = /旧城|旧楼|街巷|院落|历史/u.test(supportedScenes);
    const sceneLine = hasSea && hasOldCity
      ? "旧城在前，海在后"
      : hasSea
        ? "街角在前，海在后"
        : hasOldCity
          ? "旧街在前，转角在后"
          : "街角在前，下一段路在后";
    return [
      `从${routeSpan}。${sceneLine}${duration ? `，中间是${duration}` : ""}。`,
      `${sceneLine}${duration ? `，中间${duration}` : ""}。`
    ];
  }
  const supportedScenes = brief.evidence.safeInferences.join(" ");
  const sceneWords = [
    /旧城|旧楼|街巷|院落|历史/u.test(supportedScenes) ? "旧街" : undefined,
    /江|河|湖|溪|水岸|水边|水面/u.test(supportedScenes) ? "水边" : undefined,
    /海|海边|海风|滨海/u.test(supportedScenes) ? "海边" : undefined
  ].filter((item): item is string => Boolean(item));
  const supportedSceneLine = sceneWords.length
    ? `${sceneWords.slice(0, 2).join("、")}，一路自然接上。`
    : "沿着路线慢慢走，一路自然接上。";
  return [
    `这次从${routeSpan}。${supportedSceneLine}`,
    `这次从${routeSpan}。`
  ];
}

function fallbackHashtags(brief: SocialCopyBrief): string[] {
  if (brief.platform === "moments" || brief.platform === "caption") return [];
  const values = [brief.routeFacts.city, "CityWalk", brief.selectedCase.id === "light-guide" ? "城市路线" : "城市散步"]
    .filter((value): value is string => Boolean(value));
  return [...new Set(values)].slice(0, brief.platform === "xiaohongshu" ? 4 : 2);
}

function fallbackResult(brief: SocialCopyBrief): SocialCopyResult {
  const texts = fallbackTexts(brief);
  const hashtags = fallbackHashtags(brief);
  return {
    basedOnRoute: brief.routeFacts.basedOnRoute,
    platform: brief.platform,
    styleProfile: brief.styleProfile,
    variants: brief.variantPlans.map((plan, index) => ({ tone: plan.label, text: texts[index], hashtags }))
  };
}

export function buildFallbackSocialCopyResponse(brief: SocialCopyBrief): IntentResponsePayload {
  const based = brief.routeFacts.basedOnRoute;
  return {
    title: `${brief.styleProfile.label} · CityWalk 分享文案`,
    answer: based
      ? `已按“${brief.styleProfile.label}”围绕同一个分享角度生成完整版和简短版。`
      : `已按“${brief.styleProfile.label}”生成完整版和简短版；当前没有找到最近路线，因此没有写入具体地点。`,
    sections: [],
    socialCopy: fallbackResult(brief)
  };
}

const AI_PATTERN = /家人们谁懂|姐妹们|闭眼冲|一定要收藏|保姆级|点赞|关注|真正拉开差距|原来.{0,8}(?:如此|这么)简单|城市画卷|岁月静好/u;
const PAST_EXPERIENCE_PATTERN = /(?:今天|刚刚|这次)(?:去(?:了)?|走(?:了)?|逛(?:了)?|吃(?:了)?|喝(?:了)?|拍(?:了)?|打卡)|走完|逛完|回来(?:以后|后)/u;
/**
 * Only precise, externally checkable inventions are hard failures. Atmosphere,
 * narrative tense and lightweight reactions belong to social-copy licence and
 * are judged for plausibility by the semantic editor instead of regexes.
 */
const MATERIAL_FABRICATION_PATTERNS = [
  /(?:花了|消费|人均|付款|买单|门票|票价).{0,8}\d+(?:\.\d+)?\s*元/u,
  /(?:排队|等了|等候|停留|坐了|逛了|迟到).{0,8}\d+\s*(?:分钟|小时|钟头)/u,
  /(?:店员|老板|路人|朋友|同行人|孩子|对象|男朋友|女朋友).{0,12}(?:说|告诉|觉得|笑|哭|抱怨|夸)/u,
  /(?:偶遇|碰见|遇见).{0,16}(?:明星|艺人|博主|朋友|熟人|谁)/u,
  /(?:临时闭馆|停止营业|已经关门|免预约|无需预约|必须预约|售罄)/u,
  /(?:下雨|雨停|暴雨|下雪|台风|高温预警|雷暴).{0,12}(?:了|当天|一路|突然|刚好)/u
];

function normalizeHashtags(values: string[], brief: SocialCopyBrief): string[] {
  if (brief.platform === "moments" || brief.platform === "caption") return [];
  const limit = brief.platform === "xiaohongshu" ? 4 : 2;
  return [...new Set(values.map((item) => item.replace(/^#+/u, "").replace(/\s+/gu, "").slice(0, 20)).filter(Boolean))].slice(0, limit);
}

function chineseNumber(value: string): number | undefined {
  if (/^\d+(?:\.\d+)?$/u.test(value)) return Number(value);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === "十") return 10;
  const ten = value.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/u);
  if (ten) return (ten[1] ? digits[ten[1]] : 1) * 10 + (ten[2] ? digits[ten[2]] : 0);
  return digits[value];
}

function statedDurationMinutes(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(/([零一二两三四五六七八九十\d]+(?:\.\d+)?)\s*(?:个)?(?:小时|钟头)/gu)) {
    const hours = chineseNumber(match[1]);
    if (hours !== undefined) values.push(hours * 60);
  }
  for (const match of text.matchAll(/(\d+)\s*分钟/gu)) values.push(Number(match[1]));
  return values;
}

export function hardConstraintIssues(text: string, brief: SocialCopyBrief, variantIndex: number): string[] {
  const issues: string[] = [];
  if (text.length < 8) issues.push("内容过短，无法形成完整表达");
  if (AI_PATTERN.test(text)) issues.push("包含营销钩子或陈旧 AI 套话");
  if (/\{\{|\[待|```/u.test(text)) issues.push("包含模板占位符或代码围栏");
  if (variantIndex === 0 && text.length < 30) issues.push("完整版篇幅过短");
  if (variantIndex === 1 && text.length > 55) issues.push("简短版篇幅过长");
  if (brief.speechAct !== "actual_share" && PAST_EXPERIENCE_PATTERN.test(text) && !/想|准备|计划/u.test(text)) {
    issues.push("计划或邀约文案误写成已经发生的经历");
  }
  // actual_share already carries the product-level “route completed” premise.
  // Do not require every caption to repeat an explicit past-tense verb: short
  // post-walk reactions such as “计划很努力，我没听它” are valid social copy.
  // The semantic reviewer still checks whether a candidate reads like an
  // actual share rather than an explicit future plan or invitation.
  const mentionedStops = brief.routeFacts.stopNames.filter((name) => text.includes(name));
  if (brief.routeFacts.basedOnRoute && mentionedStops.length === 0) {
    const cityOrThemeAnchor = [brief.routeFacts.city, brief.routeFacts.title, brief.routeFacts.styleSummary]
      .filter((value): value is string => Boolean(value))
      .some((value) => text.includes(value));
    // A short personal line can stand without a place name. Longer copy still
    // needs a route/theme anchor so it cannot drift into generic life advice.
    if (!cityOrThemeAnchor && text.length > 45) issues.push("长文案缺少路线事实锚点");
  }
  if (brief.routeFacts.totalMinutes) {
    const durations = statedDurationMinutes(text);
    // Duration in a social caption is an approximation. Keep a hard guard for
    // a materially different plan, but accept ordinary rounding such as
    // 3 hours versus 3.5 hours for a 210-minute route.
    if (durations.some((minutes) => Math.abs(minutes - brief.routeFacts.totalMinutes!) > 30)) {
      issues.push(`文案中的时长与路线事实 ${brief.routeFacts.totalMinutes} 分钟不一致`);
    }
  }
  if (mentionedStops.length > 2) issues.push("罗列了超过两个地点");
  if (brief.routeFacts.stopNames.length >= 3) {
    const listedInOrder = brief.routeFacts.stopNames.slice(0, 3).every((name) => text.includes(name));
    if (listedInOrder) issues.push("按路线顺序复述了前三个站点");
  }
  // The request and route provide hard facts; safeInferences deliberately allow
  // low-risk atmosphere (for example sea breeze at a waterfront stop).
  const sourceFacts = `${brief.factualBoundary}\n${JSON.stringify(brief.routeFacts)}\n${brief.evidence.suppliedFragments.join("\n")}`;
  if (MATERIAL_FABRICATION_PATTERNS.some((pattern) => pattern.test(text) && !pattern.test(sourceFacts))) {
    issues.push("编造了没有证据的精确事件或可核验事实");
  }
  if (/路线(?:依次|包括|包含|经过|为)[：:]?|第一站|第二站|第三站|行程安排/u.test(text)) {
    issues.push("写成了路线摘要或行程播报");
  }
  if (/喜欢的是(?:这段)?(?:过渡|叙事|节奏|整体感受)|最喜欢的是(?:空间)?过渡/u.test(text)) {
    issues.push("生硬地把产品设计术语当成用户感受");
  }
  if (brief.speechAct === "invitation" && !/[？?]|要不要|(?:一起|同行)(?:走|去|逛|吗|？|\?)|约吗|来吗|谁有空|有人一起(?:吗|？|\?)/u.test(text)) {
    issues.push("邀约没有形成面向读者、可以回应的邀请");
  }
  return [...new Set(issues)];
}

export function finalizeSocialCopyResponseWithDiagnostics(
  response: IntentResponsePayload,
  brief: SocialCopyBrief,
  semanticReview?: SocialCopySemanticReview,
  originalCandidates?: Array<{ variantIndex: number; text: string }>
): { response: IntentResponsePayload; diagnostics: SocialCopyFinalizationDiagnostics } {
  const fallback = fallbackResult(brief);
  const candidates = response.socialCopy?.variants ?? [];
  const seen = new Set<string>();
  const fallbackVariants: SocialCopyFallbackVariantDiagnostic[] = [];
  const variants = brief.variantPlans.map((plan, index) => {
    const candidate = candidates[index];
    const normalized = compact(candidate?.text ?? "", 800);
    const hardIssues = candidate ? hardConstraintIssues(normalized, brief, index) : ["模型没有返回这个版本"];
    const verdict = semanticReview?.variants.find((item) => item.variantIndex === index);
    const reviewedText = compact(verdict?.revisedText ?? normalized, 800);
    const reviewedHardIssues = reviewedText === normalized ? hardIssues : hardConstraintIssues(reviewedText, brief, index);
    // Semantic scores guide selection and revision. They are deliberately not
    // degradation triggers: replacing a plausible, expressive caption with a
    // generic template merely because a critic gave it 7/10 loses user value.
    const reasons = [
      ...reviewedHardIssues,
      ...(seen.has(reviewedText) ? ["与另一个版本重复"] : [])
    ];
    if (!candidate || reasons.length > 0) {
      fallbackVariants.push({
        variantIndex: index,
        tone: plan.label,
        originalText: originalCandidates?.find((item, candidateIndex) => (
          candidateIndex === verdict?.selectedCandidateIndex && item.variantIndex === index
        ))?.text || normalized || undefined,
        reasons: [...new Set(reasons)],
        fallbackText: fallback.variants[index].text
      });
      return fallback.variants[index];
    }
    seen.add(reviewedText);
    return {
      tone: plan.label,
      text: reviewedText,
      hashtags: normalizeHashtags(candidate.hashtags ?? [], brief)
    };
  });
  const based = brief.routeFacts.basedOnRoute;
  const finalized: IntentResponsePayload = {
    ...response,
    title: `${brief.styleProfile.label} · CityWalk 分享文案`,
    answer: based
      ? `已按“${brief.styleProfile.label}”围绕同一个分享角度生成完整版和简短版。`
      : `已按“${brief.styleProfile.label}”生成完整版和简短版；当前没有找到最近路线，因此没有写入具体地点。`,
    sections: [],
    socialCopy: {
      basedOnRoute: based,
      platform: brief.platform,
      styleProfile: brief.styleProfile,
      variants
    }
  };
  return {
    response: finalized,
    diagnostics: { fallbackTriggered: fallbackVariants.length > 0, fallbackVariants }
  };
}

export function finalizeSocialCopyResponse(
  response: IntentResponsePayload,
  brief: SocialCopyBrief,
  semanticReview?: SocialCopySemanticReview,
  originalCandidates?: Array<{ variantIndex: number; text: string }>
): IntentResponsePayload {
  return finalizeSocialCopyResponseWithDiagnostics(response, brief, semanticReview, originalCandidates).response;
}
