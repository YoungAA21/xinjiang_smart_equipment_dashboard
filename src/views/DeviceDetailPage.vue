<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Activity, Database, Fan, RefreshCcw, Search, Server } from 'lucide-vue-next'
import EChart from '../components/EChart.vue'
import MonitorDeviceDetails from '../components/MonitorDeviceDetails.vue'
import TelemetryHistoryList from '../components/TelemetryHistoryList.vue'
import { api } from '../services/api'
import { useTelemetryStore } from '../stores/telemetry'
import { localInputTime, numericValue, pointKey, telemetryLine } from '../charts/telemetry'

const telemetry = useTelemetryStore()
const monitorDevices = ref(null)
const monitorError = ref('')
const monitorTime = ref(null)
const loadingMonitor = ref(false)
const source = ref('all')
const selectedKey = ref('')
const selectedPointId = ref(null)
const autoLive = ref(true)
const chartMode = ref('live')
const clock = ref(Date.now())
const historyStart = ref(localInputTime(Date.now() - 10 * 60 * 1000))
const historyEnd = ref(localInputTime(Date.now()))
const historyLimit = ref(5000)
const pageController = new AbortController()
let pointController, historyController, pollTimer, metadataTimer
const entries = computed(() => [
  ...(telemetry.modules || []).map((module) => ({ key: JSON.stringify(['legacy', module.moduleId]), source: 'legacy', name: module.moduleName || module.moduleId, id: module.moduleId, online: module.runtimeStatus?.isOnline, raw: module })),
  ...(monitorDevices.value || []).map((device) => ({ key: JSON.stringify(['monitor', device.deviceId]), source: 'monitor', name: device.deviceName || device.deviceId, id: device.deviceId, online: device.online, raw: device })),
])
const visibleEntries = computed(() => entries.value.filter((entry) => source.value === 'all' || entry.source === source.value))
const selected = computed(() => visibleEntries.value.find((entry) => entry.key === selectedKey.value) || visibleEntries.value[0] || null)
const isLegacy = computed(() => selected.value?.source === 'legacy')
const points = computed(() => isLegacy.value && telemetry.pointModuleId === selected.value.id ? telemetry.points : [])
const selectedPoint = computed(() => points.value.find((point) => point.pointId === selectedPointId.value) || points.value[0] || null)
const selectedSamples = computed(() => selectedPoint.value ? telemetry.buffers[pointKey(selectedPoint.value)] || [] : [])
const latestSample = computed(() => selectedPoint.value ? telemetry.latest.find((sample) => pointKey(sample) === pointKey(selectedPoint.value)) : null)
const stale = computed(() => latestSample.value && clock.value - Date.parse(latestSample.value.collectedAt) > 10000)
const liveOption = computed(() => telemetryLine(selectedSamples.value, selectedPoint.value))
const historyValues = computed(() => (telemetry.history?.points || []).map((sample) => numericValue(sample.value)).filter((value) => value !== null))
const historyMin = computed(() => historyValues.value.length ? historyValues.value.reduce((a, b) => Math.min(a, b)) : null)
const historyMax = computed(() => historyValues.value.length ? historyValues.value.reduce((a, b) => Math.max(a, b)) : null)
const refreshing = computed(() => telemetry.loadingModules || loadingMonitor.value || telemetry.loadingPoints)
const status = (online) => online === true ? '在线' : online === false ? '离线' : '未知'
const tone = (online) => online === true ? 'good' : online === false ? 'warn' : 'muted'
const dateTime = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const numberText = (value) => numericValue(value) === null ? '—' : value.toFixed(3)
const pointLatest = (point) => telemetry.latest.find((sample) => pointKey(sample) === pointKey(point))

