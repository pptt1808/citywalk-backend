import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import {
  apiFinishActiveWalk, apiGetActiveWalk, apiRecordWalkEvent, apiSaveActiveWalk,
  apiDeleteSyncedJournal, apiListSyncedJournals,
  WalkSyncConflictError,
  type PlanningResult, type WalkBehaviorEvent, type WalkBehaviorEventType, type WalkRouteRevision
} from '../api/agent'

export interface GeoPoint {
  lng: number
  lat: number
  accuracy?: number
}

export interface WalkTrailPoint extends GeoPoint { recordedAt: string }

export interface JournalPhoto {
  id: string
  url: string
  caption: string
  width?: number
  height?: number
  aspectRatio?: number
  createdAt: string
  illustration?: JournalIllustration
  illustrationEnabled?: boolean
}

export interface JournalIllustration {
  assetId: string
  url: string
  model: string
  prompt: string
  styleDescription: string
  mode: 'distilled-contour' | 'gathered-collage'
  generatedAt: string
}

export interface JournalBlock {
  id: string
  kind: 'photo-text' | 'text'
  photoId?: string
  title: string
  text: string
  placeName?: string
  sourceMomentId?: string
  createdAt: string
}

export type JournalLayoutRecipe =
  | 'center-fragment' | 'lower-left-float' | 'upper-right-block' | 'dual-panel'
  | 'irregular-cutout' | 'type-led' | 'dot-orbit' | 'single-specimen'

export type JournalAccent = 'cobalt' | 'tomato' | 'pear' | 'violet' | 'lemon' | 'cyan'
export type JournalTypographyMode = 'archive-stack' | 'edge-caption' | 'fragmented-letters' | 'diagonal-note' | 'quiet-serif'
export type JournalTextureMode = 'paper-fibers' | 'xerox-softness' | 'risograph-grain' | 'letterpress-bleed' | 'halftone' | 'scan-noise'
export type JournalAccentForm = 'ink-block' | 'torn-strip' | 'stamp-circle' | 'brush-stroke'
export type JournalDecorationKind = 'route-line' | 'orbit' | 'registration-dots' | 'corner-marks' | 'underline' | 'botanical'

export interface JournalBlockPlacement {
  blockId: string
  page: 'left' | 'right'
  x: number
  y: number
  width: number
  rotation: number
  zIndex: number
  textPlacement: 'right' | 'left' | 'below' | 'overlay'
  photoTreatment: 'natural' | 'soft-xerox' | 'risograph' | 'torn-paper' | 'film-grain'
  tapePosition: 'none' | 'upper-left' | 'upper-center' | 'upper-right' | 'side'
}

export interface JournalDecoration {
  kind: JournalDecorationKind
  page: 'left' | 'right'
  x: number
  y: number
  rotation: number
  scale: number
}

export interface JournalVisualDirection {
  typographyMode: JournalTypographyMode
  textureMode: JournalTextureMode
  accentForm: JournalAccentForm
  accentPage: 'left' | 'right'
  accentX: number
  accentY: number
  accentWidth: number
  accentHeight: number
  accentRotation: number
  decorations: JournalDecoration[]
}

export interface JournalSpreadPlan {
  id: string
  blockIds: string[]
  recipe: JournalLayoutRecipe
  anchorPage?: 'left' | 'right' | 'split'
  placements?: JournalBlockPlacement[]
  visualDirection?: JournalVisualDirection
  accent: JournalAccent
  headline: string
  microtext: string
  rationale: string
}

export interface WalkMoment {
  id: string
  note: string
  photos: JournalPhoto[]
  createdAt: string
  location?: GeoPoint
  stopName?: string
  stopIndex?: number
}

export type WalkStopState = 'planned' | 'arrived' | 'visited' | 'skipped'
export interface WalkStopProgress {
  name: string
  status: WalkStopState
  updatedAt?: string
  source?: 'location' | 'moment' | 'manual'
}

export interface WalkRouteSnapshot {
  revisionId: string
  route: PlanningResult
  stopProgress: WalkStopProgress[]
  savedAt: string
}

export interface WalkDeviation {
  distanceMeters: number
  detectedAt: string
  confirmedAt?: string
  dismissedAt?: string
}

export interface ActiveWalk {
  id: string
  route: PlanningResult
  originalStopNames: string[]
  startedAt: string
  updatedAt: string
  pausedAt?: string
  pausedMs: number
  currentLocation?: GeoPoint
  locationTrail: WalkTrailPoint[]
  moments: WalkMoment[]
  stopProgress: WalkStopProgress[]
  skippedStopNames: string[]
  routeRevisions: WalkRouteRevision[]
  routeSnapshots: WalkRouteSnapshot[]
  deviation?: WalkDeviation
}

export interface JournalJourneyMeta {
  walkId: string
  startedAt: string
  completedAt: string
  durationMs: number
  originalStopNames?: string[]
  visitedStopNames?: string[]
  skippedStopNames?: string[]
  routeRevisions?: WalkRouteRevision[]
  locationTrail?: WalkTrailPoint[]
}

export interface ScrapbookEntry {
  id: string
  title: string
  city: string
  route?: PlanningResult
  /** Present only when the book was produced by completing an active walk. */
  journey?: JournalJourneyMeta
  note: string
  photos: JournalPhoto[]
  blocks: JournalBlock[]
  spreads: JournalSpreadPlan[]
  moments: WalkMoment[]
  selectedStops: string[]
  aiCaption: string
  createdAt: string
  updatedAt: string
}

