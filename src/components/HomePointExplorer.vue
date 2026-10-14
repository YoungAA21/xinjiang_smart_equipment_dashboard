<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import EChart from './EChart.vue'
import { telemetryApi } from '../services/telemetry'
import { api } from '../services/api'
import { localInputTime, numericValue, pointKey, telemetryLine } from '../charts/telemetry'
import { monitoringPointName } from '../charts/equipmentCatalog.js'
import { acousticChannelDisplayName } from '../charts/machineGroups.js'
import { shiftRange } from '../charts/shiftRange.js'

const props = defineProps({ row: Object, buffers: Object, paused: Boolean })
const emit = defineEmits(['close', 'live-change'])
const acoustic = computed(() => props.row.member.source === 'monitor')
const pointIndex = ref(0)
const points = computed(() => props.row.combined
  ? [{ ...props.row.combined.speed, name: props.row.combined.speedName }, { ...props.row.combined.current, name: props.row.combined.currentName }]
  : [props.row.point])
const point = computed(() => points.value[pointIndex.value])
const title = computed(() => acoustic.value ? acousticChannelDisplayName(props.row.member.raw, point.value) : monitoringPointName(point.value))
const initialRange = shiftRange()
const start = ref(initialRange.start)
const end = ref(initialRange.end)
const queryMode = ref('current')
const queryRange = computed(() => ({ start: start.value, end: end.value }))
const live = ref(false)
const loading = ref(false)
const error = ref('')
const history = ref([])
const capped = ref(false)
const chartVersion = ref(0)
const recordings = ref([])
const recordingId = ref('')
const recordingPage = ref(1)
const recordingTotal = ref(0)
const visualization = ref(null)
const recordingDetail = ref(null)
let requestVersion = 0, requestController
const samples = computed(() => live.value ? props.buffers[pointKey(point.value)] || [] : history.value)
const last = computed(() => samples.value.at(-1))
const lastValue = computed(() => numericValue(last.value?.value) === null ? '—' : last.value.value.toFixed(3))
const dateText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'

function invalidate() { requestVersion++; requestController?.abort(); loading.value = false }
function showLive() {
  invalidate()
  live.value = true
  error.value = ''
  capped.value = false
  chartVersion.value++
}
watch(live, value => emit('live-change', value))
watch(pointIndex, () => { invalidate(); history.value = []; query() })
function selectRange(mode) {
  queryMode.value = mode
  if (mode === 'custom') return
  const range = shiftRange(mode)
  start.value = range.start
  end.value = range.end
  query()
}
async function loadRecording(id, version) {
  if (!id) return
  const detail = await api.getRecording(id)
  if (version !== requestVersion) return
  const result = await api.getRecordingVisualization(id, { startMs: 0, waveformPoints: 5000, fftSize: 2048, frequencyBins: 128, waterfallRows: 80 })
  if (version !== requestVersion) return
  recordingDetail.value = detail
  visualization.value = result
}
async function selectRecording() {
  invalidate()
  const version = requestVersion
  visualization.value = null
  recordingDetail.value = null
  error.value = ''
  loading.value = true
  chartVersion.value++
  try { await loadRecording(recordingId.value, version) }
  catch (e) { if (version === requestVersion) error.value = e.message || '录音加载失败' }
  finally { if (version === requestVersion) loading.value = false }
}
async function query(page = 1) {
  const range = queryRange.value
  const from = Date.parse(range.start), to = Date.parse(range.end)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) { error.value = '请选择有效的起止日期'; return }
  invalidate()
  const version = requestVersion
  requestController = new AbortController()
  live.value = false
  loading.value = true
  error.value = ''
  history.value = []
  recordings.value = []
  visualization.value = null
  recordingDetail.value = null
  recordingId.value = ''
  recordingTotal.value = 0
  capped.value = false
  chartVersion.value++
  try {
    if (acoustic.value) {
      const result = await api.getRecordings({ deviceId: props.row.member.id, channelId: point.value.channelId, startTime: localInputTime(from).replace('T', ' '), endTime: localInputTime(to).replace('T', ' '), page, pageSize: 20 })
      if (version !== requestVersion) return
      const rows = result?.row || result?.rows || result?.records || result?.list || []
      if (!Array.isArray(rows)) throw new Error('录音返回格式不正确')
      recordings.value = rows
      recordingPage.value = page
      recordingTotal.value = Number(result?.total || rows.length)
      recordingId.value = rows[0]?.id || ''
      await loadRecording(recordingId.value, version)
    } else {
      const result = await telemetryApi.getHistory({ pointId: point.value.pointId, start: range.start, end: range.end, limit: 100000 }, { signal: requestController.signal })
      if (version !== requestVersion) return
      if (!Array.isArray(result?.points) || (result.pointId != null && Number(result.pointId) !== Number(point.value.pointId))) throw new Error('历史点位返回格式不正确')
      history.value = result.points.filter(sample => {
        const time = Date.parse(sample.collectedAt)
        return Number.isFinite(time) && time >= from && time <= to && (sample.moduleId == null || pointKey(sample) === pointKey(point.value))
      }).sort((a, b) => Date.parse(a.collectedAt) - Date.parse(b.collectedAt))
      capped.value = result.points.length >= 100000
    }
  } catch (e) { if (version === requestVersion) error.value = e.message || '查询失败' }
  finally { if (version === requestVersion) loading.value = false }
}

