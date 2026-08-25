import type { FavoriteRoute, HistoryEntry, MemoryItem, PlanningResult } from '../api/agent'

export interface PromptSuggestion {
  label: string
  text: string
  basis: 'taste' | 'moment' | 'route' | 'starter'
  reason: string
}

export interface LocalPreferenceSnapshot {
  pace?: string
  transport?: string
  familyFriendly?: boolean
  restStops?: boolean
  avoidCrowds?: boolean
  indoorFirst?: boolean
}

export interface PromptSuggestionContext {
  memories: MemoryItem[]
  favorites: FavoriteRoute[]
  history: HistoryEntry[]
  defaults?: LocalPreferenceSnapshot
  now?: Date
  round?: number
}

const STARTERS: PromptSuggestion[] = [
  {
    label: '慢慢走', basis: 'starter', reason: '新用户起步推荐',
    text: '规划一条我附近三小时的松弛漫步路线，想看有城市生活感的街巷，也想有一家安静咖啡馆可以休息'
  },
  {
    label: '城市小发现', basis: 'starter', reason: '新用户起步推荐',
    text: '从我方便到达的地方出发，安排一条不赶景点、途中有两三个小发现的 CityWalk，控制在两小时左右'
  },
  {
    label: '今天就出发', basis: 'starter', reason: '新用户起步推荐',
    text: '根据现在的时间安排一条今天还能完整走完的路线，优先真实可执行、少折返并留出休息时间'
  }
]

function routeCity(route?: PlanningResult): string | undefined {
  return route?.routeOverview?.city || route?.constraints.city || undefined
}

