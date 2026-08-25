<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  PhArrowLeft, PhArrowRight, PhCaretLeft, PhCaretRight, PhCompass,
  PhImage, PhPlus, PhShareNetwork, PhSparkle, PhTrash,
} from '@phosphor-icons/vue'
import { apiDeleteJournalIllustration, apiGenerateJournalIllustration, apiGenerateJournalLayout, apiSendRouteToMobile } from '../api/agent'
import type { JournalBlock, JournalBlockPlacement, JournalController, JournalPhoto, JournalStoryDraft } from '../composables/useJournal'
import type { NavigateWorkspace } from '../workspace'
import ZineDecorations from './ZineDecorations.vue'
import JourneyRouteLayer from './JourneyRouteLayer.vue'

interface PendingStory {
  id: string
  file: File
  preview: string
  title: string
  text: string
  placeName: string
}

interface JourneyPinMeta {
  order: number
  number: string
  label: string
  branch: boolean
  located: boolean
  momentId: string
}

type IllustrationPresetId = 'scene-distillation' | 'solid-color-block'

const journal = inject<JournalController>('journal')!
const navigate = inject<NavigateWorkspace>('navigate')!
const selectedId = ref<string | null>(null)
const view = ref<'library' | 'book'>('library')
const pageIndex = ref(0)
const turnDirection = ref<'next' | 'prev' | null>(null)
const turnPhase = ref<'covering' | 'revealing' | null>(null)
const openBookElement = ref<HTMLElement | null>(null)
const turnFrontMarkup = ref('')
const turnBackMarkup = ref('')
const generating = ref(false)
const copied = ref(false)
const composerOpen = ref(false)
const pendingStories = ref<PendingStory[]>([])
const savingStories = ref(false)
const layoutNotice = ref('')
const illustrating = ref(false)
const illustrationTargetId = ref<string | null>(null)
const DISTILLATION_STYLE = '触感平面纸刊插画：干墨、断续轮廓、纸纤维与克制印刷颗粒，所有形式服务于照片关系中发现的表达命题'
const illustrationStyle = ref(DISTILLATION_STYLE)
const illustrationPresetId = ref<IllustrationPresetId | undefined>('scene-distillation')
const illustrationError = ref('')
let illustrationLayoutRefreshPending = false

const illustrationPresets = [
  { id: 'scene-distillation' as const, name: '场景蒸馏', value: DISTILLATION_STYLE },
  { id: 'solid-color-block' as const, name: '单色块模式', value: '单色块模式：一整块高饱和色域作为核心空间，其他插画形式全部使用炭黑、石墨与暖灰中性墨色' }
]