const option = computed(() => {
  if (!acoustic.value) {
    const value = telemetryLine(samples.value, { ...point.value, name: title.value }, { history: !live.value, color: props.row.color })
    value.graphic = samples.value.length ? [] : [{ type: 'text', left: 'center', top: 'middle', style: { text: loading.value ? '加载中' : '暂无数据', fill: '#C3E2D9', fontSize: 16 } }]
    value.dataZoom[0] = { ...value.dataZoom[0], moveOnMouseMove: true, zoomOnMouseWheel: true }
    return value
  }
  const axis = { axisLabel: { color: '#C3E2D9' }, axisLine: { lineStyle: { color: '#46907C' } } }
  const base = { animation: false, grid: { left: 70, right: 35, top: 35, bottom: 70 }, tooltip: { renderMode: 'richText', confine: true }, dataZoom: [{ type: 'inside', filterMode: 'none' }, { type: 'slider', bottom: 10, height: 24, textStyle: { color: '#C3E2D9' } }] }
  if (live.value) {
    const rows = props.row.soundFrame?.rows || []
    const rate = props.row.soundFrame?.sampleRate || 22000
    const count = rows[0]?.length || 0
    return { ...base,
      xAxis: { ...axis, type: 'category', data: rows.map((_, i) => i + 1), name: '帧' },
      yAxis: { ...axis, type: 'category', data: Array.from({ length: count }, (_, i) => Math.round(i * rate / 2 / Math.max(count - 1, 1))), name: 'Hz' },
      visualMap: { show: false, dimension: 2, min: 0, max: 1, inRange: { color: ['#0b1020', '#1d4ed8', '#00a6a6', '#a8ff7d', '#ff8b1f'] } },
      tooltip: { ...base.tooltip, formatter: item => `帧 ${item.value[0] + 1}\n${Math.round(item.value[1] * rate / 2 / Math.max(count - 1, 1))} Hz\n${Number(item.value[3]).toFixed(3)}` },
      series: [{ type: 'heatmap', progressive: 0, data: rows.flatMap((row, x) => row.map((v, y) => [x, y, v > 1 || v < 0 ? Math.max(0, Math.min(1, (v + 120) / 120)) : v, v])) }],
      graphic: rows.length ? [] : [{ type: 'text', left: 'center', top: 'middle', style: { text: props.row.soundStatus || '暂无数据', fill: '#C3E2D9' } }],
    }
  }
  const data = visualization.value?.waveform || []
  const from = Number(visualization.value?.startMs || 0)
  const to = Number(visualization.value?.endMs ?? recordingDetail.value?.durationMs ?? from)
  return { ...base, tooltip: { ...base.tooltip, trigger: 'axis' },
    xAxis: { ...axis, type: 'value', name: 's' }, yAxis: { ...axis, type: 'value', scale: true },
    series: [{ type: 'line', showSymbol: false, lineStyle: { color: props.row.color, width: 1.5 }, data: data.map((v, i) => [(from + (to - from) * i / Math.max(data.length - 1, 1)) / 1000, v]) }],
    graphic: data.length ? [] : [{ type: 'text', left: 'center', top: 'middle', style: { text: loading.value ? '加载中' : '暂无录音数据', fill: '#C3E2D9', fontSize: 16 } }],
  }
})

const panel = ref(null)
const position = reactive({ x: 0, y: 0 })
let drag, previousFocus
function clampPosition() {
  if (!panel.value) return
  position.x = Math.max(0, Math.min(position.x, window.innerWidth - panel.value.offsetWidth))
  position.y = Math.max(0, Math.min(position.y, window.innerHeight - panel.value.offsetHeight))
}
function dragStart(event) {
  if (event.button !== 0 || event.target.closest('button,select,input')) return
  drag = { x: event.clientX - position.x, y: event.clientY - position.y }
  event.currentTarget.setPointerCapture(event.pointerId)
}
function dragMove(event) {
  if (!drag) return
  position.x = event.clientX - drag.x
  position.y = event.clientY - drag.y
  clampPosition()
}
onMounted(async () => {
  emit('live-change', false)
  query()
  previousFocus = document.activeElement
  await nextTick()
  position.x = (window.innerWidth - panel.value.offsetWidth) / 2
  position.y = (window.innerHeight - panel.value.offsetHeight) / 2
  panel.value.focus()
  window.addEventListener('resize', clampPosition)
})
onBeforeUnmount(() => {
  invalidate()
  window.removeEventListener('resize', clampPosition)
  previousFocus?.focus?.()
})
</script>

