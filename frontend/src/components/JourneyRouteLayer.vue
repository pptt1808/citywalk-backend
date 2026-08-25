<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import rough from 'roughjs/bundled/rough.esm.js'
import type { JournalAccent } from '../composables/useJournal'

export interface JourneyRouteNode {
  blockId: string
  momentId: string
  order: number
  number: string
  label: string
  branch: boolean
  located: boolean
  page: 'left' | 'right'
  x: number
  y: number
}

const props = defineProps<{
  nodes: JourneyRouteNode[]
  accent: JournalAccent
  spreadId: string
  hasPrevious: boolean
  hasNext: boolean
  previousNumber?: string
  nextNumber?: string
}>()

const svgElement = ref<SVGSVGElement | null>(null)
const colors: Record<JournalAccent, string> = {
  cobalt: '#1646d8', tomato: '#c84332', pear: '#6d9418',
  violet: '#7650c7', lemon: '#b99a00', cyan: '#008ca6'
}

interface Point { x: number; y: number }

function hash(value: string): number {
  let output = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index)
    output = Math.imul(output, 16777619)
  }
  return Math.abs(output) || 1
}

function safePoint(node: JourneyRouteNode): Point {
  return { x: Math.max(22, Math.min(978, node.x)), y: Math.max(90, Math.min(575, node.y)) }
}

function appendText(svg: SVGSVGElement, value: string, x: number, y: number, anchor: 'start' | 'end' = 'start') {
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  text.setAttribute('x', String(x))
  text.setAttribute('y', String(y))
  text.setAttribute('text-anchor', anchor)
  text.setAttribute('class', 'journey-continuation')
  text.textContent = value
  svg.appendChild(text)
}

function draw() {
  const svg = svgElement.value
  if (!svg) return
  svg.replaceChildren()
  if (!props.nodes.length) return
  const rc = rough.svg(svg)
  const accent = colors[props.accent]
  const ink = '#62584f'
  const seedBase = hash(props.spreadId)
  const lineOptions = {
    stroke: accent,
    strokeWidth: 2.25,
    roughness: 1.65,
    bowing: 1.25,
    strokeLineDash: [8, 7] as number[],
    seed: seedBase
  }
  const groups = new Map<string, JourneyRouteNode[]>()
  props.nodes.forEach(node => {
    const current = groups.get(node.momentId) ?? []
    current.push(node)
    groups.set(node.momentId, current)
  })
  const moments = [...groups.values()]
    .sort((left, right) => left[0].order - right[0].order)
    .map(nodes => ({ nodes, primary: nodes.find(node => !node.branch) ?? nodes[0] }))

  const appendCurve = (from: Point, to: Point, seed: number, branch = false) => {
    const crossSpine = (from.x < 500 && to.x > 500) || (from.x > 500 && to.x < 500)
    const options = {
      ...lineOptions,
      seed,
      stroke: branch ? ink : accent,
      strokeWidth: branch ? 1.25 : 2.25,
      strokeLineDash: branch ? [3, 6] : [8, 7]
    }
    const curve = (start: Point, end: Point, curveSeed: number) => {
      const direction = (curveSeed % 2 ? 1 : -1) * Math.min(32, Math.abs(end.y - start.y) * .18 + 10)
      const middle = (start.x + end.x) / 2
      return `M ${start.x} ${start.y} C ${middle - 22} ${start.y + direction}, ${middle + 22} ${end.y - direction}, ${end.x} ${end.y}`
    }
    if (!crossSpine) {
      svg.appendChild(rc.path(curve(from, to, seed), options))
      return
    }
    const leftToRight = from.x < to.x
    const firstEdge = leftToRight ? 458 : 542
    const secondEdge = leftToRight ? 542 : 458
    const ratio = Math.abs(firstEdge - from.x) / Math.max(1, Math.abs(to.x - from.x))
    const edgeY = from.y + (to.y - from.y) * ratio
    svg.appendChild(rc.path(curve(from, { x: firstEdge, y: edgeY }, seed), options))
    svg.appendChild(rc.path(curve({ x: secondEdge, y: edgeY }, to, seed + 1), { ...options, seed: seed + 1 }))
    svg.appendChild(rc.line(firstEdge + (leftToRight ? -10 : 10), edgeY - 6, firstEdge, edgeY, { ...options, strokeLineDash: [], seed: seed + 2 }))
    svg.appendChild(rc.line(secondEdge, edgeY, secondEdge + (leftToRight ? 10 : -10), edgeY + 6, { ...options, strokeLineDash: [], seed: seed + 3 }))
  }

  moments.forEach((moment, index) => {
    const primary = safePoint(moment.primary)
    moment.nodes.filter(node => node.blockId !== moment.primary.blockId).forEach((branch, branchIndex) => {
      appendCurve(primary, safePoint(branch), seedBase + 40 + index * 5 + branchIndex, true)
    })
    const ringOptions = {
      stroke: moment.primary.located ? accent : ink,
      strokeWidth: moment.primary.located ? 2 : 1.3,
      fill: '#f4f0e6',
      fillStyle: 'solid' as const,
      roughness: 1.4,
      seed: seedBase + 80 + index
    }
    svg.appendChild(rc.circle(primary.x, primary.y, moment.primary.located ? 16 : 13, ringOptions))
  })
  for (let index = 0; index < moments.length - 1; index += 1) {
    appendCurve(safePoint(moments[index].primary), safePoint(moments[index + 1].primary), seedBase + index * 7)
  }

  const first = safePoint(moments[0].primary)
  const last = safePoint(moments[moments.length - 1].primary)
  if (props.hasPrevious) {
    const start = first.x < 500 ? { x: 24, y: Math.max(105, first.y - 34) } : { x: 542, y: Math.max(105, first.y - 34) }
    appendCurve(start, first, seedBase + 120)
    appendText(svg, `← 来自 ${props.previousNumber ?? moments[0].primary.number}`, start.x + (first.x < 500 ? 2 : 10), start.y - 9)
  }
  if (props.hasNext) {
    const end = last.x > 500 ? { x: 976, y: Math.min(570, last.y + 42) } : { x: 458, y: Math.min(570, last.y + 42) }
    appendCurve(last, end, seedBase + 140)
    appendText(svg, `继续 ${props.nextNumber ?? String(moments[moments.length - 1].primary.order + 2).padStart(2, '0')} →`, end.x + (last.x > 500 ? -3 : -8), end.y + 18, 'end')
  }
}

onMounted(draw)
watch(() => [props.nodes, props.accent, props.spreadId, props.hasPrevious, props.hasNext, props.previousNumber, props.nextNumber], async () => {
  await nextTick()
  draw()
}, { deep: true })
</script>

<template>
  <svg ref="svgElement" class="journey-route-layer" viewBox="0 0 1000 640" preserveAspectRatio="none" aria-hidden="true" />
</template>

<style scoped>
.journey-route-layer{position:absolute;z-index:3;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;mix-blend-mode:multiply}.journey-route-layer :deep(.journey-continuation){fill:#675d54;font:700 9px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}
</style>
