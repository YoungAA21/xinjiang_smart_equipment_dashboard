<script setup>
import { computed } from 'vue'
import EChart from './EChart.vue'
import { telemetryLine } from '../charts/telemetry.js'
const props = defineProps({ speed: Object, current: Object, buffers: Object, now: Number, paused: Boolean, speedName: { type: String, default: '辅机车速' }, currentName: { type: String, default: '辅机电流' }, title: { type: String, default: '辅机运行参数' } })
function latest(point) { return (props.buffers[point?.key] || []).at(-1) }
const speedSample = computed(() => latest(props.speed))
const currentSample = computed(() => latest(props.current))
const speedSamples = computed(() => props.buffers[props.speed?.key] || [])
const currentSamples = computed(() => props.buffers[props.current?.key] || [])
function lineOption(samples, point, color) {
  const option = telemetryLine(samples, point, { color })
  option.grid = { left: 3, right: 3, top: 5, bottom: 4 }
  option.xAxis.show = false
  option.yAxis.show = false
  option.dataZoom = []
  option.graphic = []
  option.series[0].showSymbol = false
  option.series[0].lineStyle.width = 1.5
  option.series[0].areaStyle.opacity = .4
  return option
}
const speedOption = computed(() => lineOption(speedSamples.value, props.speed, '#368ce8'))
const currentOption = computed(() => lineOption(currentSamples.value, props.current, '#18a99a'))
const status = computed(() => {
  if (props.paused) return '已暂停'
  const samples = [speedSample.value, currentSample.value].filter(Boolean)
  if (!samples.length) return '待采样'
  return samples.some(sample => props.now - Date.parse(sample.collectedAt) > 10000) ? '未更新' : '实时'
})
function value(sample) { return typeof sample?.value === 'number' && Number.isFinite(sample.value) ? sample.value.toFixed(2) : '—' }
</script>
<template>
  <section class="auxiliary-card" :class="{ stale: status === '未更新' }">
    <header><h3>{{ title }}</h3><span>{{ status }}</span></header>
    <div class="values">
      <div class="reading">
        <span>{{ speedName }}</span>
        <div class="trend" role="img" aria-label="辅机车速实时折线"><EChart :option="speedOption" /></div>
        <div class="reading-value"><strong>{{ value(speedSample) }}</strong><small>rpm</small></div>
      </div>
      <div class="reading">
        <span>{{ currentName }}</span>
        <div class="trend" role="img" aria-label="辅机电流实时折线"><EChart :option="currentOption" /></div>
        <div class="reading-value"><strong>{{ value(currentSample) }}</strong><small>{{ current?.unit || '' }}</small></div>
      </div>
    </div>
    <footer><span>车速 {{ speedSample ? new Date(speedSample.collectedAt).toLocaleTimeString('zh-CN', { hour12:false }) : '暂无数据' }}</span><span>电流 {{ currentSample ? new Date(currentSample.collectedAt).toLocaleTimeString('zh-CN', { hour12:false }) : '暂无数据' }}</span></footer>
  </section>
</template>
<style scoped>
.auxiliary-card { height:100%; min-height:188px; padding:6px 14px 10px; display:flex; flex-direction:column; justify-content:space-between; background:transparent; border:0; border-radius:0; }
header { display:flex; justify-content:space-between; gap:8px; min-height:42px; }
h3 { margin:0; font-size:14px; font-weight:500; line-height:21px; color:var(--text-main); }
header span { color:var(--text-muted); font-size:11px; white-space:nowrap; margin-top:3px; }
.stale header span { color:#ffad66; }
.values { display:grid; grid-template-columns:minmax(0,1fr); align-content:center; flex:1; }
.reading { min-width:0; display:grid; grid-template-columns:minmax(76px,auto) minmax(60px,1fr) auto; align-items:center; column-gap:8px; padding:6px 0; }
.reading + .reading { border-top:1px solid var(--glass-border); }
.reading > span { color:var(--text-muted); font-size:12px; white-space:nowrap; }
.trend { height:42px; min-width:0; }
.reading-value { display:flex; align-items:baseline; gap:6px; }
.reading strong { color:#39a9ff; font-size:23px; font-weight:600; font-variant-numeric:tabular-nums; }
.reading small { color:var(--text-muted); font-size:11px; }
footer { display:flex; justify-content:space-between; gap:8px; padding-top:8px; border-top:1px solid var(--glass-border); color:var(--text-muted); font-size:10px; }
</style>