const entry = computed(() => journal.entries.value.find(item => item.id === selectedId.value) ?? null)
const totalSpreads = computed(() => Math.max(1, entry.value?.spreads.length ?? 0))
const currentSpread = computed(() => entry.value?.spreads[pageIndex.value] ?? null)
const currentBlocks = computed(() => {
  if (!entry.value || !currentSpread.value) return []
  const map = new Map(entry.value.blocks.map(block => [block.id, block]))
  return currentSpread.value.blockIds.map(id => map.get(id)).filter((block): block is JournalBlock => Boolean(block))
})
const isJourneyNarrative = computed(() => Boolean(entry.value?.journey && entry.value.moments.length))
const journeySpreadIndices = computed(() => {
  if (!entry.value?.journey) return []
  const journeyBlockIds = new Set(entry.value.blocks.filter(block => block.sourceMomentId).map(block => block.id))
  return entry.value.spreads.flatMap((spread, index) => spread.blockIds.some(id => journeyBlockIds.has(id)) ? [index] : [])
})
const journeyHasPrevious = computed(() => journeySpreadIndices.value.some(index => index < pageIndex.value))
const journeyHasNext = computed(() => journeySpreadIndices.value.some(index => index > pageIndex.value))
const previousJourneyNumber = computed(() => journeyNumberOnAdjacentSpread('previous'))
const nextJourneyNumber = computed(() => journeyNumberOnAdjacentSpread('next'))
const currentVisualDirection = computed(() => {
  const direction = currentSpread.value?.visualDirection
  if (!direction || !isJourneyNarrative.value) return direction
  return { ...direction, decorations: direction.decorations.filter(decoration => decoration.kind !== 'route-line') }
})
const journeyRouteNodes = computed(() => currentBlocks.value.flatMap((block, index) => {
  const pin = journeyPinFor(block)
  if (!pin) return []
  const placement = placementFor(block.id)
  const page = placement?.page ?? (currentBlocks.value.length === 2 ? index === 0 ? 'left' : 'right' : pageIndex.value % 2 ? 'right' : 'left')
  const localX = placement?.x ?? 10
  const localY = placement?.y ?? 28 + index * 12
  return [{
    blockId: block.id,
    momentId: pin.momentId,
    order: pin.order,
    number: pin.number,
    label: pin.label,
    branch: pin.branch,
    located: pin.located,
    page,
    x: (page === 'right' ? 500 : 0) + localX * 5,
    y: localY * 6.4
  }]
}))
const journeyOverview = computed(() => {
  const value = entry.value
  if (!value?.journey) return undefined
  const firstMoment = value.moments[0]
  const lastMoment = value.moments[value.moments.length - 1]
  const routeStops = value.route?.stops ?? []
  const start = firstMoment?.stopName || value.route?.routeOverview?.startPoint || routeStops[0]?.name || '起点'
  const end = lastMoment?.stopName || routeStops[routeStops.length - 1]?.name || '终点'
  const totalMinutes = Math.max(1, Math.round(value.journey.durationMs / 60000))
  const duration = totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, '0')}m` : `${totalMinutes} min`
  const stops = routeStops.slice(0, 6).map((stop, index) => ({
    name: stop.name,
    number: String(index + 1).padStart(2, '0'),
    recorded: value.moments.some(moment => moment.stopIndex === index || moment.stopName === stop.name)
  }))
  return { start, end, duration, count: value.moments.length, stops, hiddenStops: Math.max(0, routeStops.length - stops.length) }
})
const illustrationTarget = computed(() => entry.value?.blocks.find(block => block.id === illustrationTargetId.value) ?? null)
const illustrationTargetPhoto = computed(() => illustrationTarget.value ? photoFor(illustrationTarget.value) : undefined)
const anchorPageClass = computed(() => {
  if (currentBlocks.value.length === 2) return 'anchor-split'
  if (currentSpread.value?.anchorPage === 'right') return 'anchor-right'
  if (currentSpread.value?.anchorPage === 'left') return 'anchor-left'
  return pageIndex.value % 2 ? 'anchor-right' : 'anchor-left'
})
const isBlank = computed(() => Boolean(entry.value && !entry.value.title && !entry.value.note && !entry.value.blocks.length && !entry.value.aiCaption))

let pageTurnToken = 0
let pageTurnTimers: number[] = []

watch(entry, () => {
  cancelPageTurn()
  pageIndex.value = 0
})
watch(totalSpreads, value => { pageIndex.value = Math.min(pageIndex.value, value - 1) })
watch(generating, value => {
  if (!value && illustrationLayoutRefreshPending) void runPendingIllustrationLayoutRefresh()
})
onBeforeUnmount(cancelPageTurn)

function openBook(id: string) {
  const target = journal.entries.value.find(item => item.id === id)
  if (target?.spreads.some(spread => spread.blockIds.length > 2)) journal.autoLayout(id)
  selectedId.value = id
  pageIndex.value = 0
  view.value = 'book'
}

function createBlank() {
  const created = journal.createEntry()
  openBook(created.id)
}

function photoFor(block: JournalBlock): JournalPhoto | undefined {
  return entry.value?.photos.find(photo => photo.id === block.photoId)
}

function journeyPinFor(block: JournalBlock): JourneyPinMeta | undefined {
  const value = entry.value
  if (!value?.journey || !block.sourceMomentId) return undefined
  const order = value.moments.findIndex(moment => moment.id === block.sourceMomentId)
  if (order < 0) return undefined
  const moment = value.moments[order]
  const firstBlock = value.blocks.find(item => item.sourceMomentId === block.sourceMomentId)
  return {
    order,
    number: String(order + 1).padStart(2, '0'),
    label: moment.stopName || '沿途记录',
    branch: firstBlock?.id !== block.id,
    located: Boolean(moment.location),
    momentId: moment.id
  }
}

function journeyNumberOnAdjacentSpread(direction: 'previous' | 'next'): string | undefined {
  const value = entry.value
  if (!value) return undefined
  const candidates = journeySpreadIndices.value.filter(index => direction === 'previous' ? index < pageIndex.value : index > pageIndex.value)
  const spreadIndex = direction === 'previous' ? candidates[candidates.length - 1] : candidates[0]
  const spread = value.spreads[spreadIndex]
  if (!spread) return undefined
  const blockIds = direction === 'previous' ? [...spread.blockIds].reverse() : spread.blockIds
  for (const blockId of blockIds) {
    const block = value.blocks.find(item => item.id === blockId)
    const pin = block ? journeyPinFor(block) : undefined
    if (pin) return pin.number
  }
  return undefined
}

function displayedPhotoUrl(photo?: JournalPhoto): string {
  if (!photo?.illustrationEnabled || !photo.illustration) return photo?.url ?? ''
  if (photo.illustration.mode === 'gathered-collage') return photo.illustration.url
  const separator = photo.illustration.url.includes('?') ? '&' : '?'
  return `${photo.illustration.url}${separator}render=transparent-cutout-v2`
}

function illustrationModeFor(photo?: JournalPhoto): 'distilled-contour' | 'gathered-collage' | undefined {
  if (!photo?.illustrationEnabled || !photo.illustration) return undefined
  return photo.illustration.mode === 'gathered-collage' ? 'gathered-collage' : 'distilled-contour'
}

function renderModeFor(photo?: JournalPhoto): 'original-photo' | 'cutout-illustration' | 'gathered-collage' {
  const mode = illustrationModeFor(photo)
  return mode === 'gathered-collage' ? 'gathered-collage' : mode === 'distilled-contour' ? 'cutout-illustration' : 'original-photo'
}

function illustrationLabel(photo?: JournalPhoto): string {
  return illustrationModeFor(photo) === 'gathered-collage' ? 'AI 极简纸刊' : 'AI 场景蒸馏'
}

function handleDisplayedPhotoError(photo?: JournalPhoto) {
  if (!entry.value || !photo?.illustrationEnabled) return
  journal.togglePhotoIllustration(entry.value.id, photo.id, false)
  layoutNotice.value = '插画文件暂时无法读取，已自动恢复原始照片'
  window.setTimeout(() => { layoutNotice.value = '' }, 6000)
}

function otherSpreadPhotoIds(photoId: string): string[] {
  return currentBlocks.value
    .flatMap(block => {
      const photo = photoFor(block)
      return photo && photo.id !== photoId ? [photo.id] : []
    })
}

function orientationFor(photo?: JournalPhoto): 'portrait' | 'landscape' | 'square' {
  const ratio = photo?.aspectRatio ?? 1
  return ratio > 1.18 ? 'landscape' : ratio < .84 ? 'portrait' : 'square'
}

function placementFor(blockId: string): JournalBlockPlacement | undefined {
  return currentSpread.value?.placements?.find(placement => placement.blockId === blockId)
}

function placementStyle(blockId: string): Record<string, string | number> | undefined {
  const placement = placementFor(blockId)
  if (!placement) return undefined
  const left = (placement.page === 'right' ? 50 : 0) + placement.x / 2
  return {
    '--ai-left': `${left}%`,
    '--ai-top': `${placement.y}%`,
    '--ai-width': `${placement.width / 2}%`,
    '--ai-rotation': `${placement.rotation}deg`,
    zIndex: Math.round(placement.zIndex)
  }
}

function placementClasses(blockId: string): string[] {
  const placement = placementFor(blockId)
  return placement
    ? [`text-${placement.textPlacement}`, `tape-${placement.tapePosition}`]
    : []
}

async function visionThumbnail(photo: JournalPhoto): Promise<string | undefined> {
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image()
      value.onload = () => resolve(value)
      value.onerror = () => reject(new Error('无法读取视觉分析缩略图'))
      value.src = photo.url
    })
    const maxSide = 768
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) return undefined
    context.fillStyle = '#f4f0e6'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    let output = canvas.toDataURL('image/jpeg', .72)
    if (output.length > 780_000) output = canvas.toDataURL('image/jpeg', .5)
    return output.length <= 800_000 ? output : undefined
  } catch {
    return undefined
  }
}

function openComposer() {
  composerOpen.value = true
}

function addPendingFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  pendingStories.value.push(...files.map(file => ({
    id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    file,
    preview: URL.createObjectURL(file),
    title: file.name.replace(/\.[^.]+$/, ''),
    text: '',
    placeName: ''
  })))
  input.value = ''
}

function removePending(id: string) {
  const item = pendingStories.value.find(story => story.id === id)
  if (item) URL.revokeObjectURL(item.preview)
  pendingStories.value = pendingStories.value.filter(story => story.id !== id)
}

function closeComposer() {
  pendingStories.value.forEach(story => URL.revokeObjectURL(story.preview))
  pendingStories.value = []
  composerOpen.value = false
}

async function saveStories() {
  if (!entry.value || !pendingStories.value.length || savingStories.value) return
  savingStories.value = true
  const drafts: JournalStoryDraft[] = pendingStories.value.map(story => ({
    file: story.file, title: story.title, text: story.text, placeName: story.placeName
  }))
  await journal.addStories(entry.value.id, drafts)
  savingStories.value = false
  closeComposer()
  pageIndex.value = Math.max(0, totalSpreads.value - 1)
}

function addTextOnly() {
  if (!entry.value) return
  journal.addTextBlock(entry.value.id, '新的文字片段', '点击这里，写下照片之外的声音、气味或一句没有说完的话。')
  closeComposer()
  pageIndex.value = Math.max(0, totalSpreads.value - 1)
}

function updateTitle(event: Event) {
  if (entry.value) journal.updateEntry(entry.value.id, { title: (event.target as HTMLInputElement).value })
}

function updateNote(event: Event) {
  if (entry.value) journal.updateEntry(entry.value.id, { note: (event.target as HTMLTextAreaElement).value })
}

function updateBlock(blockId: string, field: 'title' | 'text' | 'placeName', event: Event) {
  if (!entry.value) return
  journal.updateBlock(entry.value.id, blockId, { [field]: (event.target as HTMLInputElement | HTMLTextAreaElement).value })
}

function removeBlock(blockId: string) {
  if (!entry.value || !window.confirm('确定删除这组图文吗？对应照片也会从本手账移除。')) return
  cleanupAssets(journal.removeBlock(entry.value.id, blockId))
}

function openIllustrationComposer(block: JournalBlock) {
  const photo = photoFor(block)
  if (!photo) return
  illustrationTargetId.value = block.id
  const savedStyle = photo.illustration?.mode === 'distilled-contour' ? photo.illustration.styleDescription : undefined
  const matchedPreset = illustrationPresets.find(preset => preset.value === savedStyle)
  const defaultPreset = illustrationPresets[0]
  illustrationPresetId.value = matchedPreset?.id ?? (savedStyle ? undefined : defaultPreset.id)
  illustrationStyle.value = savedStyle || defaultPreset.value
  illustrationError.value = ''
}

function closeIllustrationComposer() {
  if (illustrating.value) return
  illustrationTargetId.value = null
  illustrationError.value = ''
}

function chooseIllustrationPreset(preset: typeof illustrationPresets[number]) {
  illustrationPresetId.value = preset.id
  illustrationStyle.value = preset.value
}

function markIllustrationStyleCustom() {
  illustrationPresetId.value = undefined
}

async function generateIllustration() {
  const targetEntry = entry.value
  const block = illustrationTarget.value
  const photo = illustrationTargetPhoto.value
  if (!targetEntry || !block || !photo || illustrating.value) return
  illustrating.value = true
  illustrationError.value = ''
  let successNotice = ''
  try {
    const previousAssetId = photo.illustration?.assetId
    const result = await apiGenerateJournalIllustration({
      sourceImage: photo.url,
      blockId: block.id,
      photoId: photo.id,
      mode: 'distilled-contour',
      title: block.title || undefined,
      text: block.text || undefined,
      placeName: block.placeName || undefined,
      city: targetEntry.city || undefined,
      stylePresetId: illustrationPresetId.value,
      styleDescription: illustrationStyle.value.trim() || undefined
    })
    journal.setPhotoIllustration(targetEntry.id, photo.id, {
      assetId: result.assetId,
      url: result.imageUrl,
      model: result.model,
      prompt: result.prompt,
      styleDescription: result.styleDescription,
      mode: result.mode,
      generatedAt: result.generatedAt
    }, otherSpreadPhotoIds(photo.id))
    if (previousAssetId && previousAssetId !== result.assetId) void apiDeleteJournalIllustration(previousAssetId)
    illustrationTargetId.value = null
    illustrationError.value = ''
    const resultName = '场景蒸馏插画'
    successNotice = result.cached
      ? `已应用${resultName}；命中缓存，没有新的生图调用。手账将在后台重新排版`
      : `已通过 ${result.workflow.skill} ${result.workflow.version} 生成${resultName}；视觉分析${result.workflow.visionUsed ? '已参与' : '本次使用安全卡片'}，手账将在后台重新排版`
  } catch (error) {
    const raw = error instanceof Error ? error.message : '生成失败'
    try {
      const json = JSON.parse(raw.replace(/^\[\d+\]\s*/u, '')) as { message?: string }
      illustrationError.value = json.message || raw
    } catch {
      illustrationError.value = raw.replace(/^\[\d+\]\s*/u, '').slice(0, 180)
    }
  } finally {
    illustrating.value = false
  }
  if (successNotice) {
    layoutNotice.value = successNotice
    await nextTick()
    scheduleIllustrationLayoutRefresh()
  }
}

function scheduleIllustrationLayoutRefresh() {
  illustrationLayoutRefreshPending = true
  void runPendingIllustrationLayoutRefresh()
}

async function runPendingIllustrationLayoutRefresh() {
  if (!illustrationLayoutRefreshPending || generating.value || illustrating.value) return
  illustrationLayoutRefreshPending = false
  await generateLayout()
  if (illustrationLayoutRefreshPending) void runPendingIllustrationLayoutRefresh()
}

function toggleIllustration(photo: JournalPhoto) {
  if (!entry.value || !photo.illustration) return
  journal.togglePhotoIllustration(
    entry.value.id,
    photo.id,
    !photo.illustrationEnabled,
    photo.illustrationEnabled ? [] : otherSpreadPhotoIds(photo.id)
  )
}

function removeIllustration(photo: JournalPhoto) {
  if (!entry.value || !photo.illustration || !window.confirm('删除这张 AI 插画并恢复原始照片吗？')) return
  const assetId = journal.removePhotoIllustration(entry.value.id, photo.id)
  if (assetId) void apiDeleteJournalIllustration(assetId)
}

function cleanupAssets(assetIds: string[]) {
  assetIds.forEach(assetId => { void apiDeleteJournalIllustration(assetId) })
}

function toggleStop(name: string) {
  if (!entry.value) return
  const selectedStops = entry.value.selectedStops.includes(name)
    ? entry.value.selectedStops.filter(item => item !== name)
    : [...entry.value.selectedStops, name]
  journal.updateEntry(entry.value.id, { selectedStops })
}

async function generateLayout() {
  if (!entry.value || generating.value || !entry.value.blocks.length) return
  generating.value = true
  layoutNotice.value = entry.value.photos.length
    ? `正在分析 ${Math.min(entry.value.photos.length, 8)} 张照片并重新组织跨页…`
    : '正在理解文字关系并重新组织跨页…'
  const photoMap = new Map(entry.value.photos.map(photo => [photo.id, photo]))
  try {
    const visionCandidates = entry.value.blocks
      .flatMap(block => {
        const photo = photoMap.get(block.photoId ?? '')
        return photo ? [{ blockId: block.id, photo }] : []
      })
      .slice(0, 8)
    const images = (await Promise.all(visionCandidates.map(async item => {
      const imageUrl = await visionThumbnail(item.photo)
      return imageUrl ? { blockId: item.blockId, imageUrl } : undefined
    }))).filter((item): item is { blockId: string; imageUrl: string } => Boolean(item))
    const response = await apiGenerateJournalLayout({
      title: entry.value.title,
      city: entry.value.city || undefined,
      note: entry.value.note || undefined,
      routeStops: entry.value.selectedStops,
      narrativeMode: isJourneyNarrative.value ? 'route-journey' : 'freeform',
      currentRecipes: entry.value.spreads.map(spread => spread.recipe),
      currentPlacements: entry.value.spreads.flatMap(spread => spread.placements ?? []),
      images,
      blocks: entry.value.blocks.map(block => {
        const photo = photoMap.get(block.photoId ?? '')
        const pin = journeyPinFor(block)
        return {
          id: block.id, kind: block.kind, title: block.title, text: block.text,
          renderMode: renderModeFor(photo),
          placeName: block.placeName, aspectRatio: photo?.aspectRatio,
          orientation: block.kind === 'photo-text' ? orientationFor(photo) : undefined,
          journeyOrder: pin?.order,
          journeyMomentId: pin?.momentId,
          journeyBranch: pin?.branch
        }
      })
    })
    journal.applyLayout(entry.value.id, response.spreads, response.aiCaption)
    pageIndex.value = 0
    const placedElements = response.spreads.reduce((total, spread) => total + (spread.placements?.length ?? 0), 0)
    layoutNotice.value = response.vision?.used
      ? `AI 已编排 ${placedElements} 个元素 · 分析了 ${response.vision.analyzed} 张照片但未修改原图`
      : response.mode === 'ai'
        ? `AI 已编排 ${placedElements} 个元素且未修改原图 · ${response.vision?.message || '本次仅使用图文信息'}`
        : 'AI 服务本次不可用，已安全拆页并采用本地版式'
  } catch (error) {
    console.error('[Journal] AI layout request failed', error)
    journal.autoLayout(entry.value.id)
    layoutNotice.value = `排版请求失败，已安全拆页：${error instanceof Error ? error.message.replace(/^\[\d+\]\s*/u, '').slice(0, 90) : '未知错误'}`
  } finally {
    generating.value = false
    window.setTimeout(() => { layoutNotice.value = '' }, 8000)
  }
}

function captureSpreadMarkup(): string {
  const source = openBookElement.value?.querySelector<HTMLElement>(':scope > .spread-layer')
  if (!source) return ''
  const clone = source.cloneNode(true) as HTMLElement
  const sourceFields = source.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  const cloneFields = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
  sourceFields.forEach((field, index) => {
    const target = cloneFields[index]
    if (!target) return
    if (target instanceof HTMLTextAreaElement) target.textContent = field.value
    else target.setAttribute('value', field.value)
  })
  clone.querySelectorAll('button').forEach(button => button.remove())
  clone.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'))
  return clone.outerHTML
}

function cancelPageTurn() {
  pageTurnToken += 1
  pageTurnTimers.forEach(timer => window.clearTimeout(timer))
  pageTurnTimers = []
  turnDirection.value = null
  turnPhase.value = null
  turnFrontMarkup.value = ''
  turnBackMarkup.value = ''
}

function turnPage(delta: number, requestedIndex?: number) {
  const next = requestedIndex ?? pageIndex.value + delta
  if (turnDirection.value || next < 0 || next >= totalSpreads.value) return
  if (next === pageIndex.value) return
  const direction = next > pageIndex.value ? 'next' : 'prev'
  const token = ++pageTurnToken
  turnFrontMarkup.value = captureSpreadMarkup()
  turnBackMarkup.value = ''
  turnPhase.value = 'covering'
  turnDirection.value = direction
  const midpoint = window.setTimeout(async () => {
    if (token !== pageTurnToken) return
    pageIndex.value = next
    await nextTick()
    if (token !== pageTurnToken) return
    turnBackMarkup.value = captureSpreadMarkup()
    turnPhase.value = 'revealing'
  }, 410)
  const finish = window.setTimeout(() => {
    if (token !== pageTurnToken) return
    cancelPageTurn()
  }, 840)
  pageTurnTimers = [midpoint, finish]
}

async function shareEntry() {
  if (!entry.value) return
  const content = entry.value.blocks.map(block => `${block.title}\n${block.text}`.trim()).filter(Boolean).join('\n\n')
  await navigator.clipboard?.writeText(`${entry.value.title}\n${entry.value.aiCaption || entry.value.note}\n${content}`.trim())
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1300)
}

function removeBook(id: string, title: string) {
  if (!window.confirm(`确定删除整本“${title || '空白手账'}”吗？删除后无法恢复。`)) return
  cleanupAssets(journal.removeEntry(id))
}

function clearContent() {
  if (!entry.value || !window.confirm('确定清空本手账中的文字、照片和沿途记录吗？路线与书名会保留。')) return
  cleanupAssets(journal.clearEntryContent(entry.value.id))
  pageIndex.value = 0
}

async function startEntryWalk() {
  if (!entry.value?.route) return
  await apiSendRouteToMobile(entry.value.route)
  navigate('walk')
}
</script>

<template>
  <main class="scrapbook-page paper-canvas" :class="{ reading: view === 'book' }">
    <section v-if="view === 'library'" class="book-library">
      <header class="library-heading">
        <div><small>MY TRAVEL SCRAPBOOK</small><h2>手账书架</h2><p>每次漫步都是一本可以继续书写、重新翻阅的小书。</p></div>
        <button class="outline" @click="createBlank"><PhPlus :size="16" weight="bold" /> 空白手账</button>
      </header>

      <div class="shelf">
        <article v-for="(book, index) in journal.entries.value" :key="book.id" class="book-item">
          <button class="closed-book" :class="`tone-${index % 4}`" @click="openBook(book.id)">
            <span class="pages"/><span class="spine"/>
            <span class="cover">
              <small>CITYWALK JOURNAL · {{ String(index + 1).padStart(2, '0') }}</small>
              <i><PhCompass :size="28" weight="duotone" /></i>
              <strong>{{ book.title || 'BLANK JOURNAL' }}</strong>
              <em>{{ book.city || 'FOR THE WANDERING SOUL' }}</em>
              <b>{{ new Date(book.createdAt).getFullYear() }}</b>
            </span>
            <span class="book-caption"><strong>{{ book.title || '空白手账' }}</strong><small>{{ book.journey ? `${book.moments.length} 枚路线图钉 · ${Math.max(1, book.spreads.length)} 个跨页` : book.blocks.length ? `${book.blocks.length} 组图文 · ${Math.max(1, book.spreads.length)} 个跨页` : '内页空白 · 点击开始书写' }}</small></span>
          </button>
          <button class="delete-book" @click="removeBook(book.id, book.title)"><PhTrash :size="14" /> 删除手账</button>
        </article>
        <button class="new-book-object" @click="createBlank"><span><PhPlus :size="28" /></span><strong>新建一本空白手账</strong><small>打开后从第一页开始</small></button>
      </div>
    </section>

    <section v-else-if="entry" class="book-reader">
      <header class="book-toolbar">
        <button class="back-library" @click="view = 'library'"><PhArrowLeft :size="15" /> 返回书架</button>
        <div class="toolbar-title"><small>OPEN SCRAPBOOK</small><strong>{{ entry.title || '空白手账' }}</strong></div>
        <span class="toolbar-space"/>
        <span v-if="layoutNotice" class="layout-notice" role="status" aria-live="polite">{{ layoutNotice }}</span>
        <button @click="openComposer"><PhPlus :size="15" /> 添加图文</button>
        <button :class="{ generating }" :disabled="generating || !entry.blocks.length" title="只调整图文位置与页面装饰，不处理照片、不调用生图" @click="generateLayout"><PhSparkle :size="15" /> {{ generating ? '正在理解图文…' : 'AI 智能排版' }}</button>
        <button class="light" @click="shareEntry"><PhShareNetwork :size="15" /> {{ copied ? '已复制' : '分享文字' }}</button>
        <button class="clear-content" :disabled="isBlank" @click="clearContent">清空内容</button>
      </header>

      <div class="reader-stage">
        <button class="page-arrow prev" aria-label="上一页" :disabled="pageIndex === 0" @click="turnPage(-1)"><PhCaretLeft :size="22" /></button>
        <div
          ref="openBookElement"
          class="open-book"
          :class="[
            turnDirection ? `turn-${turnDirection}` : '',
            turnPhase ? `turn-${turnPhase}` : '',
            currentSpread ? `recipe-${currentSpread.recipe}` : 'recipe-empty',
            currentSpread ? `accent-${currentSpread.accent}` : 'accent-cobalt',
            currentSpread?.visualDirection ? `type-${currentSpread.visualDirection.typographyMode}` : 'type-quiet-serif',
            currentSpread?.visualDirection ? `texture-${currentSpread.visualDirection.textureMode}` : 'texture-paper-fibers',
            anchorPageClass,
            { 'journey-narrative': isJourneyNarrative }
          ]"
        >
          <section class="paper-page left-page"><span class="page-count">{{ pageIndex * 2 + 1 }}</span></section>
          <section class="paper-page right-page"><span class="page-count">{{ pageIndex * 2 + 2 }}</span></section>

          <div :key="`${entry.id}:${pageIndex}`" class="spread-layer">
            <template v-if="currentSpread">
              <span class="zine-texture-layer" aria-hidden="true" />
              <ZineDecorations
                v-if="currentVisualDirection"
                :direction="currentVisualDirection"
                :accent="currentSpread.accent"
                :spread-id="currentSpread.id"
              />
              <JourneyRouteLayer
                v-if="isJourneyNarrative && journeyRouteNodes.length"
                :nodes="journeyRouteNodes"
                :accent="currentSpread.accent"
                :spread-id="currentSpread.id"
                :has-previous="journeyHasPrevious"
                :has-next="journeyHasNext"
                :previous-number="previousJourneyNumber"
                :next-number="nextJourneyNumber"
              />
              <div :class="['zine-type-layer', `mode-${currentSpread.visualDirection?.typographyMode || 'quiet-serif'}`]" aria-hidden="true">
                <b class="type-fragment">{{ currentSpread.headline.slice(0, 2) }}</b>
                <span class="type-index">{{ currentSpread.microtext }} · {{ String(pageIndex + 1).padStart(2, '0') }}</span>
                <i class="type-note">WALK / OBSERVE / KEEP</i>
              </div>
              <header class="spread-heading">
                <small>{{ currentSpread.microtext }}</small>
                <strong>{{ currentSpread.headline }}</strong>
                <p>{{ currentSpread.rationale }}</p>
              </header>

              <div v-if="pageIndex === 0" class="book-identity">
                <input :value="entry.title" aria-label="手账标题" placeholder="给这本手账起个名字" @input="updateTitle" />
                <textarea :value="entry.note" aria-label="手账导语" placeholder="写一段整本手账的开场…" @input="updateNote" />
              </div>

              <aside v-if="pageIndex === 0 && journeyOverview" class="journey-overview">
                <small>ROUTE NARRATIVE · {{ journeyOverview.count }} PINS</small>
                <strong><i><em>01</em></i>{{ journeyOverview.start }} <span>→</span> {{ journeyOverview.end }}</strong>
                <p>{{ journeyOverview.duration }} · 按真实记录顺序连接</p>
                <div v-if="journeyOverview.stops.length" class="journey-stop-strip" aria-label="计划路线与已记录地点">
                  <span v-for="stop in journeyOverview.stops" :key="`${stop.number}:${stop.name}`" :class="{ recorded: stop.recorded }" :title="stop.recorded ? `${stop.name} · 已记录` : `${stop.name} · 计划经过`">
                    <i>{{ stop.number }}</i><em>{{ stop.name }}</em>
                  </span>
                  <b v-if="journeyOverview.hiddenStops">+{{ journeyOverview.hiddenStops }}</b>
                </div>
              </aside>

              <div class="block-cluster" :class="[`blocks-${currentBlocks.length}`, { 'ai-geometry': currentSpread.placements?.length }]">
                <article
                  v-for="(block, index) in currentBlocks"
                  :key="block.id"
                  class="zine-block"
                  :class="[
                    `block-${index + 1}`,
                    `photo-${orientationFor(photoFor(block))}`,
                    ...placementClasses(block.id),
                    {
                      'cutout-illustration': Boolean(illustrationModeFor(photoFor(block))),
                      'gathered-collage': illustrationModeFor(photoFor(block)) === 'gathered-collage',
                      'journey-block': Boolean(journeyPinFor(block)),
                      'journey-branch': Boolean(journeyPinFor(block)?.branch)
                    }
                  ]"
                  :style="placementStyle(block.id)"
                >
                  <button class="remove-block" title="删除这组图文" @click="removeBlock(block.id)"><PhTrash :size="13" /></button>
                  <span
                    v-if="journeyPinFor(block)"
                    class="journey-pin"
                    :class="{ branch: journeyPinFor(block)?.branch, unlocated: !journeyPinFor(block)?.located }"
                    :title="journeyPinFor(block)?.branch ? '同一记录点的附属照片' : '漫步记录点'"
                  >
                    <b><em>{{ journeyPinFor(block)?.number }}</em></b>
                    <small>{{ journeyPinFor(block)?.branch ? '同站分支' : journeyPinFor(block)?.label }}</small>
                  </span>
                  <template v-if="photoFor(block)?.illustrationEnabled && photoFor(block)?.illustration">
                    <figure class="cutout-art" :class="{ 'gathered-art': illustrationModeFor(photoFor(block)) === 'gathered-collage' }">
                      <img :src="displayedPhotoUrl(photoFor(block))" :alt="block.title" @error="handleDisplayedPhotoError(photoFor(block))" />
                      <span class="illustration-badge">{{ illustrationLabel(photoFor(block)) }}</span>
                      <div class="photo-ai-actions">
                        <button @click.stop="toggleIllustration(photoFor(block)!)">看原照</button>
                        <button title="重新选择风格并生成；相同参数会命中缓存" @click.stop="openIllustrationComposer(block)"><PhSparkle :size="13" /> 重做</button>
                        <button class="remove-illustration" title="删除生成插画" @click.stop="removeIllustration(photoFor(block)!)"><PhTrash :size="12" /></button>
                      </div>
                    </figure>
                    <div class="floating-story">
                      <input :value="block.title" aria-label="图文标题" placeholder="这一刻的标题" @input="updateBlock(block.id, 'title', $event)" />
                      <textarea :value="block.text" aria-label="照片对应文字" placeholder="写下与这张照片对应的文字…" @input="updateBlock(block.id, 'text', $event)" />
                      <input v-if="block.placeName" class="place-input" :value="block.placeName" aria-label="拍摄地点或时间" @input="updateBlock(block.id, 'placeName', $event)" />
                    </div>
                  </template>
                  <template v-else>
                  <figure v-if="photoFor(block)" class="photo-anchor">
                    <img :src="photoFor(block)!.url" :alt="block.title" />
                    <div class="photo-ai-actions">
                      <button v-if="!photoFor(block)!.illustration" title="调用视觉分析与 Seedream 生成 1 张插画" @click.stop="openIllustrationComposer(block)"><PhSparkle :size="13" /> AI 插画</button>
                      <template v-else>
                        <button @click.stop="toggleIllustration(photoFor(block)!)">看插画</button>
                        <button title="重新选择风格并生成；相同参数会命中缓存" @click.stop="openIllustrationComposer(block)"><PhSparkle :size="13" /> 重做</button>
                        <button class="remove-illustration" title="删除生成插画" @click.stop="removeIllustration(photoFor(block)!)"><PhTrash :size="12" /></button>
                      </template>
                    </div>
                  </figure>
                  <div class="story-copy" :class="{ textOnly: !photoFor(block) }">
                    <input :value="block.title" aria-label="图文标题" placeholder="这一刻的标题" @input="updateBlock(block.id, 'title', $event)" />
                    <textarea :value="block.text" aria-label="照片对应文字" placeholder="写下与这张照片对应的文字…" @input="updateBlock(block.id, 'text', $event)" />
                    <input v-if="block.placeName" class="place-input" :value="block.placeName" aria-label="拍摄地点或时间" @input="updateBlock(block.id, 'placeName', $event)" />
                  </div>
                  </template>
                </article>
              </div>

              <span class="archive-mark" aria-hidden="true">CITYWALK<br/>FIELD NOTES<br/>{{ String(pageIndex + 1).padStart(2, '0') }}</span>
            </template>

            <div v-else class="blank-spread">
              <small>BLANK SPREAD · 01</small>
              <strong>纸页正在等第一段故事</strong>
              <p>添加照片时可以同时写下对应文字；也可以先放入一个纯文字片段。</p>
              <button @click="openComposer"><PhImage :size="18" /> 添加图文素材</button>
            </div>
          </div>

          <div v-if="turnDirection" class="page-turn-underlay" :class="turnDirection" aria-hidden="true" />
          <div v-if="turnDirection" class="page-turn-sheet" :class="turnDirection" aria-hidden="true">
            <div class="turn-face turn-front">
              <div
                class="turn-face-content"
                :class="turnDirection === 'next' ? 'page-right' : 'page-left'"
                v-html="turnFrontMarkup"
              />
              <span class="turn-paper-light" />
            </div>
            <div class="turn-face turn-back">
              <div
                class="turn-face-content"
                :class="turnDirection === 'next' ? 'page-left' : 'page-right'"
                v-html="turnBackMarkup"
              />
              <span class="turn-paper-light" />
            </div>
            <span class="turn-page-edge" />
          </div>
        </div>
        <button class="page-arrow next" aria-label="下一页" :disabled="pageIndex >= totalSpreads - 1" @click="turnPage(1)"><PhCaretRight :size="22" /></button>
      </div>

      <footer class="reader-footer">
        <span>{{ pageIndex + 1 }} / {{ totalSpreads }} 个跨页</span>
        <div class="page-dots"><button v-for="index in totalSpreads" :key="index" :class="{ active: pageIndex === index - 1 }" @click="turnPage(index - 1 > pageIndex ? 1 : -1, index - 1)"/></div>
        <button v-if="entry.route" class="walk-route" @click="startEntryWalk">发送到手机再次出发 <PhArrowRight :size="14" /></button>
      </footer>

      <aside v-if="entry.route" class="place-editor"><span>本书收录地点</span><button v-for="stop in entry.route.stops" :key="stop.name" :class="{ active: entry.selectedStops.includes(stop.name) }" @click="toggleStop(stop.name)">{{ stop.name }}</button></aside>
    </section>

    <div v-if="composerOpen" class="composer-backdrop" @click.self="closeComposer">
      <section class="story-composer">
        <header>
          <div><small>PAIR PHOTO WITH WORDS</small><h3>添加图文素材</h3><p>每张照片都可以拥有独立标题、正文与地点，AI 会把相关内容排在一起。</p></div>
          <button @click="closeComposer">×</button>
        </header>

        <label class="file-drop">
          <PhImage :size="25" />
          <span><strong>选择一张或多张照片</strong><small>保持原始比例显示，不会强制裁切</small></span>
          <input type="file" accept="image/*" multiple @change="addPendingFiles" />
        </label>

        <div v-if="pendingStories.length" class="pending-list">
          <article v-for="story in pendingStories" :key="story.id">
            <figure><img :src="story.preview" /></figure>
            <div>
              <label><span>标题</span><input v-model="story.title" placeholder="例如：下午四点的窗边" /></label>
              <label><span>对应文字</span><textarea v-model="story.text" placeholder="这张照片发生了什么？当时听见、闻见或想到什么？" /></label>
              <label><span>地点 / 时间</span><input v-model="story.placeName" placeholder="可选，例如：香港 · 坚尼地城" /></label>
            </div>
            <button class="remove-pending" @click="removePending(story.id)"><PhTrash :size="14" /> 移除</button>
          </article>
        </div>

        <div v-else class="composer-empty"><span>01</span><p>先选择照片，再逐张填写与它对应的文字；或者直接添加一个纯文字片段。</p></div>

        <footer>
          <button class="text-only" @click="addTextOnly">＋ 添加纯文字片段</button>
          <span />
          <button class="cancel" @click="closeComposer">取消</button>
          <button class="save" :disabled="!pendingStories.length || savingStories" @click="saveStories">{{ savingStories ? '正在整理照片…' : `加入手账（${pendingStories.length}）` }}</button>
        </footer>
      </section>
    </div>

    <div v-if="illustrationTarget && illustrationTargetPhoto" class="composer-backdrop" @click.self="closeIllustrationComposer">
      <section class="illustration-composer" role="dialog" aria-modal="true" aria-labelledby="illustration-title">
        <header>
          <div><small>ARK VISION → SEEDREAM · ZINE WORKFLOW</small><h3 id="illustration-title">选择照片转译方式</h3><p>视觉模型先建立结构化分析卡，再由对应 skill 编译生图提示词；原始照片始终保留。</p></div>
          <button :disabled="illustrating" aria-label="关闭" @click="closeIllustrationComposer">×</button>
        </header>
        <div class="illustration-workspace">
          <figure>
            <img :src="illustrationTargetPhoto.url" :alt="illustrationTarget.title" />
            <figcaption>{{ illustrationTarget.title || '原始照片' }}</figcaption>
          </figure>
          <div class="illustration-settings">
            <label><span>生成工作流</span></label>
            <div class="workflow-summary"><strong>场景蒸馏</strong><small>scene-distillation · v1.3</small><span>原照只作语义证据；AI 建立表达命题、中心张力与视觉隐喻，最终只保留原创插画，不含摄影像素。</span></div>
            <label><span>快捷风格</span></label>
            <div class="style-presets">
              <button
                v-for="preset in illustrationPresets"
                :key="preset.id"
                :class="{ active: illustrationPresetId === preset.id }"
                :disabled="illustrating"
                @click="chooseIllustrationPreset(preset)"
              >{{ preset.name }}</button>
            </div>
            <label>
              <span>风格描述（可以自由修改，不限制为预设）</span>
              <textarea v-model="illustrationStyle" maxlength="300" :disabled="illustrating" placeholder="例如：香港旧报纸上的黑色钢笔速写，少量暗红色水彩…" @input="markIllustrationStyleCustom" />
            </label>
            <p class="generation-rule">严格按 scene-distillation-v1.3：横图 5:3、其余 3:5，保留 2-4 个语义锚点并删除 65%-90% 写实细节；最终不保留、裁切或拼贴摄影像素。输入精确词“单色块模式”可启用单一连续色域。</p>
            <p v-if="illustrationError" class="illustration-error" role="alert">{{ illustrationError }}</p>
          </div>
        </div>
        <footer>
          <small>本次先调用 1 次视觉分析，再最多生成 1 张图片；相同参数会命中缓存</small>
          <span />
          <button :disabled="illustrating" @click="closeIllustrationComposer">取消</button>
          <button class="generate-art" :disabled="illustrating || !illustrationStyle.trim()" @click="generateIllustration"><PhSparkle :size="15" /> {{ illustrating ? '正在绘制，通常需要几十秒…' : '生成并应用' }}</button>
        </footer>
      </section>
    </div>
  </main>
</template>

<style scoped>
.workflow-summary{display:grid;grid-template-columns:1fr auto;gap:4px 10px;padding:12px 13px;border:1px solid var(--primary);border-radius:3px;background:var(--primary-fixed);box-shadow:inset 0 0 0 1px rgba(146,77,0,.08)}.workflow-summary strong{color:var(--primary);font:750 15px var(--font-display)}.workflow-summary small{align-self:center;color:var(--text-muted);font:8px/1.2 ui-monospace,monospace;letter-spacing:.04em}.workflow-summary span{grid-column:1/-1;color:var(--text-muted);font-size:10px;line-height:1.5}
.scrapbook-page{flex:1;min-height:0;overflow:auto}.book-library{max-width:1280px;margin:auto;padding:48px clamp(25px,5vw,70px) 90px}.library-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:30px;margin-bottom:48px;padding-bottom:20px;border-bottom:1px dashed var(--border)}.library-heading small{color:var(--primary);font-size:11px;font-weight:900;letter-spacing:.14em}.library-heading h2{color:var(--primary);font:800 clamp(36px,4vw,52px) var(--font-display)}.library-heading p{color:var(--text-muted);font:16px var(--font-display)}.library-heading button,.book-toolbar button{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 13px;border:1px solid var(--primary);border-radius:var(--radius-control);background:var(--primary);color:#fff;font-size:12px;font-weight:800;cursor:pointer}.library-heading button.outline{background:var(--surface);color:var(--primary)}
.shelf{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:48px 34px;align-items:start;perspective:1400px}.book-item{min-width:0;position:relative}.closed-book{width:100%;min-width:0;border:0;background:transparent;cursor:pointer;text-align:left;position:relative;padding:0 0 48px;filter:drop-shadow(13px 17px 13px rgba(86,67,56,.2));transform-style:preserve-3d;transition:.32s}.closed-book:hover{transform:translateY(-10px) rotateY(-8deg)}.delete-book{display:block;margin:5px auto 0;padding:6px 11px;border:1px solid rgba(147,0,10,.18);border-radius:999px;background:rgba(255,255,255,.55);color:#8b332c;font-size:11px;font-weight:700;cursor:pointer;opacity:.68}.book-item:hover .delete-book{opacity:1;background:#ffdad6}.cover{height:325px;display:block;padding:28px 22px;position:relative;overflow:hidden;border:1px solid rgba(52,23,4,.32);border-radius:4px 15px 12px 4px;background:#a94e0a;color:#fff;box-shadow:inset 12px 0 18px rgba(42,16,0,.22),inset -2px 0 rgba(255,255,255,.2)}.tone-1 .cover{background:#587600}.tone-2 .cover{background:#8a4d0e}.tone-3 .cover{background:#705346}.cover::after{content:'';position:absolute;inset:8px;border:1px solid rgba(255,255,255,.26);border-radius:2px 10px 9px 2px}.cover>small{font-size:9px;font-weight:900;letter-spacing:.13em;opacity:.7}.cover>i{width:67px;height:67px;margin:55px auto 19px;display:grid;place-items:center;border:3px double rgba(255,255,255,.55);border-radius:50%;font-style:normal;transform:rotate(-7deg)}.cover>strong{display:block;color:#fff;text-align:center;font:700 20px/1.25 var(--font-display)}.cover>em{display:block;margin-top:7px;text-align:center;font:14px var(--font-hand);opacity:.74}.cover>b{position:absolute;left:0;right:0;bottom:25px;text-align:center;font-size:10px;letter-spacing:.2em;opacity:.55}.spine{position:absolute;z-index:3;left:-3px;top:2px;width:17px;height:321px;border-radius:4px 0 0 4px;background:rgba(66,24,0,.45);box-shadow:inset -2px 0 rgba(255,255,255,.13)}.pages{position:absolute;z-index:-1;left:10px;right:-5px;top:15px;height:323px;border-radius:3px 14px 13px 3px;background:repeating-linear-gradient(90deg,#fffdf7 0 2px,#ded7ca 2px 3px);transform:translateZ(-8px)}.book-caption{position:absolute;left:6px;right:6px;bottom:0;display:grid;text-align:center;filter:none}.book-caption strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-h);font:700 15px var(--font-display)}.book-caption small{color:var(--text-muted);font-size:11px}.new-book-object{height:325px;border:2px dashed var(--border);border-radius:5px 15px 12px 5px;background:rgba(255,255,255,.3);display:grid;place-items:center;align-content:center;gap:8px;color:var(--text-muted);cursor:pointer;transition:.2s}.new-book-object:hover{border-color:var(--primary);color:var(--primary);transform:translateY(-6px)}.new-book-object strong{font:700 15px var(--font-display)}.new-book-object small{font-size:11px}

.reading{overflow:hidden;background:#34352f}.book-reader{height:100%;display:flex;flex-direction:column;position:relative;overflow:hidden}.book-toolbar{min-height:68px;flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 20px;background:rgba(252,249,240,.96);border-bottom:1px solid var(--border)}.book-toolbar .back-library,.book-toolbar .light,.book-toolbar .clear-content{background:transparent;color:var(--primary)}.toolbar-title{display:grid;margin-left:6px}.toolbar-title small{color:var(--primary);font-size:9px;font-weight:900;letter-spacing:.14em}.toolbar-title strong{font:700 14px var(--font-display)}.toolbar-space{flex:1}.layout-notice{padding:7px 10px;border-radius:999px;background:var(--primary-fixed);color:var(--primary);font-size:11px;font-weight:750}.book-toolbar .delete{background:#ffdad6;color:#93000a;border-color:rgba(147,0,10,.25)}.book-toolbar button:disabled{opacity:.35;cursor:not-allowed}.book-toolbar button.generating{opacity:.72}.book-toolbar button.generating svg{animation:layoutPulse .85s ease-in-out infinite alternate}@keyframes layoutPulse{to{transform:rotate(24deg) scale(1.18);filter:drop-shadow(0 0 4px rgba(255,255,255,.8))}}
.reader-stage{flex:1;min-height:0;display:grid;grid-template-columns:48px minmax(0,1180px) 48px;align-items:center;justify-content:center;padding:18px clamp(8px,2.5vw,34px);perspective:1800px}.open-book{--zine-accent:#1646d8;--zine-accent-soft:rgba(22,70,216,.12);height:min(74vh,740px);min-height:520px;display:grid;grid-template-columns:1fr 1fr;position:relative;overflow:hidden;transform-style:preserve-3d;filter:drop-shadow(0 24px 32px rgba(0,0,0,.34))}.open-book::after{content:'';position:absolute;z-index:10;left:50%;top:0;bottom:0;width:28px;transform:translateX(-50%);background:linear-gradient(90deg,rgba(86,67,56,.03),rgba(86,67,56,.18),rgba(255,255,255,.5),rgba(86,67,56,.09));pointer-events:none}.accent-cobalt{--zine-accent:#1646d8;--zine-accent-soft:rgba(22,70,216,.12)}.accent-tomato{--zine-accent:#db493a;--zine-accent-soft:rgba(219,73,58,.13)}.accent-pear{--zine-accent:#77a916;--zine-accent-soft:rgba(119,169,22,.14)}.accent-violet{--zine-accent:#7650c7;--zine-accent-soft:rgba(118,80,199,.13)}.accent-lemon{--zine-accent:#d8b900;--zine-accent-soft:rgba(216,185,0,.15)}.accent-cyan{--zine-accent:#008ca6;--zine-accent-soft:rgba(0,140,166,.13)}.paper-page{min-width:0;position:relative;overflow:hidden;padding:42px;background-color:#f4f0e6;background-image:radial-gradient(rgba(72,61,52,.13) .55px,transparent .7px),linear-gradient(93deg,rgba(255,255,255,.18),transparent 42%);background-size:13px 13px,100% 100%;border:1px solid rgba(46,32,23,.2)}.left-page{border-radius:9px 0 0 8px;transform-origin:right center}.right-page{border-radius:0 9px 8px 0;transform-origin:left center}.page-count{position:absolute;bottom:16px;color:rgba(86,67,56,.42);font:11px var(--font-display)}.left-page .page-count{left:22px}.right-page .page-count{right:22px}.spread-layer{position:absolute;z-index:3;inset:0;overflow:hidden;pointer-events:none}.spread-layer input,.spread-layer textarea,.spread-layer button{pointer-events:auto}.spread-heading{position:absolute;z-index:5;right:5%;top:7%;width:26%;display:grid;gap:3px;text-align:right}.spread-heading small{color:#6f675f;font:9px/1.5 ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}.spread-heading strong{color:#2e2925;font:700 clamp(17px,2vw,27px)/1.1 var(--font-display)}.spread-heading strong::after{content:'';display:inline-block;width:10px;height:10px;margin-left:8px;background:var(--zine-accent)}.spread-heading p{color:#8a8178;font:10px/1.5 var(--font-sans)}.book-identity{position:absolute;z-index:6;left:5%;top:7%;width:31%;display:grid;gap:7px}.book-identity input,.book-identity textarea{width:100%;border:0;border-bottom:1px solid transparent;outline:0;background:transparent}.book-identity input{color:#332d28;font:720 clamp(20px,2.5vw,34px)/1.08 var(--font-display)}.book-identity textarea{height:48px;resize:none;color:#70665e;font:12px/1.5 var(--font-display)}.book-identity input:focus,.book-identity textarea:focus{border-bottom-color:var(--zine-accent)}
.journey-overview{position:absolute;z-index:6;left:5%;bottom:5%;width:39%;display:grid;gap:4px;padding-left:40px;color:#62584f}.journey-overview::before{content:'';position:absolute;left:14px;top:8px;bottom:8px;border-left:2px dashed var(--zine-accent);transform:rotate(-4deg)}.journey-overview small{color:var(--zine-accent);font:800 8px/1.4 ui-monospace,monospace;letter-spacing:.12em}.journey-overview strong{display:flex;align-items:center;gap:6px;color:#3d3732;font:650 15px/1.25 var(--font-hand)}.journey-overview strong i{width:25px;height:25px;display:grid;place-items:center;flex:0 0 auto;border-radius:50% 50% 50% 0;background:var(--zine-accent);color:#fff;font:800 8px var(--font-sans);font-style:normal;transform:rotate(-45deg)}.journey-overview strong i em,.journey-pin b em{font-style:normal;transform:rotate(45deg)}.journey-overview strong span{color:var(--zine-accent)}.journey-overview p{color:#82786f;font:9px/1.4 ui-monospace,monospace;letter-spacing:.06em}.journey-block{isolation:isolate}.journey-pin{position:absolute;z-index:11;left:-16px;top:-19px;display:flex;align-items:center;gap:7px;pointer-events:none}.journey-pin b{position:relative;width:32px;height:32px;display:grid;place-items:center;flex:0 0 auto;border-radius:50% 50% 50% 0;background:var(--zine-accent);color:#fff;font:850 9px var(--font-sans);box-shadow:0 0 0 4px #f4f0e6,0 2px 5px rgba(63,48,38,.2);transform:rotate(-45deg)}.journey-pin small{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 6px;background:rgba(244,240,230,.88);color:#655b53;font:750 8px/1.25 ui-monospace,monospace;letter-spacing:.04em}.journey-pin.branch{left:-11px;top:-13px}.journey-pin.branch b{width:22px;height:22px;background:#f4f0e6;color:var(--zine-accent);border:2px solid var(--zine-accent);box-shadow:0 0 0 3px #f4f0e6}.journey-pin.branch small{color:#8a8178}.journey-pin.unlocated b{background:#f4f0e6;color:var(--zine-accent);border:2px dashed var(--zine-accent)}
.journey-stop-strip{position:relative;display:flex;align-items:flex-start;gap:0;margin-top:3px;padding-top:2px}.journey-stop-strip::before{content:'';position:absolute;left:8px;right:9px;top:10px;border-top:1px dashed rgba(98,88,79,.35)}.journey-stop-strip>span{position:relative;z-index:1;min-width:0;flex:1;display:grid;justify-items:center;gap:2px}.journey-stop-strip>span i{width:17px;height:17px;display:grid;place-items:center;border:1px dashed #8f857c;border-radius:50%;background:#f4f0e6;color:#8f857c;font:700 6px ui-monospace,monospace;font-style:normal}.journey-stop-strip>span.recorded i{border-style:solid;border-color:var(--zine-accent);background:var(--zine-accent);color:#fff;box-shadow:0 0 0 2px #f4f0e6}.journey-stop-strip>span em{max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8a8178;font:7px/1.2 var(--font-hand);font-style:normal}.journey-stop-strip>span.recorded em{color:#504840;font-weight:700}.journey-stop-strip>b{position:relative;z-index:2;align-self:start;margin:2px 0 0 3px;padding:1px 3px;background:#f4f0e6;color:#8a8178;font:7px ui-monospace,monospace}
.zine-texture-layer{position:absolute;z-index:1;inset:0;pointer-events:none;opacity:.33;mix-blend-mode:multiply}.texture-paper-fibers .zine-texture-layer{background:repeating-linear-gradient(7deg,transparent 0 17px,rgba(86,67,54,.08) 18px,transparent 19px),radial-gradient(ellipse at 28% 65%,rgba(108,85,62,.13),transparent 32%)}.texture-xerox-softness .zine-texture-layer{background:radial-gradient(circle at 20% 32%,rgba(39,36,32,.14) 0 1px,transparent 1.8px),linear-gradient(91deg,transparent 49.5%,rgba(36,32,28,.05) 50%,transparent 50.6%);background-size:9px 11px,100% 100%;filter:contrast(1.6)}.texture-risograph-grain .zine-texture-layer{background-image:radial-gradient(var(--zine-accent-soft) .75px,transparent .9px),radial-gradient(rgba(62,51,43,.09) .65px,transparent .8px);background-position:0 0,3px 2px;background-size:6px 6px,8px 8px;opacity:.48}.texture-letterpress-bleed .zine-texture-layer{box-shadow:inset 0 0 70px rgba(71,52,37,.13);background:repeating-linear-gradient(0deg,transparent 0 26px,rgba(66,48,34,.055) 27px,transparent 28px)}.texture-halftone .zine-texture-layer{background:radial-gradient(circle,rgba(39,34,30,.18) 0 1px,transparent 1.15px);background-size:7px 7px;mask-image:linear-gradient(120deg,#000,transparent 42%,#000)}.texture-scan-noise .zine-texture-layer{background:repeating-linear-gradient(90deg,rgba(52,43,36,.05) 0 1px,transparent 1px 23px),repeating-linear-gradient(0deg,transparent 0 4px,rgba(52,43,36,.035) 5px);filter:contrast(1.7)}
.zine-type-layer{position:absolute;z-index:3;inset:0;color:#514942;pointer-events:none;mix-blend-mode:multiply}.zine-type-layer>*{position:absolute}.zine-type-layer .type-fragment{display:none;font:800 clamp(74px,10vw,140px)/.75 var(--font-display);letter-spacing:-.12em;opacity:.075}.zine-type-layer .type-index{font:8px/1.45 ui-monospace,monospace;letter-spacing:.16em;text-transform:uppercase;opacity:.68}.zine-type-layer .type-note{display:none;color:var(--zine-accent);font:800 9px/1 ui-monospace,monospace;letter-spacing:.13em}.mode-archive-stack .type-index{display:block;left:3.2%;top:31%;width:150px;transform:rotate(-90deg) translateX(-100%);transform-origin:left top}.mode-archive-stack .type-note{display:block;left:6%;bottom:7%;transform:rotate(-2deg)}.mode-edge-caption .type-index{right:4%;bottom:4%;max-width:38%;text-align:right}.mode-edge-caption .type-note{display:block;left:4%;top:50%;writing-mode:vertical-rl}.mode-fragmented-letters .type-fragment{display:block;right:6%;bottom:7%}.mode-fragmented-letters .type-index{left:5%;bottom:5%}.mode-diagonal-note .type-index{right:6%;bottom:5%}.mode-diagonal-note .type-note{display:block;left:56%;top:18%;transform:rotate(-12deg);border-bottom:2px solid var(--zine-accent);padding-bottom:4px}.mode-quiet-serif .type-index{left:5%;bottom:5%;font-family:var(--font-display);letter-spacing:.08em}.type-fragmented-letters .spread-heading strong{font-family:ui-monospace,monospace;letter-spacing:-.05em}.type-edge-caption .spread-heading{border-right:3px solid var(--zine-accent);padding-right:10px}.type-diagonal-note .spread-heading{transform:rotate(1.2deg)}.type-archive-stack .spread-heading small{writing-mode:vertical-rl;justify-self:end;max-height:80px}
.block-cluster{position:absolute;z-index:4;display:grid;gap:18px;align-items:start}.zine-block{position:relative;min-width:0;display:grid;grid-template-columns:minmax(110px,1fr) minmax(130px,.85fr);gap:14px;align-items:center;padding:13px;background:rgba(249,247,240,.42);border:0;border-radius:2px 8px 3px 6px;box-shadow:0 1px 0 rgba(72,55,43,.12)}.photo-anchor{min-width:0;position:relative;display:flex;align-items:center;justify-content:center;padding:7px;background:#eee9df;box-shadow:0 5px 14px rgba(47,37,30,.12);isolation:isolate}.photo-anchor::before{content:'';position:absolute;z-index:3;top:-8px;left:34%;width:33%;height:17px;background:rgba(224,211,178,.66);box-shadow:0 1px 2px rgba(53,42,33,.1);transform:rotate(-2.4deg)}.photo-anchor::after{content:'';position:absolute;z-index:2;inset:7px;pointer-events:none;background-image:radial-gradient(rgba(49,40,34,.6) .45px,transparent .7px);background-size:4px 4px;mix-blend-mode:multiply;opacity:.12}.photo-anchor img{display:block;width:auto;height:auto;max-width:100%;max-height:285px;object-fit:contain;filter:none}.photo-portrait .photo-anchor img{max-height:330px}.story-copy{min-width:0;display:grid;gap:6px;padding:7px 9px 5px;background:rgba(248,244,233,.56);box-shadow:0 1px 0 rgba(75,58,45,.1)}.story-copy input,.story-copy textarea{width:100%;border:0;border-bottom:1px solid transparent;outline:0;background:transparent}.story-copy>input:first-child{color:#302b27;font:600 20px/1.15 var(--font-hand)}.story-copy textarea{min-height:68px;resize:vertical;color:#514943;font:500 18px/1.52 var(--font-hand);letter-spacing:.012em}.story-copy .place-input{color:#7e756d;font:9px ui-monospace,monospace;letter-spacing:.08em}.story-copy input:focus,.story-copy textarea:focus{border-bottom-color:var(--zine-accent);background:rgba(255,255,255,.35)}.story-copy.textOnly{grid-column:1/-1}.story-copy.textOnly>input:first-child{font-size:27px}.story-copy.textOnly textarea{min-height:120px;font-size:20px}.remove-block{position:absolute;z-index:8;right:7px;top:7px;width:27px;height:27px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(45,37,31,.75);color:#fff;cursor:pointer;opacity:0;transition:.18s}.zine-block:hover .remove-block,.remove-block:focus-visible{opacity:1}.color-anchor{position:absolute;z-index:2;width:22px;height:22px;border-radius:50%;background:var(--zine-accent);box-shadow:0 0 0 7px var(--zine-accent-soft)}.archive-mark{position:absolute;color:#797168;font:8px/1.55 ui-monospace,monospace;letter-spacing:.08em}.ai-caption{position:absolute;z-index:5;left:5%;bottom:5%;max-width:38%;color:#59504a;font:500 17px/1.42 var(--font-hand);transform:rotate(-1deg)}
.recipe-center-fragment .block-cluster{left:27%;top:27%;width:46%;max-height:57%}.recipe-center-fragment .zine-block{transform:rotate(-.5deg)}.recipe-center-fragment .color-anchor{left:24%;top:45%}.recipe-center-fragment .archive-mark{right:8%;bottom:9%}
.recipe-lower-left-float .block-cluster{left:7%;bottom:11%;width:60%;max-height:57%}.recipe-lower-left-float .zine-block{transform:rotate(-1deg)}.recipe-lower-left-float .color-anchor{right:19%;top:42%;width:35px;height:13px;border-radius:0}.recipe-lower-left-float .archive-mark{right:8%;bottom:12%}
.recipe-upper-right-block .block-cluster{right:8%;top:21%;width:50%;max-height:61%}.recipe-upper-right-block .color-anchor{left:22%;top:52%;width:14px;height:54px;border-radius:0}.recipe-upper-right-block .archive-mark{left:8%;bottom:13%}
.recipe-dual-panel .block-cluster{left:10%;right:10%;top:24%;grid-template-columns:repeat(2,minmax(0,1fr));align-items:center}.recipe-dual-panel .zine-block{grid-template-columns:1fr;align-content:start}.recipe-dual-panel .photo-anchor img{max-height:230px}.recipe-dual-panel .color-anchor{left:49%;bottom:13%;width:26px;height:26px}.recipe-dual-panel .archive-mark{right:7%;bottom:8%}
.recipe-irregular-cutout .block-cluster{left:13%;right:11%;top:25%;grid-template-columns:1.15fr .85fr}.recipe-irregular-cutout .zine-block:nth-child(1){transform:rotate(-1.4deg);clip-path:polygon(2% 0,98% 3%,100% 94%,4% 100%)}.recipe-irregular-cutout .zine-block:nth-child(2){margin-top:45px;transform:rotate(1.2deg)}.recipe-irregular-cutout .zine-block:nth-child(3){grid-column:1/-1;width:55%;margin:-20px auto 0}.recipe-irregular-cutout .color-anchor{right:9%;bottom:16%;border-radius:2px;transform:rotate(12deg)}.recipe-irregular-cutout .archive-mark{left:7%;bottom:9%}
.recipe-type-led .block-cluster{left:15%;top:30%;width:70%}.recipe-type-led .zine-block{grid-template-columns:minmax(120px,.45fr) minmax(250px,1fr);background:transparent;border:0}.recipe-type-led .story-copy>input:first-child{font-size:clamp(25px,3vw,43px)}.recipe-type-led .story-copy textarea{font-size:15px}.recipe-type-led .photo-anchor img{max-height:210px}.recipe-type-led .color-anchor{left:12%;top:22%;width:45px;height:11px;border-radius:0}.recipe-type-led .archive-mark{right:7%;bottom:10%}
.recipe-dot-orbit .block-cluster{left:22%;top:25%;width:56%}.recipe-dot-orbit .zine-block{border-radius:47% 42% 44% 40%/7% 8% 9% 8%}.recipe-dot-orbit .color-anchor{left:17%;top:45%}.recipe-dot-orbit .archive-mark{right:8%;bottom:10%}
.recipe-single-specimen .block-cluster{left:30%;top:25%;width:40%}.recipe-single-specimen .zine-block{grid-template-columns:1fr;background:transparent;border:0;text-align:center}.recipe-single-specimen .photo-anchor{background:transparent;box-shadow:none}.recipe-single-specimen .story-copy{text-align:center}.recipe-single-specimen .color-anchor{right:24%;top:32%;width:12px;height:42px;border-radius:0}.recipe-single-specimen .archive-mark{left:8%;bottom:10%}
.blocks-2 .zine-block{gap:10px;padding:10px}.blocks-2 .photo-anchor img{max-height:210px}.blocks-2 .story-copy textarea{min-height:48px;max-height:92px}.blank-spread{position:absolute;left:50%;top:50%;width:340px;transform:translate(-50%,-50%);display:grid;justify-items:start;gap:8px}.blank-spread small{color:var(--zine-accent);font:9px ui-monospace,monospace;letter-spacing:.15em}.blank-spread strong{color:#322d29;font:700 28px var(--font-display)}.blank-spread p{color:#746b63;font:14px/1.7 var(--font-display)}.blank-spread button{display:flex;align-items:center;gap:7px;margin-top:10px;padding:9px 13px;border:1px solid var(--zine-accent);background:transparent;color:var(--zine-accent);cursor:pointer}
.page-arrow{width:40px;height:40px;border:1px solid rgba(255,255,255,.28);border-radius:50%;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}.page-arrow:disabled{opacity:.15;cursor:not-allowed}.reader-footer{height:44px;flex:0 0 44px;display:flex;align-items:center;justify-content:center;gap:18px;color:rgba(244,241,232,.68);font-size:11px}.page-dots{display:flex;gap:6px}.page-dots button{width:7px;height:7px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.25);cursor:pointer}.page-dots button.active{background:#c8f17a;box-shadow:0 0 0 4px rgba(200,241,122,.12)}.walk-route{position:absolute;right:25px;display:flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid rgba(200,241,122,.3);border-radius:999px;background:transparent;color:#c8f17a;font-size:11px;cursor:pointer}.place-editor{position:absolute;z-index:20;left:50%;bottom:49px;transform:translateX(-50%);max-width:72%;display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;background:rgba(28,28,23,.72);backdrop-filter:blur(10px);overflow-x:auto}.place-editor>span{color:rgba(255,255,255,.6);font-size:10px;white-space:nowrap}.place-editor button{padding:4px 8px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:transparent;color:rgba(255,255,255,.65);font-size:10px;white-space:nowrap;cursor:pointer}.place-editor button.active{background:#c8f17a;color:#364e00;border-color:#c8f17a}

/* StPageFlip-inspired live-DOM turn: both faces carry a snapshot of their physical page. */
.open-book{perspective:2200px}
.page-turn-underlay{position:absolute;z-index:18;top:0;bottom:0;width:50%;pointer-events:none;background:linear-gradient(90deg,rgba(76,59,47,.16),transparent 13%,transparent 84%,rgba(76,59,47,.09));animation:underPageLight .84s ease-in-out both}
.page-turn-underlay.next{right:0}.page-turn-underlay.prev{left:0;transform:scaleX(-1)}
.page-turn-sheet{position:absolute;z-index:30;top:0;bottom:0;width:50%;transform-style:preserve-3d;will-change:transform;pointer-events:none}
.page-turn-sheet.next{right:0;transform-origin:left center;animation:pageTurnNext .84s cubic-bezier(.42,.02,.18,1) both}
.page-turn-sheet.prev{left:0;transform-origin:right center;animation:pageTurnPrev .84s cubic-bezier(.42,.02,.18,1) both}
.turn-face{position:absolute;inset:0;overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;background-color:#f4f0e6;background-image:radial-gradient(rgba(72,61,52,.13) .55px,transparent .7px),linear-gradient(93deg,rgba(255,255,255,.22),transparent 45%);background-size:13px 13px,100% 100%;border:1px solid rgba(46,32,23,.2)}
.page-turn-sheet.next .turn-front{border-radius:0 9px 8px 0}.page-turn-sheet.prev .turn-front{border-radius:9px 0 0 8px}
.turn-back{transform:rotateY(180deg)}
.page-turn-sheet.next .turn-back{border-radius:9px 0 0 8px}.page-turn-sheet.prev .turn-back{border-radius:0 9px 8px 0}
.turn-face-content{position:absolute;z-index:1;inset:0;overflow:hidden;pointer-events:none}
.turn-face-content :deep(.spread-layer){left:0!important;right:auto!important;top:0!important;bottom:auto!important;width:200%!important;height:100%!important;overflow:visible!important;pointer-events:none!important}
.turn-face-content.page-right :deep(.spread-layer){left:-100%!important}
.turn-face-content :deep(button){display:none!important}
.turn-face-content :deep(input),.turn-face-content :deep(textarea){pointer-events:none!important}
.turn-paper-light{position:absolute;z-index:4;inset:0;opacity:0;mix-blend-mode:multiply;animation:turnSurfaceLight .84s ease-in-out both}
.page-turn-sheet.next .turn-front .turn-paper-light,.page-turn-sheet.prev .turn-back .turn-paper-light{background:linear-gradient(90deg,rgba(57,43,34,.48),rgba(88,68,54,.08) 28%,transparent 66%,rgba(255,255,255,.28))}
.page-turn-sheet.prev .turn-front .turn-paper-light,.page-turn-sheet.next .turn-back .turn-paper-light{background:linear-gradient(270deg,rgba(57,43,34,.48),rgba(88,68,54,.08) 28%,transparent 66%,rgba(255,255,255,.28))}
.turn-page-edge{position:absolute;z-index:6;top:0;bottom:0;width:2px;background:rgba(255,255,255,.8);box-shadow:0 0 12px rgba(47,35,27,.32)}
.page-turn-sheet.next .turn-page-edge{right:0}.page-turn-sheet.prev .turn-page-edge{left:0}
.open-book.turn-covering>.spread-layer{animation:spreadFadeOut .36s ease-in both}
.open-book.turn-revealing>.spread-layer{animation:spreadFadeIn .38s ease-out both}
@keyframes pageTurnNext{0%{transform:rotateY(0) scaleX(1)}18%{transform:rotateY(-24deg) scaleX(.985)}47%{transform:rotateY(-86deg) scaleX(.94)}53%{transform:rotateY(-96deg) scaleX(.94)}82%{transform:rotateY(-158deg) scaleX(.985)}100%{transform:rotateY(-180deg) scaleX(1)}}
@keyframes pageTurnPrev{0%{transform:rotateY(0) scaleX(1)}18%{transform:rotateY(24deg) scaleX(.985)}47%{transform:rotateY(86deg) scaleX(.94)}53%{transform:rotateY(96deg) scaleX(.94)}82%{transform:rotateY(158deg) scaleX(.985)}100%{transform:rotateY(180deg) scaleX(1)}}
@keyframes turnSurfaceLight{0%,100%{opacity:.06}44%,56%{opacity:.72}}
@keyframes underPageLight{0%{opacity:0}42%{opacity:.55}100%{opacity:0}}
@keyframes spreadFadeOut{0%{opacity:1;filter:blur(0)}100%{opacity:0;filter:blur(.8px)}}
@keyframes spreadFadeIn{0%{opacity:0;filter:blur(.8px)}100%{opacity:1;filter:blur(0)}}

.composer-backdrop{position:fixed;z-index:200;inset:0;display:grid;place-items:center;padding:24px;background:rgba(29,27,24,.64);backdrop-filter:blur(7px)}.story-composer{width:min(920px,100%);max-height:88vh;display:flex;flex-direction:column;padding:28px;border-radius:var(--radius);background:#f4f0e6;background-image:radial-gradient(rgba(70,58,49,.12) .5px,transparent .6px);background-size:13px 13px;box-shadow:0 30px 90px rgba(0,0,0,.35)}.story-composer>header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:1px solid var(--border)}.story-composer>header small{color:var(--primary);font-size:10px;font-weight:900;letter-spacing:.13em}.story-composer>header h3{font:750 28px var(--font-display)}.story-composer>header p{color:var(--text-muted);font-size:13px}.story-composer>header>button{border:0;background:transparent;color:var(--text);font-size:28px;cursor:pointer}.file-drop{display:flex;align-items:center;gap:13px;margin:18px 0;padding:14px 16px;border:1px dashed var(--accent-border);background:rgba(255,255,255,.42);color:var(--primary);cursor:pointer}.file-drop span{display:grid}.file-drop small{color:var(--text-muted);font-size:11px}.file-drop input{display:none}.pending-list{min-height:0;overflow:auto;display:grid;gap:12px}.pending-list article{position:relative;display:grid;grid-template-columns:180px 1fr;gap:16px;padding:14px;border:1px solid var(--border);background:rgba(255,255,255,.52)}.pending-list figure{height:180px;display:flex;align-items:center;justify-content:center;background:#e9e4da}.pending-list figure img{display:block;width:auto;height:auto;max-width:100%;max-height:100%;object-fit:contain}.pending-list article>div{display:grid;gap:8px}.pending-list label{display:grid;gap:4px}.pending-list label span{color:var(--text-muted);font-size:10px;font-weight:750}.pending-list input,.pending-list textarea{width:100%;padding:8px 10px;border:1px solid var(--border);background:rgba(255,255,255,.5);color:var(--text-h);font:13px var(--font-display);outline:0}.pending-list textarea{min-height:65px;resize:vertical}.pending-list input:focus,.pending-list textarea:focus{border-color:var(--primary);background:#fff}.remove-pending{position:absolute;right:9px;top:8px;display:flex;align-items:center;gap:4px;padding:5px 8px;border:0;background:rgba(255,255,255,.8);color:#93000a;font-size:10px;cursor:pointer}.composer-empty{min-height:180px;display:grid;place-items:center;align-content:center;gap:8px;color:var(--text-muted);text-align:center}.composer-empty span{width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--primary);color:var(--primary);font:10px ui-monospace,monospace}.composer-empty p{max-width:450px;font:14px/1.7 var(--font-display)}.story-composer>footer{display:flex;align-items:center;gap:8px;margin-top:18px;padding-top:16px;border-top:1px solid var(--border)}.story-composer>footer span{flex:1}.story-composer>footer button{padding:9px 14px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:12px;font-weight:750;cursor:pointer}.story-composer>footer .text-only{border-color:var(--accent-border);color:var(--primary)}.story-composer>footer .save{border-color:var(--primary);background:var(--primary);color:#fff}.story-composer>footer button:disabled{opacity:.4;cursor:not-allowed}

.photo-ai-actions{position:absolute;z-index:7;left:10px;right:10px;bottom:9px;display:flex;align-items:center;justify-content:center;gap:5px;opacity:0;transform:translateY(4px);transition:.18s}.photo-anchor:hover .photo-ai-actions,.photo-ai-actions:focus-within{opacity:1;transform:none}.photo-ai-actions button{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-height:25px;padding:4px 7px;border:1px solid rgba(255,255,255,.45);border-radius:999px;background:rgba(36,32,28,.82);backdrop-filter:blur(5px);color:#fff;font:700 9px var(--font-sans);cursor:pointer}.photo-ai-actions button:hover{background:var(--zine-accent)}.photo-ai-actions .remove-illustration{width:25px;padding:0;background:rgba(120,28,24,.84)}.illustration-badge{position:absolute;z-index:6;left:10px;top:10px;padding:4px 7px;border:1px solid rgba(255,255,255,.5);border-radius:999px;background:rgba(244,240,230,.86);color:#554b43;font:700 8px ui-monospace,monospace;letter-spacing:.08em;box-shadow:0 2px 7px rgba(43,34,28,.12)}.photo-anchor.illustrated{background:#f5efe2}.photo-anchor.illustrated img{filter:none!important;mix-blend-mode:normal!important;opacity:1!important}

.illustration-composer{width:min(940px,100%);max-height:92vh;display:flex;flex-direction:column;padding:26px;border-radius:var(--radius);background:#f4f0e6;background-image:radial-gradient(rgba(70,58,49,.11) .5px,transparent .6px);background-size:13px 13px;box-shadow:0 30px 90px rgba(0,0,0,.36)}.illustration-composer>header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:16px;border-bottom:1px solid var(--border)}.illustration-composer>header small{color:var(--primary);font-size:10px;font-weight:900;letter-spacing:.14em}.illustration-composer>header h3{color:var(--text-h);font:750 28px var(--font-display)}.illustration-composer>header p{max-width:650px;color:var(--text-muted);font-size:12px}.illustration-composer>header>button{border:0;background:transparent;color:var(--text);font-size:28px;cursor:pointer}.illustration-workspace{min-height:0;display:grid;grid-template-columns:minmax(250px,.8fr) minmax(360px,1.2fr);gap:24px;padding:20px 0;overflow:auto}.illustration-workspace>figure{min-height:300px;display:grid;place-items:center;align-content:center;gap:9px;padding:16px;background:#e9e3d7;box-shadow:inset 0 0 0 1px rgba(68,52,42,.08)}.illustration-workspace>figure img{display:block;width:auto;height:auto;max-width:100%;max-height:380px;object-fit:contain;box-shadow:0 8px 22px rgba(47,37,30,.16)}.illustration-workspace figcaption{color:var(--text-muted);font:14px var(--font-hand)}.illustration-settings{display:grid;align-content:start;gap:12px}.illustration-settings label{display:grid;gap:6px}.illustration-settings label>span{color:var(--text-muted);font-size:11px;font-weight:750}.illustration-settings textarea{width:100%;min-height:96px;padding:12px;border:1px solid var(--border);background:rgba(255,255,255,.62);color:var(--text-h);font:15px/1.55 var(--font-display);resize:vertical;outline:0}.illustration-settings textarea:focus{border-color:var(--primary);background:#fff}.illustration-modes{display:grid;grid-template-columns:1fr 1fr;gap:9px}.illustration-modes button{min-width:0;display:grid;grid-template-columns:1fr auto;gap:3px 8px;padding:11px 12px;border:1px solid rgba(73,60,49,.2);border-radius:3px;background:rgba(255,255,255,.46);color:var(--text);text-align:left;cursor:pointer}.illustration-modes button strong{font:750 15px var(--font-display)}.illustration-modes button small{align-self:center;color:var(--text-muted);font:8px/1.2 ui-monospace,monospace;letter-spacing:.04em}.illustration-modes button span{grid-column:1/-1;color:var(--text-muted);font-size:10px;line-height:1.45}.illustration-modes button.active{border-color:var(--primary);background:var(--primary-fixed);box-shadow:inset 0 0 0 1px rgba(146,77,0,.12)}.illustration-modes button.active strong{color:var(--primary)}.style-presets{display:flex;flex-wrap:wrap;gap:7px}.style-presets button{padding:7px 10px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,.48);color:var(--text);font-size:11px;font-weight:700;cursor:pointer}.style-presets button.active{border-color:var(--primary);background:var(--primary-fixed);color:var(--primary)}.generation-rule{padding:10px 12px;border-left:3px solid var(--primary);background:rgba(255,255,255,.42);color:var(--text-muted);font-size:11px;line-height:1.6}.illustration-error{padding:9px 11px;background:#ffdad6;color:#93000a;font-size:11px}.illustration-composer>footer{display:flex;align-items:center;gap:8px;padding-top:15px;border-top:1px solid var(--border)}.illustration-composer>footer small{max-width:460px;color:var(--text-muted);font-size:10px}.illustration-composer>footer span{flex:1}.illustration-composer>footer button{display:inline-flex;align-items:center;gap:5px;padding:9px 13px;border:1px solid var(--border);background:transparent;color:var(--text);font-size:11px;font-weight:800;cursor:pointer}.illustration-composer>footer .generate-art{border-color:var(--primary);background:var(--primary);color:#fff}.illustration-composer button:disabled,.illustration-composer textarea:disabled{opacity:.45;cursor:not-allowed}

@media(max-width:1100px){.shelf{grid-template-columns:repeat(3,1fr)}.book-toolbar{flex-wrap:wrap}.reader-stage{grid-template-columns:42px minmax(0,1fr) 42px}.open-book{min-height:500px}.spread-heading{width:32%}.book-identity{width:35%}.zine-block{grid-template-columns:1fr}.photo-anchor img{max-height:210px}.story-copy textarea{min-height:50px}.recipe-dual-panel .photo-anchor img{max-height:170px}}
@media(max-width:760px){.book-library{padding:30px 18px 80px}.library-heading{align-items:flex-start;flex-direction:column}.shelf{grid-template-columns:repeat(2,1fr);gap:34px 16px}.cover,.new-book-object{height:260px}.spine{height:256px}.pages{height:258px}.cover>i{margin:35px auto 15px}.reading{overflow:auto}.book-reader{min-height:900px}.reader-stage{grid-template-columns:30px minmax(0,1fr) 30px;padding:12px 2px}.open-book{height:700px;min-height:700px}.spread-heading{right:6%;width:38%}.book-identity{left:7%;width:39%}.block-cluster{max-height:none!important}.zine-block{grid-template-columns:1fr}.recipe-center-fragment .block-cluster,.recipe-lower-left-float .block-cluster,.recipe-upper-right-block .block-cluster,.recipe-single-specimen .block-cluster,.recipe-type-led .block-cluster,.recipe-dot-orbit .block-cluster{left:12%;right:12%;top:25%;bottom:auto;width:auto}.recipe-dual-panel .block-cluster,.recipe-irregular-cutout .block-cluster{left:10%;right:10%;grid-template-columns:1fr 1fr}.photo-anchor img{max-height:180px}.photo-ai-actions{opacity:1;transform:none}.story-copy textarea{min-height:45px}.ai-caption{max-width:70%}.place-editor{max-width:94%}.story-composer{padding:18px}.pending-list article{grid-template-columns:120px 1fr}.pending-list figure{height:150px}.illustration-composer{padding:18px}.illustration-workspace{grid-template-columns:1fr}.illustration-workspace>figure{min-height:220px}.illustration-workspace>figure img{max-height:240px}.illustration-composer>footer{flex-wrap:wrap}}

/* A spread is two physical pages. Keep the 8% spine corridor completely clear. */
.open-book.anchor-left .block-cluster.blocks-1{left:7%;right:auto;width:36%}
.open-book.anchor-right .block-cluster.blocks-1{left:auto;right:7%;width:36%}
.open-book .block-cluster.blocks-2{left:6%!important;right:6%!important;width:auto!important;top:25%!important;bottom:auto!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;column-gap:14%!important;align-items:start}
.open-book .block-cluster.blocks-2 .zine-block{grid-template-columns:1fr;align-content:start}
.open-book .block-cluster.blocks-2 .photo-anchor img{max-height:190px}
.open-book .block-cluster.blocks-2 .story-copy textarea{min-height:48px;max-height:76px}
.open-book.recipe-lower-left-float .block-cluster.blocks-1{left:7%;right:auto;top:auto;bottom:12%;width:36%}
.open-book.recipe-upper-right-block .block-cluster.blocks-1{left:auto;right:7%;top:23%;bottom:auto;width:36%}
.open-book.recipe-center-fragment .block-cluster.blocks-1{top:27%;bottom:auto}
.open-book.recipe-type-led .block-cluster.blocks-1{top:29%;bottom:auto}
.open-book.recipe-dot-orbit .block-cluster.blocks-1{top:27%;bottom:auto}
.open-book.recipe-single-specimen .block-cluster.blocks-1{top:24%;bottom:auto}
.open-book.recipe-irregular-cutout .block-cluster.blocks-1{top:26%;bottom:auto}
.open-book.recipe-type-led .block-cluster.blocks-1 .zine-block{grid-template-columns:1fr}
.open-book .block-cluster .zine-block:nth-child(odd){transform:rotate(-1.25deg);transform-origin:48% 52%}
.open-book .block-cluster .zine-block:nth-child(even){transform:rotate(1.35deg) translateY(10px);transform-origin:52% 48%}
.open-book .zine-block:nth-child(odd) .photo-anchor,.open-book .zine-block:nth-child(even) .photo-anchor{transform:none;clip-path:none;border-radius:2px}
.open-book .zine-block:nth-child(odd) .story-copy{transform:rotate(.45deg)}
.open-book .zine-block:nth-child(even) .story-copy{transform:rotate(-.55deg)}
.open-book.anchor-left .ai-caption{left:auto;right:6%;text-align:right;transform:rotate(.8deg)}
.open-book.anchor-right .ai-caption{left:6%;right:auto;text-align:left;transform:rotate(-1deg)}
.open-book.recipe-dual-panel .color-anchor{left:auto;right:4%;bottom:13%}
.book-identity textarea{font:500 16px/1.45 var(--font-hand)}
@media(max-width:760px){.open-book .block-cluster.blocks-2{left:5%!important;right:5%!important;column-gap:12%!important}.open-book .block-cluster.blocks-2 .photo-anchor img{max-height:150px}.story-copy>input:first-child{font-size:17px}.story-copy textarea{font-size:16px}.ai-caption{max-width:38%}}

/* AI geometry: page-local percentages are converted to spread coordinates in Vue. */
.open-book .block-cluster.ai-geometry{inset:0!important;width:auto!important;max-height:none!important;display:block!important;pointer-events:none}
.open-book .block-cluster.ai-geometry .zine-block{position:absolute;left:var(--ai-left);top:var(--ai-top);width:var(--ai-width);display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.82fr);transform:rotate(var(--ai-rotation))!important;transform-origin:50% 50%!important;pointer-events:auto;transition:left .45s cubic-bezier(.2,.8,.2,1),top .45s cubic-bezier(.2,.8,.2,1),width .45s cubic-bezier(.2,.8,.2,1),transform .45s cubic-bezier(.2,.8,.2,1)}
.open-book .ai-geometry .zine-block .photo-anchor,.open-book .ai-geometry .zine-block .story-copy{transform:none}
.open-book .ai-geometry .zine-block.text-below{grid-template-columns:1fr}
.open-book .ai-geometry .zine-block.text-below .photo-anchor,.open-book .ai-geometry .zine-block.text-below .story-copy{grid-column:1}
.open-book .ai-geometry .zine-block.text-left .photo-anchor{grid-column:2;grid-row:1}
.open-book .ai-geometry .zine-block.text-left .story-copy{grid-column:1;grid-row:1}
.open-book .ai-geometry .zine-block.text-overlay{grid-template-columns:1fr}
.open-book .ai-geometry .zine-block.text-overlay .photo-anchor,.open-book .ai-geometry .zine-block.text-overlay .story-copy{grid-area:1/1}
.open-book .ai-geometry .zine-block.text-overlay .story-copy{z-index:4;align-self:end;margin:0 6% 7% 19%;background:rgba(248,244,233,.88);box-shadow:0 4px 12px rgba(54,43,35,.13)}
.open-book .ai-geometry .zine-block .photo-anchor img{max-height:210px}
.open-book .ai-geometry .zine-block.text-below .photo-anchor img{max-height:185px}
.open-book .ai-geometry .zine-block .story-copy textarea{max-height:82px}
.open-book .ai-geometry .treatment-natural .photo-anchor img{filter:none}
.open-book .ai-geometry .treatment-soft-xerox .photo-anchor img{filter:grayscale(.82) contrast(1.12) brightness(1.06);mix-blend-mode:multiply}
.open-book .ai-geometry .treatment-risograph .photo-anchor{background:var(--zine-accent-soft)}
.open-book .ai-geometry .treatment-risograph .photo-anchor img{filter:grayscale(1) contrast(1.42) brightness(1.08);mix-blend-mode:multiply;opacity:.82}
.open-book .ai-geometry .treatment-torn-paper .photo-anchor{clip-path:none}
.open-book .ai-geometry .treatment-torn-paper .photo-anchor img{clip-path:polygon(2% 0,98% 3%,100% 92%,95% 100%,4% 97%,0 8%);filter:saturate(.72) contrast(1.08) sepia(.13)}
.open-book .ai-geometry .treatment-film-grain .photo-anchor img{filter:saturate(.78) contrast(1.04) sepia(.08)}
.open-book .ai-geometry .tape-none .photo-anchor::before{display:none}
.open-book .ai-geometry .tape-upper-left .photo-anchor::before{display:block;left:8%;right:auto;top:-8px;transform:rotate(-5deg)}
.open-book .ai-geometry .tape-upper-center .photo-anchor::before{display:block;left:34%;right:auto;top:-8px;transform:rotate(-2deg)}
.open-book .ai-geometry .tape-upper-right .photo-anchor::before{display:block;left:auto;right:8%;top:-8px;transform:rotate(5deg)}
.open-book .ai-geometry .tape-side .photo-anchor::before{display:block;left:-11px;right:auto;top:38%;width:31%;transform:rotate(82deg)}
.open-book .zine-block:not(.cutout-illustration) .photo-anchor{background:#eee9df!important}.open-book .zine-block:not(.cutout-illustration) .photo-anchor::after{display:none!important}.open-book .zine-block:not(.cutout-illustration) .photo-anchor img{filter:none!important;mix-blend-mode:normal!important;opacity:1!important;clip-path:none!important}
.open-book .zine-block.cutout-illustration{overflow:visible;padding:2px;background:transparent;border:0;box-shadow:none;column-gap:0}.open-book .cutout-illustration .photo-anchor{overflow:visible;padding:0;background:transparent!important;box-shadow:none!important;isolation:auto}.open-book .cutout-illustration .photo-anchor::before,.open-book .cutout-illustration .photo-anchor::after{display:none!important}.open-book .cutout-illustration .photo-anchor img{position:relative;z-index:2;max-width:116%;max-height:285px;object-fit:contain;filter:saturate(.9) contrast(1.04)!important;mix-blend-mode:multiply!important;opacity:.96!important;transform:rotate(-1.2deg) scale(1.04);transform-origin:50% 55%}.open-book .cutout-illustration:nth-child(even) .photo-anchor img{transform:rotate(1.35deg) scale(1.03)}.open-book .cutout-illustration .story-copy{position:relative;z-index:4;padding:5px 3px;background:transparent;box-shadow:none}.open-book .cutout-illustration .story-copy input,.open-book .cutout-illustration .story-copy textarea{background:transparent!important;text-shadow:0 1px rgba(244,240,230,.75)}.open-book .cutout-illustration.text-right .story-copy{margin-left:-16%;transform:rotate(.7deg)!important}.open-book .cutout-illustration.text-left .story-copy{margin-right:-16%;transform:rotate(-.65deg)!important}.open-book .cutout-illustration.text-below .story-copy{margin:-12px 7% 0 16%;transform:rotate(-.55deg)!important}.open-book .cutout-illustration.text-overlay .story-copy{margin:0 2% 4% 28%;background:rgba(244,240,230,.28)!important;box-shadow:none!important;transform:rotate(.8deg)!important}.open-book .cutout-illustration .illustration-badge{opacity:0;border:0;background:transparent;box-shadow:none;transition:.18s}.open-book .cutout-illustration .photo-anchor:hover .illustration-badge{opacity:.68}.open-book .ai-geometry .cutout-illustration .photo-anchor img{max-height:245px}.open-book .ai-geometry .cutout-illustration.text-below .photo-anchor img{max-height:225px}
.open-book .zine-block.cutout-illustration{display:grid;grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);align-items:center;overflow:visible!important}.cutout-art{position:relative;z-index:2;min-width:0;display:flex;align-items:center;justify-content:center;overflow:visible;margin:0;isolation:auto}.cutout-art img{display:block;width:auto;height:auto;max-width:118%;max-height:270px;object-fit:contain;filter:saturate(.94) contrast(1.035);mix-blend-mode:multiply;transform:rotate(-1.1deg) scale(1.06);transform-origin:50% 55%}.cutout-illustration:nth-child(even) .cutout-art img{transform:rotate(1.25deg) scale(1.04)}.floating-story{position:relative;z-index:5;min-width:0;display:grid;align-content:center;gap:4px;padding:0;background:none!important;border:0!important;box-shadow:none!important}.floating-story::before{content:'';width:38px;height:3px;margin:0 0 5px;background:var(--zine-accent);transform:rotate(-4deg)}.floating-story input,.floating-story textarea{width:100%;padding:0;border:0;border-bottom:1px solid transparent;outline:0;background:transparent!important;color:#443d37;text-shadow:0 1px rgba(244,240,230,.7)}.floating-story>input:first-of-type{font:650 22px/1.1 var(--font-hand);transform:rotate(-.6deg)}.floating-story textarea{min-height:76px;resize:vertical;font:520 18px/1.45 var(--font-hand);letter-spacing:.01em}.floating-story .place-input{color:#766d65;font:8px/1.4 ui-monospace,monospace;letter-spacing:.11em;text-transform:uppercase}.floating-story input:focus,.floating-story textarea:focus{border-bottom-color:var(--zine-accent)}.cutout-illustration.text-right .cutout-art{grid-column:1;grid-row:1}.cutout-illustration.text-right .floating-story{grid-column:2;grid-row:1;margin-left:-24%;transform:translateY(7%) rotate(.8deg)}.cutout-illustration.text-left .cutout-art{grid-column:2;grid-row:1}.cutout-illustration.text-left .floating-story{grid-column:1;grid-row:1;margin-right:-22%;transform:translateY(-5%) rotate(-.7deg)}.open-book .zine-block.cutout-illustration.text-below{grid-template-columns:1fr}.cutout-illustration.text-below .cutout-art{grid-area:1/1}.cutout-illustration.text-below .floating-story{grid-area:2/1;width:76%;justify-self:end;margin:-24px 2% 0 0;transform:rotate(-.8deg)}.open-book .zine-block.cutout-illustration.text-overlay{grid-template-columns:1fr}.cutout-illustration.text-overlay .cutout-art,.cutout-illustration.text-overlay .floating-story{grid-area:1/1}.cutout-illustration.text-overlay .floating-story{width:54%;align-self:end;justify-self:end;margin:0 -3% 2% 0;transform:rotate(.65deg)}.cutout-art .illustration-badge{left:3%;top:2%;opacity:0;border:0;background:transparent;box-shadow:none}.cutout-art:hover .illustration-badge{opacity:.62}.cutout-art:hover .photo-ai-actions,.cutout-art .photo-ai-actions:focus-within{opacity:1;transform:none}.open-book .ai-geometry .cutout-art img{max-height:265px}.blocks-2 .cutout-art img{max-height:210px}.blocks-2 .floating-story textarea{min-height:52px;max-height:76px}
/* A cutout group receives one rotation from the placement container. Children stay aligned and keep a paper gap. */
.open-book .zine-block.cutout-illustration{column-gap:18px!important;row-gap:12px!important}.open-book .cutout-illustration .cutout-art img,.open-book .cutout-illustration:nth-child(even) .cutout-art img{max-width:100%;transform:none!important}.open-book .cutout-illustration .floating-story,.open-book .cutout-illustration .floating-story>input:first-of-type{transform:none!important}.open-book .cutout-illustration.text-right .floating-story{margin:0!important;transform:none!important}.open-book .cutout-illustration.text-left .floating-story{margin:0!important;transform:none!important}.open-book .cutout-illustration.text-below .floating-story{width:82%;margin:0!important;transform:none!important}.open-book .zine-block.cutout-illustration.text-overlay{grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr)}.open-book .cutout-illustration.text-overlay .cutout-art{grid-area:1/1}.open-book .cutout-illustration.text-overlay .floating-story{grid-area:1/2;width:auto;align-self:center;justify-self:stretch;margin:0!important;transform:none!important}
/* Gathered-scenes keeps its paper field opaque. It shares the safe, non-overlapping
   text geometry with cutouts, but never receives cutout blend/filter treatment. */
.open-book .zine-block.gathered-collage{grid-template-columns:minmax(0,1.22fr) minmax(0,.78fr);background:transparent!important}.open-book .gathered-collage .gathered-art{overflow:hidden;background:transparent}.open-book .gathered-collage .gathered-art img{width:100%;height:auto;max-width:100%;max-height:280px;object-fit:contain;filter:none!important;mix-blend-mode:normal!important;opacity:1!important;transform:none!important}.open-book .gathered-collage .floating-story::before{width:52px;height:2px}.open-book .ai-geometry .gathered-collage .gathered-art img{max-height:260px}.blocks-2 .gathered-collage .gathered-art img{max-height:205px}
@media(max-width:760px){.open-book .block-cluster.ai-geometry .zine-block{grid-template-columns:1fr}.open-book .ai-geometry .zine-block .photo-anchor img{max-height:145px}.open-book .ai-geometry .zine-block .story-copy textarea{max-height:66px}}
@media(max-width:760px){.journey-pin small{display:none}.journey-overview{left:4%;bottom:4%;width:44%;padding-left:28px}.journey-overview::before{left:8px}.journey-overview strong{font-size:12px}.journey-stop-strip>span em{display:none}}
@media(prefers-reduced-motion:reduce){.page-turn-sheet,.page-turn-underlay,.turn-paper-light,.open-book.turn-covering>.spread-layer,.open-book.turn-revealing>.spread-layer{animation-duration:.01ms!important;animation-delay:0ms!important}}
</style>