export interface JournalStoryDraft {
  file: File
  title: string
  text: string
  placeName?: string
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function parseCoordinate(value?: string): GeoPoint | undefined {
  if (!value) return undefined
  const [lng, lat] = value.split(',').map(Number)
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : undefined
}

function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const radius = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function distanceToSegmentMeters(point: GeoPoint, start: GeoPoint, end: GeoPoint): number {
  const latitudeScale = 111_320
  const longitudeScale = latitudeScale * Math.cos(point.lat * Math.PI / 180)
  const ax = (start.lng - point.lng) * longitudeScale
  const ay = (start.lat - point.lat) * latitudeScale
  const bx = (end.lng - point.lng) * longitudeScale
  const by = (end.lat - point.lat) * latitudeScale
  const dx = bx - ax
  const dy = by - ay
  const denominator = dx * dx + dy * dy
  const ratio = denominator > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0
  return Math.hypot(ax + ratio * dx, ay + ratio * dy)
}

function distanceFromRemainingRoute(point: GeoPoint, walk: ActiveWalk): number | undefined {
  const remainingNames = new Set(walk.stopProgress
    .filter(item => item.status === 'planned' || item.status === 'arrived')
    .map(item => item.name))
  const distances = (walk.route.routeLegs ?? []).flatMap((leg, index) => {
    const destinationName = leg.destinationName ?? walk.route.stops[index]?.name
    if (destinationName && !remainingNames.has(destinationName)) return []
    const start = parseCoordinate(leg.origin)
    const end = parseCoordinate(leg.destination)
    return start && end ? [distanceToSegmentMeters(point, start, end)] : []
  })
  return distances.length ? Math.min(...distances) : undefined
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('照片读取失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('无法识别照片尺寸'))
    image.src = url
  })
}

async function fileToPhoto(file: File, caption?: string): Promise<JournalPhoto> {
  const originalUrl = await readFile(file)
  let url = originalUrl
  let width: number | undefined
  let height: number | undefined
  try {
    const image = await loadImage(originalUrl)
    width = image.naturalWidth
    height = image.naturalHeight
    const maxSide = 1800
    const scale = Math.min(1, maxSide / Math.max(width, height))
    if (scale < 1 || file.size > 1_100_000) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const context = canvas.getContext('2d')
      if (context) {
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        url = canvas.toDataURL('image/jpeg', .86)
        width = canvas.width
        height = canvas.height
      }
    }
  } catch { /* 原图仍然可以使用，只是不提供尺寸元数据 */ }
  return {
    id: uid('photo'),
    url,
    caption: caption?.trim() || file.name.replace(/\.[^.]+$/, ''),
    width,
    height,
    aspectRatio: width && height ? Number((width / height).toFixed(4)) : undefined,
    createdAt: new Date().toISOString()
  }
}

function orientation(photo?: JournalPhoto): 'portrait' | 'landscape' | 'square' {
  const ratio = photo?.aspectRatio ?? 1
  return ratio > 1.18 ? 'landscape' : ratio < .84 ? 'portrait' : 'square'
}

const VERTICAL_STAGGER_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [22, 36],
  [35, 23],
  [25, 40],
  [39, 26]
]

/** Add a restrained high/low rhythm while preserving intentionally staggered AI layouts. */
function withVerticalRhythm(placements: JournalBlockPlacement[], spreadIndex: number): JournalBlockPlacement[] {
  if (placements.length !== 2 || Math.abs(placements[0].y - placements[1].y) >= 8) return placements
  const [firstY, secondY] = VERTICAL_STAGGER_PAIRS[spreadIndex % VERTICAL_STAGGER_PAIRS.length]
  return placements.map((placement, index) => ({ ...placement, y: index === 0 ? firstY : secondY }))
}

function short(value: string, max = 32): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

function localVisualDirection(index: number, anchorPage: JournalSpreadPlan['anchorPage']): JournalVisualDirection {
  const typographyModes: JournalTypographyMode[] = ['archive-stack', 'edge-caption', 'fragmented-letters', 'diagonal-note', 'quiet-serif']
  const textureModes: JournalTextureMode[] = ['paper-fibers', 'xerox-softness', 'risograph-grain', 'letterpress-bleed', 'halftone', 'scan-noise']
  const accentForms: JournalAccentForm[] = ['ink-block', 'torn-strip', 'stamp-circle', 'brush-stroke']
  const decorationKinds: JournalDecorationKind[] = ['route-line', 'orbit', 'registration-dots', 'corner-marks', 'underline', 'botanical']
  const emptyPage: 'left' | 'right' = anchorPage === 'left' ? 'right' : anchorPage === 'right' ? 'left' : index % 2 ? 'left' : 'right'
  const positions = [
    { x: 73, y: 18, width: 16, height: 5, rotation: -4 },
    { x: 10, y: 72, width: 13, height: 8, rotation: 6 },
    { x: 76, y: 64, width: 10, height: 10, rotation: -7 },
    { x: 9, y: 18, width: 18, height: 4, rotation: 3 }
  ]
  const accent = positions[index % positions.length]
  return {
    typographyMode: typographyModes[index % typographyModes.length],
    textureMode: textureModes[index % textureModes.length],
    accentForm: accentForms[index % accentForms.length],
    accentPage: emptyPage,
    accentX: accent.x,
    accentY: accent.y,
    accentWidth: accent.width,
    accentHeight: accent.height,
    accentRotation: accent.rotation,
    decorations: [
      { kind: decorationKinds[index % decorationKinds.length], page: emptyPage, x: index % 2 ? 18 : 70, y: index % 2 ? 58 : 76, rotation: index % 2 ? -8 : 7, scale: 1 },
      { kind: decorationKinds[(index + 3) % decorationKinds.length], page: emptyPage === 'left' ? 'right' : 'left', x: index % 2 ? 78 : 13, y: 16 + index % 3 * 7, rotation: index % 2 ? 5 : -5, scale: .75 }
    ]
  }
}

