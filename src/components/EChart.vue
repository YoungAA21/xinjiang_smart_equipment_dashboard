<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts'

const props = defineProps({
  preserveZoom: Boolean,
  option: {
    type: Object,
    required: true,
  },
})

const chartEl = ref(null)
let chart
let resizeObserver
let themeObserver

const isLightTheme = () => Boolean(document.querySelector('.dashboard-shell.light-theme'))

const mapThemeColor = (value) => {
  if (!isLightTheme() || typeof value !== 'string') return value
  const normalized = value.replace(/\s+/g, '').toLowerCase()
  if (normalized === '#ffffff' || normalized === '#fff') return '#10201c'
  if (normalized === '#c3e2d9') return '#526861'
  if (normalized === '#111312') return '#ffffff'
  if (normalized === 'rgba(195,226,217,.12)' || normalized === 'rgba(195,226,217,0.12)') return 'rgba(31,73,63,.14)'
  if (normalized === 'rgba(195,226,217,.10)' || normalized === 'rgba(195,226,217,0.10)') return 'rgba(31,73,63,.12)'
  return value
}

const themedOption = (value) => {
  if (Array.isArray(value)) return value.map(themedOption)
  if (!value || typeof value !== 'object') return mapThemeColor(value)
  const result = {}
  Object.entries(value).forEach(([key, item]) => {
    result[key] = typeof item === 'function' ? item : themedOption(item)
  })
  return result
}

const render = () => {
  if (!chartEl.value) return
  if (!chart) {
    chart = echarts.init(chartEl.value, {
      textStyle: { fontSize: 15 },
      title: { textStyle: { fontSize: 23 }, subtextStyle: { fontSize: 15 } },
      legend: { textStyle: { fontSize: 15 } },
      tooltip: { textStyle: { fontSize: 18 } },
      categoryAxis: { axisLabel: { fontSize: 15 }, nameTextStyle: { fontSize: 15 } },
      valueAxis: { axisLabel: { fontSize: 15 }, nameTextStyle: { fontSize: 15 } },
      timeAxis: { axisLabel: { fontSize: 15 }, nameTextStyle: { fontSize: 15 } },
      logAxis: { axisLabel: { fontSize: 15 }, nameTextStyle: { fontSize: 15 } },
    }, { renderer: 'canvas' })
  }
  const option = themedOption(props.option)
  if (props.preserveZoom && option.dataZoom) {
    const previous = chart.getOption()?.dataZoom || []
    option.dataZoom = option.dataZoom.map((zoom, index) => previous[index]
      ? { ...zoom, start: previous[index].start, end: previous[index].end }
      : zoom)
  }
  chart.setOption(option, true)
}

watch(() => props.option, render, { deep: true })

onMounted(() => {
  render()
  resizeObserver = new ResizeObserver(() => chart?.resize())
  resizeObserver.observe(chartEl.value)
  themeObserver = new MutationObserver(render)
  const shell = document.querySelector('.dashboard-shell')
  if (shell) themeObserver.observe(shell, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <div ref="chartEl" class="echart" aria-hidden="true"></div>
</template>