async function loadMonitorDevices() {
  if (loadingMonitor.value || pageController.signal.aborted) return
  loadingMonitor.value = true
  try {
    const devices = await api.getMonitorDevices({ signal: AbortSignal.any([pageController.signal, AbortSignal.timeout(10000)]) })
    if (pageController.signal.aborted) return
    if (!Array.isArray(devices)) throw new Error('设备接口返回格式不正确')
    monitorDevices.value = devices
    monitorTime.value = new Date().toISOString()
    monitorError.value = ''
  } catch (error) {
    if (!pageController.signal.aborted) monitorError.value = error.name === 'TimeoutError' ? '设备请求超时（10 秒）' : error.message || '设备请求失败'
  } finally { loadingMonitor.value = false }
}
async function loadPoints() {
  pointController?.abort()
  historyController?.abort()
  telemetry.clearHistory()
  selectedPointId.value = null
  if (!isLegacy.value) return
  pointController = new AbortController()
  await telemetry.loadPoints(selected.value.id, { signal: AbortSignal.any([pageController.signal, pointController.signal]) })
}
async function refreshAll() {
  const previousKey = selected.value?.key
  await Promise.all([telemetry.refreshModules({ signal: pageController.signal }), loadMonitorDevices()])
  if (pageController.signal.aborted) return
  if (selected.value?.key === previousKey && isLegacy.value) await loadPoints()
  if (isLegacy.value) await telemetry.refreshLatest({ signal: pageController.signal })
}
function queryHistory() {
  if (!isLegacy.value || !selectedPoint.value || pageController.signal.aborted) return
  historyController?.abort()
  historyController = new AbortController()
  return telemetry.loadHistory({ pointId: selectedPoint.value.pointId, start: historyStart.value, end: historyEnd.value, limit: historyLimit.value }, { signal: AbortSignal.any([pageController.signal, historyController.signal]) })
}
function recentRange(minutes) {
  const now = Date.now()
  historyEnd.value = localInputTime(now)
  historyStart.value = localInputTime(now - minutes * 60 * 1000)
}
watch(() => selected.value?.key, async () => {
  chartMode.value = 'live'
  await loadPoints()
  if (isLegacy.value && !pageController.signal.aborted) await telemetry.refreshLatest({ signal: pageController.signal })
})
watch([chartMode, () => selectedPoint.value?.pointId], ([mode, pointId]) => {
  historyController?.abort()
  telemetry.clearHistory()
  if (mode === 'history' && pointId != null) {
    recentRange(10)
    queryHistory()
  }
})
watch(autoLive, (enabled) => { if (enabled && isLegacy.value) telemetry.refreshLatest({ signal: pageController.signal }) })
onMounted(() => {
  refreshAll()
  pollTimer = window.setInterval(() => {
    clock.value = Date.now()
    if (autoLive.value && isLegacy.value) telemetry.refreshLatest({ signal: pageController.signal })
  }, 2000)
  metadataTimer = window.setInterval(() => telemetry.refreshModules({ signal: pageController.signal }), 15000)
})
onBeforeUnmount(() => {
  pageController.abort()
  pointController?.abort()
  historyController?.abort()
  window.clearInterval(pollTimer)
  window.clearInterval(metadataTimer)
  telemetry.clear()
})
</script>

