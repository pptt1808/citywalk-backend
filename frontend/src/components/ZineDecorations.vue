<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import rough from 'roughjs/bundled/rough.esm.js'
import type { JournalAccent, JournalDecoration, JournalVisualDirection } from '../composables/useJournal'

const props = defineProps<{
  direction: JournalVisualDirection
  accent: JournalAccent
  spreadId: string
}>()

const svgElement = ref<SVGSVGElement | null>(null)
const colors: Record<JournalAccent, string> = {
  cobalt: '#1749d8', tomato: '#df4938', pear: '#78a915',
  violet: '#7750c8', lemon: '#d7ba00', cyan: '#008da7'
}

function hash(value: string): number {
  let output = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    output ^= value.charCodeAt(index)
    output = Math.imul(output, 16777619)
  }
  return Math.abs(output) || 1
}

function pageX(page: 'left' | 'right', localX: number): number {
  return (page === 'right' ? 500 : 0) + localX * 5
}

function group(svg: SVGSVGElement, x: number, y: number, rotation: number, scale: number): SVGGElement {
  const result = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  result.setAttribute('transform', `translate(${x} ${y}) rotate(${rotation}) scale(${scale})`)
  svg.appendChild(result)
  return result
}

function appendDecoration(
  svg: SVGSVGElement,
  rc: ReturnType<typeof rough.svg>,
  decoration: JournalDecoration,
  seed: number
) {
  const ink = '#544b43'
  const accent = colors[props.accent]
  const node = group(svg, pageX(decoration.page, decoration.x), decoration.y * 6.4, decoration.rotation, decoration.scale)
  const line = { stroke: ink, strokeWidth: 1.8, roughness: 1.7, bowing: 1.4, seed }
  if (decoration.kind === 'route-line') {
    node.appendChild(rc.path('M -52 12 C -25 -26, 6 34, 53 -10', line))
    node.appendChild(rc.circle(-53, 12, 8, { ...line, stroke: accent, fill: accent, fillStyle: 'solid', seed: seed + 1 }))
    node.appendChild(rc.circle(54, -10, 13, { ...line, stroke: accent, fill: 'none', seed: seed + 2 }))
  } else if (decoration.kind === 'orbit') {
    node.appendChild(rc.ellipse(0, 0, 98, 51, { ...line, stroke: accent }))
    node.appendChild(rc.circle(43, -13, 11, { ...line, stroke: accent, fill: accent, fillStyle: 'solid', seed: seed + 1 }))
  } else if (decoration.kind === 'registration-dots') {
    ;[-22, 0, 22].forEach((x, index) => node.appendChild(rc.circle(x, index % 2 ? 3 : -3, 10, {
      ...line, stroke: index === 1 ? accent : ink, fill: index === 1 ? accent : 'none', fillStyle: 'solid', seed: seed + index
    })))
  } else if (decoration.kind === 'corner-marks') {
    node.appendChild(rc.line(-35, -22, -35, 22, line))
    node.appendChild(rc.line(-35, -22, 18, -22, { ...line, seed: seed + 1 }))
    node.appendChild(rc.line(35, 22, 35, -7, { ...line, stroke: accent, seed: seed + 2 }))
    node.appendChild(rc.line(35, 22, 7, 22, { ...line, stroke: accent, seed: seed + 3 }))
  } else if (decoration.kind === 'underline') {
    node.appendChild(rc.path('M -48 0 C -19 7, 17 -7, 49 1', { ...line, stroke: accent, strokeWidth: 3 }))
    node.appendChild(rc.line(-35, 10, 28, 13, { ...line, strokeWidth: 1, seed: seed + 1 }))
  } else {
    node.appendChild(rc.path('M 0 42 C -3 15, 4 -12, -6 -43', line))
    node.appendChild(rc.ellipse(-15, 13, 31, 14, { ...line, stroke: accent, seed: seed + 1 }))
    node.appendChild(rc.ellipse(15, -8, 34, 15, { ...line, seed: seed + 2 }))
    node.appendChild(rc.ellipse(-16, -27, 30, 13, { ...line, stroke: accent, seed: seed + 3 }))
  }
}

function draw() {
  const svg = svgElement.value
  if (!svg) return
  svg.replaceChildren()
  const rc = rough.svg(svg)
  const direction = props.direction
  const accent = colors[props.accent]
  const x = pageX(direction.accentPage, direction.accentX)
  const y = direction.accentY * 6.4
  const width = direction.accentWidth * 5
  const height = direction.accentHeight * 6.4
  const accentGroup = group(svg, x + width / 2, y + height / 2, direction.accentRotation, 1)
  const accentOptions = { stroke: accent, fill: accent, fillStyle: 'solid' as const, roughness: 1.9, bowing: 1.4, seed: hash(`${props.spreadId}:accent`) }
  if (direction.accentForm === 'stamp-circle') {
    accentGroup.appendChild(rc.ellipse(0, 0, width, height, accentOptions))
    accentGroup.appendChild(rc.ellipse(0, 0, width * .67, height * .67, { ...accentOptions, fill: 'none', strokeWidth: 1.2, seed: accentOptions.seed + 1 }))
  } else if (direction.accentForm === 'torn-strip') {
    accentGroup.appendChild(rc.polygon([
      [-width / 2, -height * .35], [-width * .22, -height / 2], [width * .05, -height * .32],
      [width / 2, -height / 2], [width * .44, height * .42], [width * .12, height / 2],
      [-width * .18, height * .33], [-width / 2, height / 2]
    ], accentOptions))
  } else if (direction.accentForm === 'brush-stroke') {
    accentGroup.appendChild(rc.line(-width / 2, 0, width / 2, 0, { ...accentOptions, fill: 'none', strokeWidth: Math.max(9, height * .72) }))
  } else {
    accentGroup.appendChild(rc.rectangle(-width / 2, -height / 2, width, height, accentOptions))
  }

  direction.decorations.slice(0, 3).forEach((decoration, index) => {
    appendDecoration(svg, rc, decoration, hash(`${props.spreadId}:${decoration.kind}:${index}`))
  })
}

onMounted(draw)
watch(() => [props.direction, props.accent, props.spreadId], async () => {
  await nextTick()
  draw()
}, { deep: true })
</script>

<template>
  <svg ref="svgElement" class="zine-decoration-layer" viewBox="0 0 1000 640" preserveAspectRatio="none" aria-hidden="true" />
</template>

<style scoped>
.zine-decoration-layer{position:absolute;z-index:2;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none;opacity:.94;mix-blend-mode:multiply}
</style>