function localSpreads(blocks: JournalBlock[], photos: JournalPhoto[], city = ''): JournalSpreadPlan[] {
  const photoMap = new Map(photos.map(photo => [photo.id, photo]))
  const recipes: JournalLayoutRecipe[] = ['center-fragment', 'dual-panel', 'lower-left-float', 'irregular-cutout', 'type-led', 'dot-orbit']
  const accents: JournalAccent[] = ['cobalt', 'tomato', 'pear', 'violet', 'lemon', 'cyan']
  const groups: JournalBlock[][] = []
  let pending: JournalBlock[] = []
  for (let index = 0; index < blocks.length;) {
    const momentId = blocks[index].sourceMomentId
    const related: JournalBlock[] = []
    while (index < blocks.length && momentId && blocks[index].sourceMomentId === momentId) related.push(blocks[index++])
    if (!momentId) related.push(blocks[index++])
    // Keep two photos from the same recording point on one spread. A single
    // point may share a spread with the next single point; larger groups are
    // split into adjacent spreads with the same pin number.
    if (related.length > 1) {
      if (pending.length) groups.push(pending.splice(0))
      for (let offset = 0; offset < related.length; offset += 2) groups.push(related.slice(offset, offset + 2))
    } else {
      pending.push(related[0])
      if (pending.length === 2) groups.push(pending.splice(0))
    }
  }
  if (pending.length) groups.push(pending)
  return groups.map((group, index) => {
    const firstPhoto = photoMap.get(group[0]?.photoId ?? '')
    let recipe = recipes[index % recipes.length]
    if (group.length === 1) {
      recipe = group[0].kind === 'text' ? 'type-led'
        : orientation(firstPhoto) === 'landscape' ? 'lower-left-float'
          : orientation(firstPhoto) === 'portrait' ? 'center-fragment' : 'single-specimen'
    } else if (group.length === 2) recipe = 'dual-panel'
    const rotations = [-2.1, 1.7, -1.4, 2.4]
    const placements = withVerticalRhythm(group.map((block, blockIndex): JournalBlockPlacement => {
      const photo = photoMap.get(block.photoId ?? '')
      const photoOrientation = orientation(photo)
      const page = group.length === 2 ? blockIndex === 0 ? 'left' : 'right' : index % 2 ? 'right' : 'left'
      return {
        blockId: block.id,
        page,
        x: page === 'left' ? 10 + index % 3 * 2 : 12 + index % 2 * 3,
        y: group.length === 2
          ? VERTICAL_STAGGER_PAIRS[index % VERTICAL_STAGGER_PAIRS.length][blockIndex]
          : photoOrientation === 'landscape' ? 38 : 25 + index % 3 * 5,
        width: block.kind === 'text' ? 78 : photoOrientation === 'landscape' ? 80 : photoOrientation === 'portrait' ? 62 : 70,
        rotation: rotations[(index + blockIndex) % rotations.length],
        zIndex: blockIndex + 1,
        textPlacement: block.kind === 'text' || photoOrientation === 'landscape' ? 'below' : blockIndex % 2 ? 'left' : 'right',
        photoTreatment: 'natural',
        tapePosition: block.kind === 'text' ? 'none' : blockIndex % 2 ? 'upper-right' : 'upper-left'
      }
    }), index)
    const anchorPage: JournalSpreadPlan['anchorPage'] = group.length === 2 ? 'split' : index % 2 ? 'right' : 'left'
    return {
      id: uid('spread'), blockIds: group.map(block => block.id), recipe,
      anchorPage,
      placements,
      visualDirection: localVisualDirection(index, anchorPage),
      accent: accents[index % accents.length],
      headline: short(group.find(block => block.title)?.title || '城市片段', 28),
      microtext: short([city, group.find(block => block.placeName)?.placeName].filter(Boolean).join(' · ') || 'CITYWALK ARCHIVE', 48),
      rationale: '依据照片比例与图文数量生成的本地 zine 版式'
    }
  })
}

function normalizedPhoto(value: Partial<JournalPhoto>): JournalPhoto {
  return {
    id: value.id || uid('photo'), url: value.url || '', caption: value.caption || '',
    width: value.width, height: value.height,
    aspectRatio: value.aspectRatio ?? (value.width && value.height ? value.width / value.height : undefined),
    createdAt: value.createdAt || new Date().toISOString(),
    illustration: value.illustration?.assetId && value.illustration.url
      ? {
          ...value.illustration,
          mode: value.illustration.mode === 'gathered-collage' ? 'gathered-collage' : 'distilled-contour'
        }
      : undefined,
    illustrationEnabled: Boolean(value.illustration?.assetId && value.illustrationEnabled)
  }
}

function normalizeEntry(value: Partial<ScrapbookEntry> & { layout?: string }): ScrapbookEntry {
  const id = value.id || uid('journal')
  const photos = Array.isArray(value.photos) ? value.photos.map(normalizedPhoto) : []
  const moments = Array.isArray(value.moments) ? value.moments : []
  let blocks = Array.isArray(value.blocks) ? value.blocks.filter(block => block?.id && block.kind) : []
  if (!blocks.length) {
    blocks = photos.map(photo => {
      const moment = moments.find(item => item.photos?.some(itemPhoto => itemPhoto.id === photo.id))
      return {
        id: uid('block'), kind: 'photo-text' as const, photoId: photo.id,
        title: photo.caption, text: moment?.note || '', placeName: moment?.stopName,
        sourceMomentId: moment?.id, createdAt: photo.createdAt
      }
    })
    if (!blocks.length && value.note?.trim()) {
      blocks.push({ id: uid('block'), kind: 'text', title: '沿途文字', text: value.note.trim(), createdAt: value.createdAt || new Date().toISOString() })
    }
  }
  const blockIds = new Set(blocks.map(block => block.id))
  const savedSpreads = Array.isArray(value.spreads)
    ? value.spreads.map((spread, index) => {
      const safeIds = spread.blockIds.filter(id => blockIds.has(id))
      const normalizedPlacements = Array.isArray(spread.placements)
        ? spread.placements
          .filter(placement => safeIds.includes(placement.blockId))
          .map(placement => ({ ...placement, photoTreatment: 'natural' as const }))
        : undefined
      return {
        ...spread,
        blockIds: safeIds,
        anchorPage: safeIds.length === 2 ? 'split' : spread.anchorPage ?? (index % 2 ? 'right' : 'left'),
        visualDirection: spread.visualDirection ?? localVisualDirection(index, safeIds.length === 2 ? 'split' : spread.anchorPage ?? (index % 2 ? 'right' : 'left')),
        placements: normalizedPlacements ? withVerticalRhythm(normalizedPlacements, index) : undefined
      }
    }).filter(spread => spread.blockIds.length)
    : []
  const city = value.city || ''
  const createdAt = value.createdAt || new Date().toISOString()
  const updatedAt = value.updatedAt || new Date().toISOString()
  // Migrate books created by the earlier finishWalk implementation: route +
  // sourceMomentId is strong evidence that this is one coherent walked route,
  // while a route merely saved to the shelf has no source moments.
  const inferredJourney = value.route && moments.length && blocks.some(block => block.sourceMomentId)
    ? {
        walkId: `legacy_${id}`,
        startedAt: createdAt,
        completedAt: updatedAt,
        durationMs: Math.max(0, new Date(updatedAt).getTime() - new Date(createdAt).getTime())
      }
    : undefined
  // Migrate layouts saved by the earlier three-block algorithm. Reflowing once
  // is safer than preserving coordinates that are known to overflow the book.
  const safeSpreads = savedSpreads.some(spread => spread.blockIds.length > 2)
    ? localSpreads(blocks, photos, city)
    : savedSpreads
  return {
    id, title: value.title || '', city, route: value.route,
    journey: value.journey ?? (moments.length ? inferredJourney : undefined),
    note: value.note || '', photos, blocks,
    spreads: safeSpreads.length ? safeSpreads : localSpreads(blocks, photos, city),
    moments, selectedStops: Array.isArray(value.selectedStops) ? value.selectedStops : [],
    aiCaption: value.aiCaption || '', createdAt, updatedAt
  }
}

