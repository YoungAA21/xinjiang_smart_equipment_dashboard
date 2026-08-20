<template>
  <div ref="host" class="spectrogram-canvas" role="img" aria-label="频谱瀑布图">
    <canvas ref="canvas" />
    <div v-if="!normalizedFrames.length" class="empty-chart dark">等待实时频谱数据</div>
    <div class="frequency-axis">
      <span>{{ frequencyMaxLabel }}</span>
      <span>{{ frequencyMidLabel }}</span>
      <span>0 Hz</span>
    </div>
    <div class="time-axis">
      <span>窗口起点</span>
      <span>时间 -></span>
      <span>当前</span>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  frames: { type: Array, default: () => [] },
  sampleRate: { type: Number, default: 22000 },
})

const host = ref(null)
const canvas = ref(null)
let observer = null
let themeObserver = null
let animationFrame = 0

const normalizedFrames = computed(() => props.frames.map((row) =>
  row.map((value) => value > 1 || value < 0 ? Math.max(0, Math.min(1, (value + 120) / 120)) : value)))
const frequencyMaxLabel = computed(() => `${Math.round((props.sampleRate || 22000) / 200) / 10} kHz`)
const frequencyMidLabel = computed(() => `${Math.round((props.sampleRate || 22000) / 400) / 10} kHz`)

const heat = (value) => {
  const stops = [[0, 20, 12, 48], [0.25, 56, 53, 126], [0.5, 35, 132, 140], [0.75, 94, 190, 100], [1, 245, 225, 55]]
  const index = Math.min(stops.length - 2, Math.floor(value * (stops.length - 1)))
  const left = stops[index]
  const right = stops[index + 1]
  const ratio = (value - left[0]) / (right[0] - left[0])
  return [1, 2, 3].map((item) => Math.round(left[item] + (right[item] - left[item]) * ratio))
}

const render = () => {
  cancelAnimationFrame(animationFrame)
  animationFrame = requestAnimationFrame(() => {
    const element = canvas.value
    const container = host.value
    if (!element || !container) return
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
    element.style.width = `${width}px`
    element.style.height = `${height}px`
    const context = element.getContext('2d')
    if (!context) return
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const styles = getComputedStyle(container)
    context.fillStyle = styles.getPropertyValue('--spectrogram-bg').trim() || '#080b17'
    context.fillRect(0, 0, width, height)
    if (!normalizedFrames.value.length) return

    const plotLeft = 42
    const plotRight = width - 8
    const plotTop = 6
    const plotBottom = height - 23
    const plotWidth = Math.max(1, plotRight - plotLeft)
    const plotHeight = Math.max(1, plotBottom - plotTop)
    const columnWidth = plotWidth / Math.max(1, normalizedFrames.value.length)

    normalizedFrames.value.forEach((column, timeIndex) => {
      const cellHeight = plotHeight / Math.max(1, column.length)
      column.forEach((value, frequencyIndex) => {
        const [red, green, blue] = heat(value)
        context.fillStyle = `rgb(${red} ${green} ${blue})`
        context.fillRect(
          plotLeft + timeIndex * columnWidth,
          plotBottom - (frequencyIndex + 1) * cellHeight,
          Math.ceil(columnWidth + 0.5),
          Math.ceil(cellHeight + 0.5),
        )
      })
    })

    context.strokeStyle = 'rgba(216, 199, 255, .18)'
    context.lineWidth = 1
    for (let index = 0; index <= 4; index += 1) {
      const x = plotLeft + plotWidth * index / 4
      context.beginPath()
      context.moveTo(x, plotTop)
      context.lineTo(x, plotBottom)
      context.stroke()
    }
  })
}

watch(() => [props.frames, props.sampleRate], render, { deep: true })
onMounted(async () => {
  await nextTick()
  observer = new ResizeObserver(render)
  if (host.value) observer.observe(host.value)
  themeObserver = new MutationObserver(render)
  const shell = document.querySelector('.dashboard-shell')
  if (shell) themeObserver.observe(shell, { attributes: true, attributeFilter: ['class'] })
  render()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  themeObserver?.disconnect()
  cancelAnimationFrame(animationFrame)
})
</script>

<style scoped>
.spectrogram-canvas {
  position: relative;
  width: 100%;
  height: 230px;
  overflow: hidden;
  background: var(--spectrogram-bg, #080b17);
  border-radius: 7px;
}
canvas {
  position: absolute;
  inset: 0;
}
.empty-chart {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  color: var(--spectrogram-axis, #a8b7cf);
  font-size: 12px;
}
.frequency-axis {
  position: absolute;
  top: 6px;
  bottom: 23px;
  left: 5px;
  display: flex;
  width: 34px;
  flex-direction: column;
  justify-content: space-between;
  color: var(--spectrogram-axis, #a8b7cf);
  font-size: 9px;
  pointer-events: none;
}
.time-axis {
  position: absolute;
  right: 8px;
  bottom: 3px;
  left: 42px;
  display: flex;
  justify-content: space-between;
  color: var(--spectrogram-axis, #a8b7cf);
  font-size: 9px;
  pointer-events: none;
}
@media (max-height: 800px) {
  .spectrogram-canvas {
    height: 150px;
  }
}
</style>