<template>
  <section class="page unified-monitor">
    <header class="device-toolbar content-page-header"><div><h1 class="content-page-title">设备监控 <small>采集模块 / 声纹设备</small></h1></div><el-button :icon="RefreshCcw" :loading="refreshing" @click="refreshAll">刷新设备</el-button></header>
    <div class="source-summary"><span :class="telemetry.errors.modules ? 'warn' : ''">采集模块 · {{ telemetry.modules?.length ?? '—' }} 个 · {{ dateTime(telemetry.moduleTime) }}</span><span :class="monitorError ? 'warn' : ''">声纹设备 · {{ monitorDevices?.length ?? '—' }} 台 · {{ dateTime(monitorTime) }}</span></div>
    <div v-if="telemetry.errors.modules" class="monitor-error" role="alert">采集模块获取失败：{{ telemetry.errors.modules }}。{{ telemetry.modules ? '当前保留上次模块列表。' : '声纹设备仍可使用。' }}</div>
    <div v-if="monitorError" class="monitor-error" role="alert">声纹设备获取失败：{{ monitorError }}。{{ monitorDevices ? '当前保留上次设备列表。' : '采集模块仍可使用。' }}</div>

    <div class="device-workspace">
      <aside class="device-directory">
        <div class="source-filter" role="group" aria-label="设备来源"><button :class="{active: source === 'all'}" :aria-pressed="source === 'all'" @click="source = 'all'">全部</button><button :class="{active: source === 'legacy'}" :aria-pressed="source === 'legacy'" @click="source = 'legacy'">采集模块</button><button :class="{active: source === 'monitor'}" :aria-pressed="source === 'monitor'" @click="source = 'monitor'">声纹设备</button></div>
        <div class="device-list"><button v-for="entry in visibleEntries" :key="entry.key" class="device-entry" :class="{selected: selected?.key === entry.key}" :aria-pressed="selected?.key === entry.key" :aria-label="(entry.source === 'legacy' ? '采集模块 ' : '声纹设备 ')+entry.id+' '+entry.name" @click="selectedKey = entry.key"><div><component :is="entry.source === 'legacy' ? Server : Fan" :size="17" /><strong>{{ entry.name }}</strong><i :class="tone(entry.online)">{{ status(entry.online) }}</i></div><p>{{ entry.id }}</p><small>{{ entry.source === 'legacy' ? '采集模块 · '+entry.raw.protocol : '声纹设备 · '+(entry.raw.collectors?.length || 0)+' 网关 / '+(entry.raw.channels?.length || 0)+' 通道' }}</small></button><p v-if="!visibleEntries.length" class="empty-copy">当前来源暂无设备数据</p></div>
      </aside>

      <main class="device-detail">
        <div v-if="!selected" class="device-empty"><Server :size="38" /><p>选择设备或等待接口返回</p></div>
        <template v-else>
          <header class="selection-summary"><div><h2>{{ selected.name }} <span :class="tone(selected.online)">{{ status(selected.online) }}</span></h2><p>{{ selected.id }} · {{ isLegacy ? selected.raw.protocol || '采集模块' : '声纹设备' }}</p></div><span class="source-tag">{{ isLegacy ? '采集模块' : '声纹设备' }}</span></header>

          <template v-if="isLegacy">
            <div v-if="selected.raw.runtimeStatus?.offlineReason" class="monitor-error">{{ selected.raw.runtimeStatus.offlineReason }}</div>
            <div v-if="telemetry.errors.points" class="monitor-error" role="alert">点位获取失败：{{ telemetry.errors.points }} <button @click="loadPoints">重试点位</button></div>
            <div v-if="telemetry.loadingPoints" class="empty-copy">正在获取点位与 pointId…</div>
            <div v-else-if="!points.length" class="empty-copy">该模块暂无可查询点位；未生成模拟采样。</div>
            <template v-else>
              <div class="point-selector"><label>监测点位 <el-select v-model="selectedPointId" :placeholder="selectedPoint?.name || '选择点位'" filterable aria-label="监测点位"><el-option v-for="point in points" :key="point.pointId" :value="point.pointId" :label="point.name+' / '+point.channelId+' / '+point.pointCode+' · #'+point.pointId" /></el-select></label><span>pointId <b>{{ selectedPoint?.pointId }}</b> · {{ selectedPoint?.unit || '无单位' }}</span></div>
              <div class="point-cards"><button v-for="point in points" :key="point.pointId" :class="{active: selectedPoint?.pointId === point.pointId}" @click="selectedPointId = point.pointId"><span>{{ point.name || point.pointCode }}</span><strong>{{ numberText(pointLatest(point)?.value) }}<small>{{ point.unit }}</small></strong><small>#{{ point.pointId }} · {{ point.pointCode }}</small></button></div>
              <article class="telemetry-panel">
                <header class="chart-toolbar"><div class="mode-tabs" role="group" aria-label="数据模式"><button :class="{active: chartMode === 'live'}" :aria-pressed="chartMode === 'live'" @click="chartMode = 'live'"><Activity :size="14" />实时折线</button><button :class="{active: chartMode === 'history'}" :aria-pressed="chartMode === 'history'" @click="chartMode = 'history'"><Database :size="14" />历史原始数据</button></div><label><el-switch v-model="autoLive" aria-label="实时自动刷新" /><span>每 2 秒采样</span></label></header>
                <template v-if="chartMode === 'live'">
                  <div v-if="telemetry.errors.latest" class="monitor-error" role="alert">实时更新失败：{{ telemetry.errors.latest }}。折线保留上次数据。</div>
                  <div class="sample-summary"><strong>{{ numberText(latestSample?.value) }} <small>{{ selectedPoint?.unit }}</small></strong><span>{{ dateTime(latestSample?.collectedAt) }} · 质量 {{ latestSample?.quality ?? '—' }}</span><b v-if="stale" class="warn">超过 10 秒未更新</b><b v-if="!autoLive" class="warn">刷新已暂停</b></div>
                  <div class="telemetry-chart" role="img" :aria-label="selectedPoint.name+'实时折线，'+selectedSamples.length+'个已采集样本'"><EChart :option="liveOption" /></div>
                  <p class="chart-note">{{ selectedSamples.length }} / 300 个时间点 · 仅积累本次页面访问的真实采样，不重复补点；间隔超过 15 秒断线。暂停刷新后可缩放查看。</p>
                </template>
                <template v-else>
                  <form class="history-form" @submit.prevent="queryHistory"><label>开始时间<input v-model="historyStart" type="datetime-local" step="1" aria-label="开始时间" required /></label><label>结束时间<input v-model="historyEnd" type="datetime-local" step="1" aria-label="结束时间" required /></label><label>最多条数<input v-model.number="historyLimit" type="number" min="1" max="100000" step="1" aria-label="最多条数" required /></label><el-button native-type="submit" :icon="Search" :loading="telemetry.loadingHistory">查询历史</el-button></form>
                  <div class="quick-range"><button @click="recentRange(10)">最近 10 分钟</button><button @click="recentRange(60)">最近 1 小时</button><span>本地时间 · 起始包含，结束不包含</span></div>
                  <div v-if="telemetry.errors.history" class="monitor-error" role="alert">{{ telemetry.errors.history }}</div>
                  <div v-if="telemetry.history" class="history-summary"><span>{{ telemetry.history.points.length }} 条 · 最小 {{ numberText(historyMin) }} / 最大 {{ numberText(historyMax) }} {{ selectedPoint.unit }}</span><small>已查询 #{{ telemetry.history.requested.pointId }} · {{ dateTime(telemetry.history.requested.start) }} → {{ dateTime(telemetry.history.requested.end) }}</small></div>
                  <p v-if="telemetry.loadingHistory" class="empty-copy" role="status">正在查询历史数据…</p>
                  <p v-if="telemetry.history?.points.length >= telemetry.history?.requested.limit" class="monitor-error">结果已达到查询上限，可能未覆盖完整区间。请缩短时间范围或提高上限。</p>
                  <p class="chart-note">默认查询当前时间之前 10 分钟的历史记录，可调整时间范围后重新查询。</p>
                  <TelemetryHistoryList v-if="telemetry.history" :samples="telemetry.history.points" :point="selectedPoint" />
                </template>
              </article>
            </template>
          </template>
          <template v-else><p class="external-note">声纹网关与通道信息。声纹实时波形继续在“频谱分析”使用，不自动创建监听会话。</p><MonitorDeviceDetails :device="selected.raw" /></template>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