function buildCaption(entry: Pick<ScrapbookEntry, 'city' | 'route' | 'note' | 'selectedStops' | 'blocks'>): string {
  const places = entry.selectedStops.length ? entry.selectedStops.slice(0, 3) : entry.route?.stops.slice(0, 3).map(stop => stop.name) ?? []
  const placeText = places.length ? `从${places.join('、')}一路走过` : `在${entry.city || '城市'}慢慢行走`
  const text = entry.blocks.map(block => block.text).find(Boolean) || entry.note
  return `${placeText}，把路上的光、声音和偶然相遇收进这一页。${text ? ` ${short(text, 90)}` : ''}`.trim()
}

function normalizeActiveWalk(value: ActiveWalk | null | undefined): ActiveWalk | null {
  if (!value?.route?.stops?.length || !value.id || !value.startedAt) return null
  const saved = new Map((Array.isArray(value.stopProgress) ? value.stopProgress : []).map(item => [item.name, item]))
  return {
    ...value,
    originalStopNames: Array.isArray(value.originalStopNames) && value.originalStopNames.length
      ? value.originalStopNames
      : value.route.stops.map(stop => stop.name),
    updatedAt: value.updatedAt || value.routeRevisions?.at(-1)?.adjustedAt || value.startedAt,
    moments: Array.isArray(value.moments) ? value.moments : [],
    locationTrail: Array.isArray(value.locationTrail) ? value.locationTrail.slice(-2000) : [],
    stopProgress: value.route.stops.map(stop => saved.get(stop.name) ?? { name: stop.name, status: 'planned' }),
    skippedStopNames: Array.isArray(value.skippedStopNames) ? value.skippedStopNames : [],
    routeRevisions: Array.isArray(value.routeRevisions) ? value.routeRevisions : [],
    routeSnapshots: Array.isArray(value.routeSnapshots) ? value.routeSnapshots.slice(-5) : [],
    deviation: value.deviation
  }
}

