import { computed, ref, watch, type Ref } from 'vue'
import type { PlanningResult } from '../api/agent'

export interface GeoPoint {
  lng: number
  lat: number
  accuracy?: number
}

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

export interface ActiveWalk {
  id: string
  route: PlanningResult
  startedAt: string
  pausedAt?: string
  pausedMs: number
  currentLocation?: GeoPoint
  moments: WalkMoment[]
}

export interface ScrapbookEntry {
  id: string
  title: string
  city: string
  route?: PlanningResult
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
  for (let index = 0; index < blocks.length;) {
    const size = Math.min(2, blocks.length - index)
    groups.push(blocks.slice(index, index + size))
    index += size
  }
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
  // Migrate layouts saved by the earlier three-block algorithm. Reflowing once
  // is safer than preserving coordinates that are known to overflow the book.
  const safeSpreads = savedSpreads.some(spread => spread.blockIds.length > 2)
    ? localSpreads(blocks, photos, city)
    : savedSpreads
  return {
    id: value.id || uid('journal'), title: value.title || '', city, route: value.route,
    note: value.note || '', photos, blocks,
    spreads: safeSpreads.length ? safeSpreads : localSpreads(blocks, photos, city),
    moments, selectedStops: Array.isArray(value.selectedStops) ? value.selectedStops : [],
    aiCaption: value.aiCaption || '', createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || new Date().toISOString()
  }
}

function buildCaption(entry: Pick<ScrapbookEntry, 'city' | 'route' | 'note' | 'selectedStops' | 'blocks'>): string {
  const places = entry.selectedStops.length ? entry.selectedStops.slice(0, 3) : entry.route?.stops.slice(0, 3).map(stop => stop.name) ?? []
  const placeText = places.length ? `从${places.join('、')}一路走过` : `在${entry.city || '城市'}慢慢行走`
  const text = entry.blocks.map(block => block.text).find(Boolean) || entry.note
  return `${placeText}，把路上的光、声音和偶然相遇收进这一页。${text ? ` ${short(text, 90)}` : ''}`.trim()
}

export function useJournal(userId: Ref<string | undefined>) {
  const entries = ref<ScrapbookEntry[]>([])
  const activeWalk = ref<ActiveWalk | null>(null)
  const storageKey = computed(() => `citywalk-journal:${userId.value ?? 'anonymous'}`)

  function load() {
    try {
      const value = localStorage.getItem(storageKey.value)
      const parsed = value ? JSON.parse(value) as { entries?: Array<Partial<ScrapbookEntry>>; activeWalk?: ActiveWalk | null } : undefined
      entries.value = Array.isArray(parsed?.entries) ? parsed.entries.map(normalizeEntry) : []
      activeWalk.value = parsed?.activeWalk ?? null
    } catch {
      entries.value = []
      activeWalk.value = null
    }
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

  function startWalk(route: PlanningResult) {
    activeWalk.value = { id: uid('walk'), route, startedAt: new Date().toISOString(), pausedMs: 0, moments: [] }
  }

  function updateLocation(point: GeoPoint) {
    if (activeWalk.value) activeWalk.value.currentLocation = point
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
    const selectedStops = [...new Set(walk.moments.map(moment => moment.stopName).filter((name): name is string => Boolean(name)))]
    const city = walk.route.routeOverview?.city ?? ''
    const entry: ScrapbookEntry = {
      id: uid('journal'), title: walk.route.title, city, route: walk.route,
      note: walk.moments.map(moment => moment.note).filter(Boolean).join('\n'), photos, blocks,
      spreads: localSpreads(blocks, photos, city), moments: walk.moments,
      selectedStops: selectedStops.length ? selectedStops : walk.route.stops.map(stop => stop.name),
      aiCaption: '', createdAt: walk.startedAt, updatedAt: now
    }
    entry.aiCaption = buildCaption(entry)
    entries.value.unshift(entry)
    activeWalk.value = null
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
    entry.aiCaption = ''
    entry.updatedAt = new Date().toISOString()
    return assetIds
  }

  return {
    entries, activeWalk, startWalk, updateLocation, addMoment, createEntry, finishWalk,
    addStories, addPhotos, addTextBlock, updateEntry, updateBlock, applyLayout, autoLayout,
    setPhotoIllustration, togglePhotoIllustration, removePhotoIllustration,
    removeEntry, removeBlock, removePhoto, removeMoment, clearEntryContent
  }
}

export type JournalController = ReturnType<typeof useJournal>