function compact(value: unknown, max = 28): string {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function memoryStyle(memory?: MemoryItem): string | undefined {
  if (!memory) return undefined
  const style = memory.data.style
  if (style && typeof style === 'object') {
    const value = style as { summary?: unknown; rawText?: unknown; tags?: Array<{ name?: unknown }> }
    const summary = compact(value.summary || value.rawText, 24)
    if (summary) return summary
    const tags = Array.isArray(value.tags) ? value.tags.map(tag => compact(tag.name, 10)).filter(Boolean).slice(0, 3) : []
    if (tags.length) return tags.join('、')
  }
  return undefined
}

function timeScene(now: Date): { label: string; phrase: string; duration: number } {
  const hour = now.getHours()
  if (hour < 10) return { label: '晨间散步', phrase: '今天上午', duration: 150 }
  if (hour < 14) return { label: '午后开走', phrase: '今天下午', duration: 180 }
  if (hour < 18) return { label: '傍晚以前', phrase: '从现在到傍晚', duration: 150 }
  return { label: '今晚走走', phrase: '今晚', duration: 120 }
}

function routeAnchor(context: PromptSuggestionContext): { route: PlanningResult; source: '收藏' | '最近路线' } | undefined {
  const favoriteRoutes = context.favorites.filter(item => item.result.responseKind === 'route')
  const historyRoutes = context.history.filter(item => item.result.responseKind === 'route')
  const routes = [
    ...favoriteRoutes.map(item => ({ route: item.result, source: '收藏' as const })),
    ...historyRoutes.map(item => ({ route: item.result, source: '最近路线' as const }))
  ]
  return routes[(context.round ?? 0) % Math.max(1, routes.length)]
}

export function buildPromptSuggestions(context: PromptSuggestionContext): PromptSuggestion[] {
  const eligibleMemories = context.memories.filter(memory => memory.status === 'active' && memory.confidence >= 0.55)
  const positiveCategories = eligibleMemories
    .filter(memory => memory.kind === 'semantic' && memory.key.startsWith('preference:category:') && memory.polarity === 'positive')
    .sort((left, right) => right.confidence - left.confidence)
    .map(memory => compact(memory.data.category, 10)).filter(Boolean)
  const negativeCategories = eligibleMemories
    .filter(memory => memory.key.startsWith('preference:category:') && memory.polarity === 'negative' && memory.confidence >= 0.75)
    .map(memory => compact(memory.data.category, 10)).filter(Boolean)
  const styleMemory = eligibleMemories
    .filter(memory => memory.key === 'preference:style')
    .sort((left, right) => right.confidence - left.confidence)[0]
  const experienceMemory = eligibleMemories
    .filter(memory => memory.key === 'planning:experience')
    .sort((left, right) => right.confidence - left.confidence)[0]
  const experience = (experienceMemory?.data ?? {}) as Record<string, unknown>
  const defaults = context.defaults ?? {}
  const anchor = routeAnchor(context)
  const fallbackRoute = context.history.find(item => item.result.responseKind === 'route')?.result
  const city = routeCity(anchor?.route ?? fallbackRoute)
  const place = city || '我附近'
  const style = memoryStyle(styleMemory)
  const tasteParts = [
    style,
    positiveCategories.length ? `有${positiveCategories.slice(0, 2).join('和')}` : ''
  ].filter(Boolean)
  const avoidText = negativeCategories.length ? `，避开${negativeCategories.slice(0, 2).join('和')}` : ''
  const paceRelaxed = experience.pace === 'relaxed' || defaults.pace === 'relaxed'
  const restRequired = experience.restStopRequired === true || defaults.restStops === true
  const avoidCrowds = experience.avoidCrowds === true || defaults.avoidCrowds === true
  const familyFriendly = defaults.familyFriendly === true
    || eligibleMemories.some(memory => memory.key.startsWith('party:children') || memory.data.familyFriendly === true)
  const transport = defaults.transport === 'walk' ? '尽量步行串联'
    : defaults.transport === 'transit' ? '长距离用公共交通衔接'
      : '步行与公共交通合理结合'
  const round = context.round ?? 0
  const durations = [180, 150, 210]
  const duration = durations[round % durations.length]
  const suggestions: PromptSuggestion[] = []

  if (tasteParts.length || familyFriendly || restRequired || avoidCrowds) {
    const preferenceDetails = [
      tasteParts.length ? `延续我偏好的${tasteParts.join('、')}` : '',
      familyFriendly ? '对同行孩子友好' : '',
      paceRelaxed ? '节奏轻松' : '',
      restRequired ? '中途有可靠休息点' : '',
      avoidCrowds ? '尽量避开拥挤热点' : ''
    ].filter(Boolean).join('，')
    suggestions.push({
      label: positiveCategories[0] ? `${positiveCategories[0]}口味` : familyFriendly ? '适合同行的人' : '按我的节奏',
      basis: 'taste',
      reason: '根据长期偏好和多次实际漫步更新',
      text: `在${place}规划一条约${duration}分钟的 CityWalk，${preferenceDetails}${avoidText}。本轮如果有冲突，以我接下来补充的要求为准`
    })
  }

  const moment = timeScene(context.now ?? new Date())
  suggestions.push({
    label: moment.label,
    basis: 'moment',
    reason: '根据当前时间和默认出行方式生成',
    text: `在${place}安排一条${moment.phrase}可以完整走完的 ${moment.duration} 分钟路线，${transport}${paceRelaxed ? '，不要赶路' : ''}${restRequired ? '，留出一次坐下休息的时间' : ''}。请优先保证营业时间和路线衔接真实可执行`
  })

  if (anchor) {
    const stops = anchor.route.stops.slice(0, 5).map(stop => stop.name).join('、')
    const transformations = [
      '保留其中最有特色的两站，换一条少折返的新走法',
      '做成更适合拍照和慢慢记录的版本',
      '压缩成今天两小时内能完成的轻量版本'
    ]
    suggestions.push({
      label: anchor.source === '收藏' ? '收藏路线新走法' : '接着上次走',
      basis: 'route',
      reason: `根据${anchor.source}生成，不视为长期偏好`,
      text: `以“${compact(anchor.route.title, 32)}”及其站点“${stops}”为基础，${transformations[round % transformations.length]}。不要擅自换城市，并说明保留、删除和新增了什么`
    })
  }

  const used = new Set(suggestions.map(item => item.label))
  for (const starter of STARTERS.slice(round % STARTERS.length).concat(STARTERS)) {
    if (suggestions.length >= 3) break
    if (!used.has(starter.label)) {
      suggestions.push(starter)
      used.add(starter.label)
    }
  }
  return suggestions.slice(0, 3)
}