export function useJournal(userId: Ref<string | undefined>) {
  const entries = ref<ScrapbookEntry[]>([])
  const activeWalk = ref<ActiveWalk | null>(null)
  const walkSyncStatus = ref<'idle' | 'syncing' | 'synced' | 'offline' | 'error'>('idle')
  const walkSyncError = ref('')
  const walkLastSyncedAt = ref<string>()
  const storageKey = computed(() => `citywalk-journal:${userId.value ?? 'anonymous'}`)
  const eventQueueKey = computed(() => `citywalk-walk-events:${userId.value ?? 'anonymous'}`)
  const finishQueueKey = computed(() => `citywalk-finished-walks:${userId.value ?? 'anonymous'}`)
  let serverVersion = 0
  let syncTimer: number | undefined
  let syncInFlight = false
  let syncAgain = false

  function readJsonQueue<T>(key: string): T[] {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
      return Array.isArray(parsed) ? parsed as T[] : []
    } catch { return [] }
  }

  function writeJsonQueue<T>(key: string, values: T[]) {
    localStorage.setItem(key, JSON.stringify(values))
  }

  function queueWalkEvent(walkId: string, eventType: WalkBehaviorEventType, payload: Record<string, unknown> = {}) {
    const event: WalkBehaviorEvent = {
      eventId: uid('we'), walkId, eventType, payload, createdAt: new Date().toISOString()
    }
    const queue = readJsonQueue<WalkBehaviorEvent>(eventQueueKey.value)
    queue.push(event)
    writeJsonQueue(eventQueueKey.value, queue.slice(-300))
    void flushWalkEvents()
  }

  async function flushWalkEvents() {
    if (!userId.value || !navigator.onLine) return
    const queue = readJsonQueue<WalkBehaviorEvent>(eventQueueKey.value)
    if (!queue.length) return
    const remaining = [...queue]
    while (remaining.length) {
      try {
        await apiRecordWalkEvent(remaining[0])
        remaining.shift()
        writeJsonQueue(eventQueueKey.value, remaining)
      } catch { return }
    }
  }

  function queueFinishedWalk(walkId: string) {
    const queue = readJsonQueue<string>(finishQueueKey.value)
    if (!queue.includes(walkId)) writeJsonQueue(finishQueueKey.value, [...queue, walkId].slice(-30))
    void flushFinishedWalks()
  }

  async function flushFinishedWalks() {
    if (!userId.value || !navigator.onLine || syncInFlight) return
    const remaining = readJsonQueue<string>(finishQueueKey.value)
    while (remaining.length) {
      try {
        await apiFinishActiveWalk(remaining[0])
        remaining.shift()
        writeJsonQueue(finishQueueKey.value, remaining)
      } catch { return }
    }
  }

  function scheduleWalkSync(delay = 900) {
    if (!userId.value || !activeWalk.value) return
    if (!navigator.onLine) {
      walkSyncStatus.value = 'offline'
      return
    }
    if (syncInFlight) {
      syncAgain = true
      return
    }
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
    syncTimer = window.setTimeout(() => { void syncActiveWalk() }, delay)
  }

  async function syncActiveWalk(forceVersion?: number) {
    const walk = activeWalk.value
    if (!userId.value || !walk || !navigator.onLine) return
    if (syncInFlight) {
      syncAgain = true
      return
    }
    syncInFlight = true
    walkSyncStatus.value = 'syncing'
    walkSyncError.value = ''
    try {
      const response = await apiSaveActiveWalk(walk, forceVersion ?? serverVersion)
      if (activeWalk.value?.id === walk.id) {
        serverVersion = response.session.version
        walkLastSyncedAt.value = response.session.updatedAt
        walkSyncStatus.value = 'synced'
      }
    } catch (error) {
      if (error instanceof WalkSyncConflictError) {
        const remote = normalizeActiveWalk(error.session.walk as ActiveWalk)
        const local = activeWalk.value
        if (remote && local && new Date(local.updatedAt).getTime() > new Date(remote.updatedAt).getTime()) {
          serverVersion = error.session.version
          syncAgain = true
        } else if (remote) {
          activeWalk.value = remote
          serverVersion = error.session.version
          walkLastSyncedAt.value = error.session.updatedAt
          walkSyncStatus.value = 'synced'
          walkSyncError.value = '已恢复另一设备上更新较晚的漫步记录'
        }
      } else {
        walkSyncStatus.value = navigator.onLine ? 'error' : 'offline'
        walkSyncError.value = error instanceof Error ? error.message : '漫步记录同步失败'
      }
    } finally {
      syncInFlight = false
      if (syncAgain) {
        syncAgain = false
        scheduleWalkSync(150)
      }
      void flushFinishedWalks()
    }
  }

  async function restoreActiveWalk() {
    const restoringUser = userId.value
    if (!restoringUser || !navigator.onLine) {
      if (activeWalk.value) walkSyncStatus.value = 'offline'
      return
    }
    await Promise.allSettled([flushFinishedWalks(), flushWalkEvents()])
    try {
      const { session } = await apiGetActiveWalk<ActiveWalk>()
      if (userId.value !== restoringUser) return
      const remote = normalizeActiveWalk(session?.walk)
      const local = activeWalk.value
      if (remote && (!local || new Date(remote.updatedAt).getTime() >= new Date(local.updatedAt).getTime())) {
        activeWalk.value = remote
        serverVersion = session?.version ?? 0
        walkLastSyncedAt.value = session?.updatedAt
        walkSyncStatus.value = 'synced'
      } else if (local) {
        serverVersion = session?.version ?? 0
        scheduleWalkSync(100)
      } else {
        serverVersion = 0
        walkSyncStatus.value = 'idle'
      }
    } catch (error) {
      walkSyncStatus.value = 'error'
      walkSyncError.value = error instanceof Error ? error.message : '无法恢复云端漫步'
    }
  }

  function load() {
    serverVersion = 0
    walkSyncStatus.value = 'idle'
    walkSyncError.value = ''
    try {
      const value = localStorage.getItem(storageKey.value)
      const parsed = value ? JSON.parse(value) as { entries?: Array<Partial<ScrapbookEntry>>; activeWalk?: ActiveWalk | null } : undefined
      entries.value = Array.isArray(parsed?.entries) ? parsed.entries.map(normalizeEntry) : []
      activeWalk.value = normalizeActiveWalk(parsed?.activeWalk)
    } catch {
      entries.value = []
      activeWalk.value = null
    }
    void restoreActiveWalk()
    void restoreSyncedJournals()
  }

  async function restoreSyncedJournals() {
    if (!userId.value || !navigator.onLine) return
    try {
      const remote = await apiListSyncedJournals<Partial<ScrapbookEntry>>()
      const byId = new Map(entries.value.map(entry => [entry.id, entry]))
      for (const raw of remote.entries) {
        const incoming = normalizeEntry(raw)
        const local = byId.get(incoming.id)
        if (!local || new Date(incoming.updatedAt).getTime() >= new Date(local.updatedAt).getTime()) byId.set(incoming.id, incoming)
      }
      entries.value = [...byId.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    } catch { /* 移动端手账同步失败不阻断本地书架 */ }
  }

  function persist() {
    try {
      localStorage.setItem(storageKey.value, JSON.stringify({ entries: entries.value, activeWalk: activeWalk.value }))
    } catch (error) {
      console.warn('[Journal] 本地手账空间不足，部分大图可能无法持久保存', error)
    }
  }

  watch(userId, load, { immediate: true })
  watch([entries, activeWalk], persist, { deep: true })

  const handleOnline = () => {
    void restoreActiveWalk()
    void flushWalkEvents()
    void flushFinishedWalks()
  }
  const handleOffline = () => { if (activeWalk.value) walkSyncStatus.value = 'offline' }
  const handleVisibility = () => { if (document.visibilityState === 'hidden' && activeWalk.value) void syncActiveWalk() }
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
  document.addEventListener('visibilitychange', handleVisibility)
  onScopeDispose(() => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    document.removeEventListener('visibilitychange', handleVisibility)
    if (syncTimer !== undefined) window.clearTimeout(syncTimer)
  })

  function touchActiveWalk(walk: ActiveWalk, syncDelay = 900) {
    walk.updatedAt = new Date().toISOString()
    scheduleWalkSync(syncDelay)
  }

  function startWalk(route: PlanningResult) {
    const now = new Date().toISOString()
    activeWalk.value = {
      id: uid('walk'), route, originalStopNames: route.stops.map(stop => stop.name),
      startedAt: now, updatedAt: now, pausedMs: 0, moments: [], locationTrail: [],
      stopProgress: route.stops.map(stop => ({ name: stop.name, status: 'planned' })),
      skippedStopNames: [], routeRevisions: [], routeSnapshots: []
    }
    serverVersion = 0
    queueWalkEvent(activeWalk.value.id, 'walk_started', {
      routeTitle: route.title,
      city: route.routeOverview?.city ?? route.constraints.city,
      stopNames: route.stops.map(stop => stop.name),
      styleTags: route.constraints.style?.tags ?? []
    })
    scheduleWalkSync(50)
  }

  function updateLocation(point: GeoPoint) {
    if (!activeWalk.value) return
    const walk = activeWalk.value
    walk.currentLocation = point
    const last = walk.locationTrail.at(-1)
    const now = new Date().toISOString()
    const nowMs = new Date(now).getTime()
    let changed = false
    if (!last || distanceMeters(last, point) >= 12 || new Date(now).getTime() - new Date(last.recordedAt).getTime() >= 30_000) {
      walk.locationTrail.push({ ...point, recordedAt: now })
      if (walk.locationTrail.length > 2000) walk.locationTrail.splice(0, walk.locationTrail.length - 2000)
      changed = true
    }
    const nearby = nearestStop(point, walk.route)
    if (nearby && nearby.distance <= 120) {
      const progress = walk.stopProgress.find(item => item.name === nearby.stop.name)
      if (progress?.status === 'planned') {
        Object.assign(progress, { status: 'arrived' as const, updatedAt: now, source: 'location' as const })
        changed = true
      }
    }
    const routeDistance = distanceFromRemainingRoute(point, walk)
    const threshold = Math.max(300, (point.accuracy ?? 0) * 2)
    if (routeDistance !== undefined && routeDistance > threshold) {
      const previous = walk.deviation
      const dismissedRecently = previous?.dismissedAt
        ? nowMs - new Date(previous.dismissedAt).getTime() < 5 * 60_000
        : false
      if (!previous) {
        walk.deviation = { distanceMeters: Math.round(routeDistance), detectedAt: now }
        changed = true
      } else {
        previous.distanceMeters = Math.round(routeDistance)
        if (!previous.confirmedAt && !dismissedRecently && nowMs - new Date(previous.detectedAt).getTime() >= 30_000) {
          previous.confirmedAt = now
          changed = true
        }
      }
    } else if (walk.deviation) {
      walk.deviation = undefined
      changed = true
    }
    if (changed) touchActiveWalk(walk, 1200)
  }

  function nearestStop(point: GeoPoint, route: PlanningResult) {
    return route.stops
      .map((stop, index) => ({ stop, index, point: parseCoordinate(stop.location) }))
      .filter((item): item is { stop: PlanningResult['stops'][number]; index: number; point: GeoPoint } => Boolean(item.point))
      .map(item => ({ ...item, distance: distanceMeters(point, item.point) }))
      .sort((a, b) => a.distance - b.distance)[0]
  }

  async function addMoment(note: string, files: File[]) {
    if (!activeWalk.value) return
    const photos = await Promise.all(files.map(file => fileToPhoto(file)))
    const location = activeWalk.value.currentLocation
    const nearby = location ? nearestStop(location, activeWalk.value.route) : undefined
    activeWalk.value.moments.push({
      id: uid('moment'), note: note.trim(), photos, createdAt: new Date().toISOString(), location,
      stopName: nearby?.stop.name, stopIndex: nearby?.index
    })
    if (nearby && nearby.distance <= 300) markStop(nearby.stop.name, 'visited', 'moment')
    touchActiveWalk(activeWalk.value, 100)
    queueWalkEvent(activeWalk.value.id, 'moment_added', {
      stopName: nearby?.stop.name,
      hasText: Boolean(note.trim()),
      photoCount: photos.length
    })
  }

  function markStop(name: string, status: WalkStopState, source: WalkStopProgress['source'] = 'manual') {
    const walk = activeWalk.value
    if (!walk) return
    const progress = walk.stopProgress.find(item => item.name === name)
    const previousStatus = progress?.status
    if (progress) Object.assign(progress, { status, updatedAt: new Date().toISOString(), source })
    if (status === 'skipped' && !walk.skippedStopNames.includes(name)) walk.skippedStopNames.push(name)
    if (status !== 'skipped') walk.skippedStopNames = walk.skippedStopNames.filter(item => item !== name)
    if (previousStatus !== status) {
      touchActiveWalk(walk, 150)
      if (status === 'visited' || status === 'skipped') {
        const stop = walk.route.stops.find(item => item.name === name)
        queueWalkEvent(walk.id, status === 'visited' ? 'stop_completed' : 'stop_skipped', {
          stopName: name,
          category: stop?.category,
          city: walk.route.routeOverview?.city ?? walk.route.constraints.city,
          source
        })
      }
    }
  }

  function applyWalkAdjustment(route: PlanningResult, revision: WalkRouteRevision) {
    const walk = activeWalk.value
    if (!walk) return
    walk.routeSnapshots.push({
      revisionId: revision.id,
      route: JSON.parse(JSON.stringify(walk.route)) as PlanningResult,
      stopProgress: walk.stopProgress.map(item => ({ ...item })),
      savedAt: new Date().toISOString()
    })
    if (walk.routeSnapshots.length > 5) walk.routeSnapshots.splice(0, walk.routeSnapshots.length - 5)
    const previous = new Map(walk.stopProgress.map(item => [item.name, item]))
    walk.route = route
    walk.stopProgress = route.stops.map(stop => previous.get(stop.name) ?? { name: stop.name, status: 'planned' })
    walk.routeRevisions.push(revision)
    walk.deviation = undefined
    touchActiveWalk(walk, 100)
    queueWalkEvent(walk.id, 'route_adjusted', {
      reason: revision.reason,
      retainedStopNames: revision.retainedStopNames,
      removedStopNames: revision.removedStopNames,
      addedStopNames: revision.addedStopNames,
      remainingMinutes: revision.remainingMinutes
    })
  }

  function undoWalkAdjustment(): WalkRouteRevision | undefined {
    const walk = activeWalk.value
    const snapshot = walk?.routeSnapshots.at(-1)
    if (!walk || !snapshot) return undefined
    const revision = walk.routeRevisions.find(item => item.id === snapshot.revisionId)
    walk.route = snapshot.route
    walk.stopProgress = snapshot.stopProgress.map(item => ({ ...item }))
    walk.routeSnapshots.pop()
    walk.routeRevisions = walk.routeRevisions.filter(item => item.id !== snapshot.revisionId)
    walk.deviation = undefined
    touchActiveWalk(walk, 100)
    queueWalkEvent(walk.id, 'route_adjustment_undone', { reason: revision?.reason, revisionId: snapshot.revisionId })
    return revision
  }

  function dismissDeviation() {
    const walk = activeWalk.value
    if (!walk?.deviation) return
    walk.deviation.confirmedAt = undefined
    walk.deviation.dismissedAt = new Date().toISOString()
    touchActiveWalk(walk, 500)
  }

  function createEntry(route?: PlanningResult): ScrapbookEntry {
    const now = new Date().toISOString()
    const entry: ScrapbookEntry = {
      id: uid('journal'), title: route?.title ?? '', city: route?.routeOverview?.city ?? '', route,
      note: '', photos: [], blocks: [], spreads: [], moments: [], selectedStops: route?.stops.map(stop => stop.name) ?? [],
      aiCaption: '', createdAt: now, updatedAt: now
    }
    entries.value.unshift(entry)
    return entry
  }

  function finishWalk(): ScrapbookEntry | undefined {
    const walk = activeWalk.value
    if (!walk) return undefined
    const now = new Date().toISOString()
    const photos = walk.moments.flatMap(moment => moment.photos)
    const blocks: JournalBlock[] = walk.moments.flatMap(moment => {
      const photoBlocks = moment.photos.map(photo => ({
        id: uid('block'), kind: 'photo-text' as const, photoId: photo.id,
        title: moment.stopName || photo.caption, text: moment.note,
        placeName: moment.stopName, sourceMomentId: moment.id, createdAt: moment.createdAt
      }))
      return photoBlocks.length ? photoBlocks : moment.note ? [{
        id: uid('block'), kind: 'text' as const, title: moment.stopName || '沿途记录', text: moment.note,
        placeName: moment.stopName, sourceMomentId: moment.id, createdAt: moment.createdAt
      }] : []
    })
    const selectedStops = [...new Set([
      ...walk.stopProgress.filter(item => item.status === 'visited').map(item => item.name),
      ...walk.moments.map(moment => moment.stopName).filter((name): name is string => Boolean(name))
    ])]
    const hasJourneyEvidence = Boolean(walk.moments.length
      || walk.routeRevisions.length
      || walk.stopProgress.some(item => item.status === 'visited' || item.status === 'arrived'))
    const city = walk.route.routeOverview?.city ?? ''
    const entry: ScrapbookEntry = {
      id: uid('journal'), title: walk.route.title, city, route: walk.route,
      journey: hasJourneyEvidence ? {
        walkId: walk.id,
        startedAt: walk.startedAt,
        completedAt: now,
        durationMs: Math.max(0, new Date(now).getTime() - new Date(walk.startedAt).getTime() - walk.pausedMs),
        originalStopNames: walk.originalStopNames,
        visitedStopNames: walk.stopProgress.filter(item => item.status === 'visited').map(item => item.name),
        skippedStopNames: walk.skippedStopNames,
        routeRevisions: walk.routeRevisions,
        locationTrail: walk.locationTrail
      } : undefined,
      note: walk.moments.map(moment => moment.note).filter(Boolean).join('\n'), photos, blocks,
      spreads: localSpreads(blocks, photos, city), moments: walk.moments,
      selectedStops: selectedStops.length ? selectedStops : walk.route.stops.map(stop => stop.name),
      aiCaption: '', createdAt: walk.startedAt, updatedAt: now
    }
    entry.aiCaption = buildCaption(entry)
    entries.value.unshift(entry)
    if (syncTimer !== undefined) {
      window.clearTimeout(syncTimer)
      syncTimer = undefined
    }
    activeWalk.value = null
    queueWalkEvent(walk.id, 'walk_finished', {
      routeTitle: walk.route.title,
      visitedStopNames: walk.stopProgress.filter(item => item.status === 'visited').map(item => item.name),
      skippedStopNames: walk.skippedStopNames,
      adjustmentReasons: walk.routeRevisions.map(item => item.reason),
      styleTags: walk.route.constraints.style?.tags ?? [],
      momentCount: walk.moments.length,
      durationMinutes: Math.round(Math.max(0, new Date(now).getTime() - new Date(walk.startedAt).getTime() - walk.pausedMs) / 60_000)
    })
    queueFinishedWalk(walk.id)
    serverVersion = 0
    walkSyncStatus.value = 'idle'
    return entry
  }

  async function addStories(entryId: string, drafts: JournalStoryDraft[]) {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry || !drafts.length) return
    const pairs = await Promise.all(drafts.map(async draft => {
      const photo = await fileToPhoto(draft.file, draft.title)
      const block: JournalBlock = {
        id: uid('block'), kind: 'photo-text', photoId: photo.id, title: draft.title.trim() || photo.caption,
        text: draft.text.trim(), placeName: draft.placeName?.trim(), createdAt: photo.createdAt
      }
      return { photo, block }
    }))
    entry.photos.push(...pairs.map(pair => pair.photo))
    entry.blocks.push(...pairs.map(pair => pair.block))
    entry.spreads = localSpreads(entry.blocks, entry.photos, entry.city)
    entry.updatedAt = new Date().toISOString()
  }

  async function addPhotos(entryId: string, files: File[]) {
    await addStories(entryId, files.map(file => ({ file, title: file.name.replace(/\.[^.]+$/, ''), text: '' })))
  }

  function addTextBlock(entryId: string, title = '文字片段', text = ''): JournalBlock | undefined {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry) return undefined
    const block: JournalBlock = { id: uid('block'), kind: 'text', title, text, createdAt: new Date().toISOString() }
    entry.blocks.push(block)
    entry.spreads = localSpreads(entry.blocks, entry.photos, entry.city)
    entry.updatedAt = new Date().toISOString()
    return block
  }

  function updateEntry(entryId: string, patch: Partial<Pick<ScrapbookEntry, 'title' | 'city' | 'note' | 'selectedStops'>>) {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry) return
    Object.assign(entry, patch, { updatedAt: new Date().toISOString() })
  }

  function updateBlock(entryId: string, blockId: string, patch: Partial<Pick<JournalBlock, 'title' | 'text' | 'placeName'>>) {
    const entry = entries.value.find(item => item.id === entryId)
    const block = entry?.blocks.find(item => item.id === blockId)
    if (!entry || !block) return
    Object.assign(block, patch)
    if (patch.title !== undefined && block.photoId) {
      const photo = entry.photos.find(item => item.id === block.photoId)
      if (photo) photo.caption = patch.title
    }
    entry.updatedAt = new Date().toISOString()
  }

  function applyLayout(entryId: string, spreads: JournalSpreadPlan[], aiCaption: string) {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry) return
    const ids = new Set(entry.blocks.map(block => block.id))
    entry.spreads = spreads.map((spread, index) => ({
      ...spread,
      blockIds: spread.blockIds.filter(id => ids.has(id)),
      placements: spread.placements ? withVerticalRhythm(spread.placements, index) : undefined
    })).filter(spread => spread.blockIds.length)
    entry.aiCaption = aiCaption
    entry.updatedAt = new Date().toISOString()
  }

  function setPhotoIllustration(
    entryId: string,
    photoId: string,
    illustration: JournalIllustration,
    deactivatePhotoIds: string[] = []
  ) {
    const entry = entries.value.find(item => item.id === entryId)
    const photo = entry?.photos.find(item => item.id === photoId)
    if (!entry || !photo) return
    const deactivated = new Set(deactivatePhotoIds)
    entry.photos.forEach(item => {
      if (deactivated.has(item.id)) item.illustrationEnabled = false
    })
    photo.illustration = illustration
    photo.illustrationEnabled = true
    for (const spread of entry.spreads) {
      const blockId = entry.blocks.find(block => block.photoId === photoId)?.id
      const placement = spread.placements?.find(item => item.blockId === blockId)
      if (placement) placement.photoTreatment = 'natural'
    }
    entry.updatedAt = new Date().toISOString()
  }

  function togglePhotoIllustration(entryId: string, photoId: string, enabled?: boolean, deactivatePhotoIds: string[] = []) {
    const entry = entries.value.find(item => item.id === entryId)
    const photo = entry?.photos.find(item => item.id === photoId)
    if (!entry || !photo?.illustration) return
    const deactivated = new Set(deactivatePhotoIds)
    entry.photos.forEach(item => {
      if (deactivated.has(item.id)) item.illustrationEnabled = false
    })
    photo.illustrationEnabled = enabled ?? !photo.illustrationEnabled
    entry.updatedAt = new Date().toISOString()
  }

  function removePhotoIllustration(entryId: string, photoId: string): string | undefined {
    const entry = entries.value.find(item => item.id === entryId)
    const photo = entry?.photos.find(item => item.id === photoId)
    if (!entry || !photo?.illustration) return undefined
    const assetId = photo.illustration.assetId
    photo.illustration = undefined
    photo.illustrationEnabled = false
    entry.updatedAt = new Date().toISOString()
    return assetId
  }

  function autoLayout(entryId: string) {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry) return
    entry.spreads = localSpreads(entry.blocks, entry.photos, entry.city)
    entry.aiCaption = buildCaption(entry)
    entry.updatedAt = new Date().toISOString()
  }

  function removeEntry(entryId: string): string[] {
    const assetIds = entries.value.find(entry => entry.id === entryId)?.photos
      .flatMap(photo => photo.illustration?.assetId ? [photo.illustration.assetId] : []) ?? []
    entries.value = entries.value.filter(entry => entry.id !== entryId)
    if (userId.value && navigator.onLine) void apiDeleteSyncedJournal(entryId).catch(() => undefined)
    return assetIds
  }

  function removeBlock(entryId: string, blockId: string): string[] {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry) return []
    const block = entry.blocks.find(item => item.id === blockId)
    const removedAssets: string[] = []
    entry.blocks = entry.blocks.filter(item => item.id !== blockId)
    if (block?.photoId && !entry.blocks.some(item => item.photoId === block.photoId)) {
      const assetId = entry.photos.find(photo => photo.id === block.photoId)?.illustration?.assetId
      if (assetId) removedAssets.push(assetId)
      entry.photos = entry.photos.filter(photo => photo.id !== block.photoId)
      entry.moments = entry.moments.map(moment => ({ ...moment, photos: moment.photos.filter(photo => photo.id !== block.photoId) }))
    }
    if (block?.sourceMomentId && !entry.blocks.some(item => item.sourceMomentId === block.sourceMomentId)) {
      entry.moments = entry.moments.filter(moment => moment.id !== block.sourceMomentId)
    }
    if (!entry.moments.length) entry.journey = undefined
    entry.spreads = localSpreads(entry.blocks, entry.photos, entry.city)
    entry.updatedAt = new Date().toISOString()
    return removedAssets
  }

  function removePhoto(entryId: string, photoId: string) {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry) return
    const blockIds = entry.blocks.filter(block => block.photoId === photoId).map(block => block.id)
    blockIds.forEach(blockId => removeBlock(entryId, blockId))
    entry.photos = entry.photos.filter(photo => photo.id !== photoId)
    entry.spreads = localSpreads(entry.blocks, entry.photos, entry.city)
  }

  function removeMoment(entryId: string, momentId: string) {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry) return
    const blockIds = entry.blocks.filter(block => block.sourceMomentId === momentId).map(block => block.id)
    blockIds.forEach(blockId => removeBlock(entryId, blockId))
    entry.moments = entry.moments.filter(moment => moment.id !== momentId)
    if (!entry.moments.length) entry.journey = undefined
    entry.updatedAt = new Date().toISOString()
  }

  function clearEntryContent(entryId: string): string[] {
    const entry = entries.value.find(item => item.id === entryId)
    if (!entry) return []
    const assetIds = entry.photos.flatMap(photo => photo.illustration?.assetId ? [photo.illustration.assetId] : [])
    entry.note = ''
    entry.photos = []
    entry.blocks = []
    entry.spreads = []
    entry.moments = []
    entry.journey = undefined
    entry.aiCaption = ''
    entry.updatedAt = new Date().toISOString()
    return assetIds
  }

  return {
    entries, activeWalk, walkSyncStatus, walkSyncError, walkLastSyncedAt,
    startWalk, updateLocation, addMoment, markStop, applyWalkAdjustment, undoWalkAdjustment, dismissDeviation,
    syncActiveWalk, restoreActiveWalk, createEntry, finishWalk,
    addStories, addPhotos, addTextBlock, updateEntry, updateBlock, applyLayout, autoLayout,
    setPhotoIllustration, togglePhotoIllustration, removePhotoIllustration,
    removeEntry, removeBlock, removePhoto, removeMoment, clearEntryContent
  }
}

export type JournalController = ReturnType<typeof useJournal>
