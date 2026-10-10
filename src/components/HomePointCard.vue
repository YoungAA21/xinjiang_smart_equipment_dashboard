<script setup>
import { monitoringPointName } from '../charts/equipmentCatalog.js'
import { computed } from 'vue'
import EChart from './EChart.vue'
import { numericValue, telemetryLine } from '../charts/telemetry.js'
const props = defineProps({ point: { type: Object, required: true }, samples: { type: Array, default: () => [] }, color: { type: String, default: '#39a9ff' }, now: Number, paused: Boolean, compact: Boolean })
const label = computed(() => monitoringPointName(props.point))
const latest = computed(() => props.samples.at(-1))
const value = computed(() => numericValue(latest.value?.value) === null ? '—' : latest.value.value.toFixed(3))
const stale = computed(() => latest.value && props.now - Date.parse(latest.value.collectedAt) > 10000)
const option = computed(() => {
  const result = telemetryLine(props.samples, { ...props.point, name: label.value }, { color: props.color })
  result.grid = { left: 44, right: 10, top: 14, bottom: 24 }
  result.dataZoom = []
  result.xAxis.splitNumber = 3
  result.xAxis.axisLabel.fontSize = 10
  result.yAxis.name = ''
  result.yAxis.splitNumber = 2
  result.yAxis.axisLabel.fontSize = 10
  result.series[0].lineStyle.width = 1.5
  result.series[0].showSymbol = props.samples.length < 2
  result.series[0].areaStyle.opacity = .6
  if (props.compact) {
    result.grid = { left: 3, right: 5, top: 7, bottom: 5 }
    result.xAxis.show = false
    result.yAxis.show = false
    result.graphic = []
  }
  return result
})
</script>
<template>
  <section class="home-point" :class="{ compact }" :title="label + (latest ? ' · 采样时间 ' + new Date(latest.collectedAt).toLocaleString('zh-CN') : ' · 暂无采样')" :style="{ '--signal': color }">
    <header><h3>{{ label }}</h3><span :class="{ stale }">{{ paused ? '已暂停' : stale ? '未更新' : latest ? '实时' : '待采样' }}</span></header>
    <div class="home-point-value"><strong :key="latest?.collectedAt">{{ value }}</strong><small>{{ point.unit }}</small></div>
    <div class="home-point-chart" role="img" :aria-label="label + '实时折线，' + samples.length + '个样本'"><EChart :option="option" /></div>
    <footer><span>{{ point.channelId }} · {{ point.pointCode }}</span><time>{{ latest ? new Date(latest.collectedAt).toLocaleTimeString('zh-CN', { hour12: false }) : '暂无数据' }}</time></footer>
  </section>
</template>
<style scoped>
.home-point { min-width: 0; padding: 13px 12px 9px; border: 1px solid var(--wall-line); border-radius: 7px; background: var(--wall-point); }
.home-point header { display: flex; justify-content: space-between; align-items: start; gap: 8px; }
.home-point h3 { margin: 0; color: var(--wall-text); font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.home-point header span { color: var(--wall-muted); font-size: 10px; white-space: nowrap; }.home-point header .stale { color: #ffad66; }
.home-point-value { display: flex; align-items: baseline; gap: 7px; margin-top: 10px; height: 38px; }.home-point-value strong { font-size: 28px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--signal); animation: sample-arrive .65s ease-out; }.home-point-value small { font-size: 11px; color: var(--wall-muted); }
.home-point-chart { height: 105px; }.home-point footer { display: flex; justify-content: space-between; gap: 6px; font-size: 10px; color: var(--wall-muted); }.home-point footer span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes sample-arrive { from { opacity: .45; text-shadow: 0 0 14px var(--signal); } to { opacity: 1; text-shadow: none; } }
@media (prefers-reduced-motion: reduce) { .home-point-value strong { animation: none; } }

.home-point.compact { display: grid; grid-template-columns: minmax(90px, .85fr) minmax(0, 1.15fr); grid-template-rows: auto auto; column-gap: 8px; padding: 5px 10px; border-radius: 4px; }
.compact header { grid-column: 1; align-items: center; gap: 4px; }.compact h3 { font-size: 11px; }.compact header span { font-size: 9px; }
.compact .home-point-value { grid-column: 1; margin-top: 3px; height: 22px; gap: 4px; }.compact .home-point-value strong { font-size: 21px; }.compact .home-point-value small { font-size: 10px; }
.compact .home-point-chart { grid-column: 2; grid-row: 1 / 3; height: 38px; align-self: center; }.compact footer { display: none; }
</style>