.unified-monitor { display: flex; flex-direction: column; padding: 16px; overflow-y: auto; color: var(--text-main); background: var(--page-bg); gap: 12px; --accent: #50d8cb; --warning: #ffad66; scrollbar-width: thin; }
.device-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 20px; }.device-toolbar h1 small { color: var(--text-muted); font-size: 11px; font-weight: 400; margin-left: 10px; }
.source-summary { display: flex; gap: 24px; font-size: 10px; color: var(--text-muted); }.monitor-error { color: var(--warning); font-size: 11px; padding: 10px 12px; border: 1px solid #ffad6635; border-radius: 5px; background: #ffad6608; line-height: 1.6; overflow-wrap: anywhere; }.monitor-error button { border: 0; background: none; color: inherit; text-decoration: underline; }
.device-workspace { display: grid; grid-template-columns: 240px minmax(0,1fr); gap: 14px; flex: 1; min-height: 560px; }.device-directory { border: 1px solid var(--glass-border); background: var(--glass-card); border-radius: 8px; padding: 10px; align-self: start; position: sticky; top: 0; }.source-filter { display: flex; gap: 4px; padding-bottom: 10px; }.source-filter button { flex: 1; background: transparent; color: var(--text-muted); border: 1px solid transparent; border-radius: 4px; padding: 6px; font-size: 10px; }.source-filter button.active { color: var(--accent); background: #50d8cb14; border-color: #50d8cb25; }
.device-list { display: grid; gap: 7px; max-height: 580px; overflow-y: auto; scrollbar-width: thin; }.device-entry { text-align: left; width: 100%; padding: 12px 10px; border: 1px solid var(--glass-border); border-radius: 6px; background: transparent; color: var(--text-main); }.device-entry.selected { border-color: #50d8cb80; background: #50d8cb0b; }.device-entry > div { display: flex; align-items: center; gap: 7px; }.device-entry strong { font-size: 11px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.device-entry i { margin-left: auto; font-size: 9px; white-space: nowrap; font-style: normal; }.device-entry svg { color: var(--accent); flex-shrink: 0; }.device-entry p { margin: 7px 0 4px; color: var(--text-soft); font-size: 10px; overflow-wrap: anywhere; }.device-entry small { font-size: 9px; color: var(--text-muted); }
.device-detail { min-width: 0; display: flex; flex-direction: column; gap: 12px; }.selection-summary { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--glass-card); }.selection-summary h2 { font-size: 15px; margin: 0 0 7px; }.selection-summary h2 span { margin-left: 12px; font-size: 10px; font-weight: 400; }.selection-summary p { margin: 0; font-size: 10px; color: var(--text-muted); }.source-tag { color: var(--accent); border: 1px solid #50d8cb30; padding: 5px 8px; font-size: 10px; border-radius: 5px; }
.point-selector { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 11px; }.point-selector label { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }.point-selector :deep(.el-select) { max-width: 540px; flex: 1; }.point-selector > span { color: var(--text-muted); font-size: 10px; white-space: nowrap; }.point-cards { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 8px; max-height: 220px; overflow-y: auto; }.point-cards button { text-align: left; border: 1px solid var(--glass-border); border-radius: 6px; padding: 11px; background: var(--glass-card); color: var(--text-main); min-width: 0; }.point-cards button.active { border-color: #50d8cb80; }.point-cards button > span { display: block; font-size: 10px; }.point-cards strong { display: block; color: var(--accent); font-size: 22px; font-weight: 500; margin: 7px 0; }.point-cards small { color: var(--text-muted); font-size: 9px; overflow-wrap: anywhere; }.point-cards strong small { margin-left: 5px; }
.telemetry-panel { border: 1px solid var(--glass-border); border-radius: 8px; background: var(--glass-card); min-width: 0; padding: 0 14px; }.chart-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--glass-border); min-height: 47px; }.mode-tabs { display: flex; gap: 12px; }.mode-tabs button { display: flex; align-items: center; gap: 6px; font-size: 11px; border: 0; background: none; color: var(--text-muted); padding: 8px 0; }.mode-tabs button.active { color: var(--accent); }.chart-toolbar label { display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer; white-space: nowrap; }
.sample-summary { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-top: 15px; }.sample-summary > strong { font-size: 27px; color: var(--accent); font-weight: 500; }.sample-summary small { font-size: 12px; }.sample-summary > span, .sample-summary > b { font-size: 10px; color: var(--text-muted); }.telemetry-chart { height: 330px; }.chart-note { color: var(--text-muted); font-size: 10px; line-height: 1.8; margin: 6px 0 14px; }
.history-form { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) 95px auto; gap: 10px; align-items: end; margin: 15px 0 10px; }.history-form label { display: grid; gap: 6px; font-size: 10px; color: var(--text-muted); min-width: 0; }.history-form input { background: var(--surface); color: var(--text-main); border: 1px solid var(--glass-border); border-radius: 4px; height: 32px; min-width: 0; width: 100%; font: inherit; padding: 3px 6px; color-scheme: dark; }.quick-range { display: flex; align-items: center; gap: 12px; }.quick-range button { font-size: 10px; border: 0; background: transparent; color: var(--accent); padding: 4px 0; }.quick-range span { font-size: 9px; color: var(--text-muted); margin-left: auto; }.history-summary { display: grid; gap: 6px; margin-top: 13px; font-size: 11px; color: var(--text-soft); }.history-summary small { color: var(--text-muted); font-size: 10px; }
.empty-copy, .external-note { color: var(--text-muted); font-size: 11px; line-height: 1.7; }.device-empty { display: grid; place-content: center; justify-items: center; min-height: 400px; color: var(--text-muted); font-size: 12px; }.unified-monitor .good { color: #8ee6a8; }.unified-monitor .warn { color: var(--warning); }.unified-monitor .muted { color: var(--text-muted); }
:global(.light-theme .unified-monitor) { --accent: #237f76; --warning: #b65015; }:global(.light-theme .unified-monitor .good) { color: #287452; }:global(.light-theme .unified-monitor input) { color-scheme: light; }
@media (max-width:1300px) { .device-workspace { grid-template-columns: 205px minmax(0,1fr); }.unified-monitor { padding: 12px; }.history-form { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }.point-selector { flex-wrap: wrap; }.point-selector label { flex-basis: 100%; }.device-toolbar h1 small { display: block; margin: 6px 0 0; } }
</style>