<template>
  <Teleport to=".dashboard-shell">
    <section ref="panel" class="point-explorer" role="dialog" aria-modal="false" :aria-label="title" tabindex="-1" :style="{ left: position.x + 'px', top: position.y + 'px' }" @keydown.esc.stop="emit('close')">
      <header class="explorer-heading" @pointerdown="dragStart" @pointermove="dragMove" @pointerup="drag = null" @pointercancel="drag = null" @lostpointercapture="drag = null">
        <h2>{{ title }}</h2>
        <button type="button" aria-label="关闭大图" @click="emit('close')">×</button>
      </header>
      <form class="explorer-controls" @submit.prevent="query()">
        <select v-if="points.length > 1" v-model="pointIndex" aria-label="选择参数"><option v-for="(item, index) in points" :key="item.pointId" :value="index">{{ item.name }}</option></select>
        <div class="shift-buttons" role="group" aria-label="查询班次"><button type="button" :class="{ active: queryMode === 'current' && !live }" :aria-pressed="queryMode === 'current' && !live" @click="selectRange('current')">当班</button><button type="button" :class="{ active: queryMode === 'previous' && !live }" :aria-pressed="queryMode === 'previous' && !live" @click="selectRange('previous')">上一班</button><button type="button" :class="{ active: queryMode === 'custom' && !live }" :aria-pressed="queryMode === 'custom' && !live" @click="selectRange('custom')">自定义</button></div>
        <label>开始<input v-model="start" type="datetime-local" step="1" aria-label="开始日期" required @input="queryMode = 'custom'" /></label>
        <label>结束<input v-model="end" type="datetime-local" step="1" aria-label="结束日期" required @input="queryMode = 'custom'" /></label>
        <button type="submit" :disabled="loading">{{ loading ? '查询中' : '查询' }}</button>
        <button type="button" :class="{ active: live }" @click="showLive">实时</button>
        <button type="button" @click="chartVersion++">重置视图</button>
      </form>
      <div v-if="!acoustic" class="explorer-value"><strong>{{ lastValue }}</strong><span>{{ point.unit }}</span><time>{{ dateText(last?.collectedAt) }}</time><span>{{ live ? paused ? '已暂停' : '实时' : loading ? '加载班次数据' : '历史 · ' + history.length + ' 条' }}</span></div>
      <div v-if="acoustic && !live && recordings.length" class="explorer-recordings">
        <select v-model="recordingId" aria-label="选择录音" :disabled="loading" @change="selectRecording"><option v-for="recording in recordings" :key="recording.id" :value="recording.id">{{ recording.fileName || recording.id }}</option></select>
        <button :disabled="loading || recordingPage <= 1" @click="query(recordingPage - 1)">上一页</button><span>{{ recordingPage }} / {{ Math.ceil(recordingTotal / 20) }}</span><button :disabled="loading || recordingPage * 20 >= recordingTotal" @click="query(recordingPage + 1)">下一页</button>
      </div>
      <p v-if="error" class="explorer-error" role="alert">{{ error }}</p>
      <p v-if="capped" class="explorer-error">已达 100000 条上限，请缩短日期范围</p>
      <div class="explorer-chart" role="img" :aria-label="title + '数据图表'"><EChart :key="chartVersion" :option="option" preserve-zoom /></div>
    </section>
  </Teleport>
</template>

<style scoped>
.point-explorer { position:fixed; z-index:2000; width:min(1240px,94vw); height:min(780px,88vh); display:flex; flex-direction:column; min-width:0; padding:0 20px 16px; border:1px solid var(--control-border-active); border-radius:10px; background:var(--page-bg); color:var(--text-main); box-shadow:0 18px 70px #0008; outline:none; }
.explorer-heading { display:flex; align-items:center; justify-content:space-between; min-height:56px; cursor:move; touch-action:none; user-select:none; border-bottom:1px solid var(--glass-border); }
h2 { margin:0; font-size:19px; font-weight:600; }
button,input,select { color:var(--text-main); background:var(--glass-card); border:1px solid var(--glass-border); border-radius:5px; padding:8px 12px; font:inherit; }
button { cursor:pointer; } button:disabled { opacity:.5; cursor:default; } button:hover,button.active { border-color:#368ce8; } button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid #368ce8; outline-offset:2px; }
.explorer-heading button { border:0; background:transparent; font-size:28px; padding:0 12px; }
.explorer-controls,.explorer-recordings { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:14px 0; font-size:14px; }
.shift-buttons { display:flex; gap:5px; }.shift-buttons button.active { background:color-mix(in srgb,#368ce8 15%,var(--glass-card)); }
label { display:flex; align-items:center; gap:8px; } input { color-scheme:dark; } :global(.light-theme) input { color-scheme:light; }
.explorer-value { display:flex; align-items:baseline; gap:12px; } .explorer-value strong { color:#368ce8; font-size:30px; } .explorer-value time { margin-left:auto; }
.explorer-chart { flex:1; min-height:0; margin-top:12px; } .explorer-chart :deep(.echart) { height:100%; width:100%; }
.explorer-error { color:#e29a3f; margin:8px 0 0; } .explorer-recordings select { max-width:60%; }
@media(max-width:700px) { .point-explorer { padding:0 10px 10px; height:94vh; } h2 { font-size:16px; } .explorer-controls { gap:6px; padding:8px 0; } .explorer-value { flex-wrap:wrap; } }
</style>
