<script setup>
import ConfigurableDashboard from '../components/ConfigurableDashboard.vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import TrendPage from './TrendPage.vue'
import SpectrumPage from './SpectrumPage.vue'
import { Database, Fan, RefreshCcw, Search, Server } from 'lucide-vue-next'
import EChart from '../components/EChart.vue'
import EquipmentVisual from '../components/EquipmentVisual.vue'
import MonitorDeviceDetails from '../components/MonitorDeviceDetails.vue'
import TelemetryHistoryList from '../components/TelemetryHistoryList.vue'
import { api } from '../services/api'
import { useTelemetryStore } from '../stores/telemetry'
import { localInputTime, numericValue, pointKey, telemetryLine } from '../charts/telemetry'
import { isVibrationPoint, configuredMonitoringPoints, discoveredMonitoringModules, moduleDisplayName, monitoringPointName, sortMonitoringModules, sortMonitoringPoints } from '../charts/equipmentCatalog.js'
import { acousticChannelDisplayName, presentAcousticChannels } from '../charts/machineGroups.js'
import { monitoringLocations } from '../charts/monitoringLocations.js'

const props = defineProps({ embedded: Boolean, detailContext: Object })
const emit = defineEmits(['close'])
const routerRoute = useRoute()
const route = { get query() { return props.detailContext || routerRoute.query } }
const telemetry = useTelemetryStore()
const monitorDevices = ref(null)
const monitorError = ref('')
const monitorTime = ref(null)
const loadingMonitor = ref(false)
const source = ref(['legacy', 'monitor'].includes(route.query.source) ? route.query.source : 'all')
const selectedKey = ref(route.query.device ? JSON.stringify([route.query.source, route.query.device]) : '')
const showingDetail = computed(() => Boolean(route.query.device))
const selectedPointId = ref(null)
const autoLive = ref(true)
const chartMode = ref(['live', 'trend', 'spectrum', 'history', 'info'].includes(route.query.tab) ? route.query.tab : 'live')
const selectedChannelId = ref(route.query.channelId || '')
const allDetailTabs = [
  { id: 'live', label: '实时监测' },
  { id: 'trend', label: '趋势分析' },
  { id: 'spectrum', label: '频谱分析' },
  { id: 'history', label: '数据列表' },
  { id: 'info', label: '设备信息' },
]
const channels = computed(() => !isLegacy.value ? (selected.value ? presentAcousticChannels(selected.value.raw) : []).filter(channel => !props.embedded || !route.query.channelId || channel.channelId === route.query.channelId) : [])
const selectedChannel = computed(() => channels.value.find((channel) => channel.channelId === selectedChannelId.value) || channels.value.find((channel) => channel.online) || channels.value[0] || null)
const clock = ref(Date.now())
const historyStart = ref(localInputTime(Date.now() - 10 * 60 * 1000))
const historyEnd = ref(localInputTime(Date.now()))
const historyLimit = ref(5000)
const pageController = new AbortController()
let pointController, historyController, pollTimer, metadataTimer
const entries = computed(() => [
  ...sortMonitoringModules(discoveredMonitoringModules(telemetry.modules || [], telemetry.latest || [])).map((module) => ({ key: JSON.stringify(['legacy', module.moduleId]), source: 'legacy', name: moduleDisplayName(module), id: module.moduleId, online: module.runtimeStatus?.isOnline, raw: module })),
  ...(monitorDevices.value || []).map((device) => ({ key: JSON.stringify(['monitor', device.deviceId]), source: 'monitor', name: device.deviceName || device.deviceId, id: device.deviceId, online: device.online, raw: device })),
])
const deviceSearch = ref('')
const statusFilter = ref('all')
const deviceStats = computed(() => ({
  total: entries.value.length,
  online: entries.value.filter(entry => entry.online === true).length,
  offline: entries.value.filter(entry => entry.online === false).length,
  unknown: entries.value.filter(entry => entry.online !== true && entry.online !== false).length,
}))
const visibleEntries = computed(() => entries.value.filter(entry => {
  const keyword = deviceSearch.value.trim().toLocaleLowerCase()
  return (source.value === 'all' || entry.source === source.value)
    && (statusFilter.value === 'all' || (statusFilter.value === 'online' ? entry.online === true : statusFilter.value === 'offline' ? entry.online === false : entry.online !== true && entry.online !== false))
    && (!keyword || `${entry.name} ${entry.id}`.toLocaleLowerCase().includes(keyword))
}))
const entryPointCount = entry => entry.source === 'monitor' ? entry.raw.channels?.length ?? '—' : entry.raw.pointCount ?? '—'
function resetDeviceFilters() { deviceSearch.value = ''; statusFilter.value = 'all'; source.value = 'all' }
const selected = computed(() => entries.value.find((entry) => entry.key === selectedKey.value) || null)
const profileLocation = computed(() => monitoringLocations.find(item => item.id === route.query.location))
const profileName = computed(() => profileLocation.value ? `${profileLocation.value.machine} · ${profileLocation.value.name}` : selected.value?.name || '')
const profileImage = computed(() => {
  if (selected.value?.source === 'legacy' && selected.value.id === 'PRESS01') return '/equipment/zb25-pressure.png'
  if (selected.value?.source === 'legacy' && selected.value.id === 'PRESS02') return '/equipment/spider-pressure.png'
  if (selected.value?.source === 'legacy' && selected.value.id === 'PRESS03') return '/equipment/yb55-pressure.png'
  return ({
    ve: '/equipment/ve-fan.png',
    max: '/equipment/max-fan.png',
    'spider-pressure': '/equipment/spider-pressure.png',
    'main-motor': '/equipment/main-motor.png',
    cutter: '/equipment/aluminum-paper-cutter.jpg',
    seal: '/equipment/sealing-component.jpg',
    'aux-motor': '/equipment/auxiliary-main-motor.png',
    'paper-wheel': '/equipment/gearbox.png',
  })[profileLocation.value?.id] || ''
})
const isLegacy = computed(() => selected.value?.source === 'legacy')
const detailTabs = computed(() => allDetailTabs.filter(tab => {
  const deviceSource = selected.value?.source || route.query.source
  return tab.id !== (deviceSource === 'monitor' ? 'trend' : 'spectrum')
    && !(deviceSource === 'monitor' && tab.id === 'history')
})
  .map(tab => props.embedded && tab.id === 'history' ? { ...tab, label: '历史数据' } : tab))
const availableTab = (tab, deviceSource) => allDetailTabs.some(item => item.id === tab)
  && tab !== (deviceSource === 'monitor' ? 'trend' : 'spectrum')
  && !(deviceSource === 'monitor' && tab === 'history') ? tab : 'live'
watch([chartMode, detailTabs], () => {
  if (!detailTabs.value.some(tab => tab.id === chartMode.value)) chartMode.value = 'live'
}, { immediate: true })
const points = computed(() => isLegacy.value && telemetry.pointModuleId === selected.value.id
  ? configuredMonitoringPoints(telemetry.points, telemetry.latest, selected.value.id).filter(point => !props.embedded || !route.query.pointId || point.pointId === Number(route.query.pointId)).map(point => ({ ...point, name: monitoringPointName(point) })) : [])
const selectedPoint = computed(() => points.value.find((point) => point.pointId === selectedPointId.value) || points.value[0] || null)
const pointPalette = ['#39a9ff', '#ff9800', '#00c875']
const pointColors = new Map()
function pointColor(key) {
  if (!pointColors.has(key)) pointColors.set(key, pointPalette[pointColors.size % pointPalette.length])
  return pointColors.get(key)
}
const pointCards = computed(() => points.value.map((point) => {
  const samples = telemetry.buffers[pointKey(point)] || []
  const latest = pointLatest(point)
  const color = pointColor(pointKey(point))
  const option = telemetryLine(samples, point, { color })
  option.grid = { left: 52, right: 12, top: 24, bottom: 28 }
  option.dataZoom = []
  option.series[0].lineStyle.width = 1.5
  option.series[0].areaStyle.opacity = 0.45
  option.xAxis.splitNumber = 3
  option.yAxis.splitNumber = 3
  return { point, latest, option, color, count: samples.length, stale: latest && clock.value - Date.parse(latest.collectedAt) > 10000 }
}))
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
async function loadPoints(preferredPointId = Number(route.query.pointId) || null) {
  pointController?.abort()
  historyController?.abort()
  telemetry.clearHistory()
  selectedPointId.value = null
  if (!isLegacy.value) return
  pointController = new AbortController()
  const controller = pointController
  await telemetry.loadPoints(selected.value.id, { signal: AbortSignal.any([pageController.signal, controller.signal]) })
  if (!pageController.signal.aborted && !controller.signal.aborted) selectedPointId.value = points.value.find((point) => point.pointId === preferredPointId)?.pointId ?? points.value[0]?.pointId ?? null
}
async function refreshAll() {
  const previousKey = selected.value?.key
  await Promise.all([telemetry.refreshModules({ signal: pageController.signal }), loadMonitorDevices()])
  if (pageController.signal.aborted) return
  if (selected.value?.key === previousKey && isLegacy.value) await loadPoints(selectedPoint.value?.pointId)
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
watch(() => selected.value?.key, async (key, previousKey) => {
  // A metadata refresh can temporarily remove the selected device while the
  // device list is being replaced. Keep the active tab in embedded point detail.
  if (previousKey && key && !props.embedded) chartMode.value = 'live'
  selectedChannelId.value = channels.value.find(channel => channel.channelId === route.query.channelId)?.channelId || channels.value.find((channel) => channel.online)?.channelId || channels.value[0]?.channelId || ''
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
// Embedded point details receive a freshly computed context whenever the
// parent refreshes its rows. That context's initial tab is always "live" and
// must not overwrite a tab the user has selected inside the dialog.
watch(() => props.embedded ? null : routerRoute.query, async (query) => {
  if (!query) return
  selectedKey.value = query.device ? JSON.stringify([query.source, query.device]) : ''
  source.value = ['legacy', 'monitor'].includes(query.source) ? query.source : 'all'
  if (!['live', 'trend', 'spectrum', 'history', 'info'].includes(query.tab)) return
  await nextTick()
  const requestedPoint = points.value.find(point => point.pointId === Number(query.pointId))
  if (requestedPoint) selectedPointId.value = requestedPoint.pointId
  const requestedChannel = channels.value.find(channel => channel.channelId === query.channelId)
  if (requestedChannel) selectedChannelId.value = requestedChannel.channelId
  chartMode.value = availableTab(query.tab, selected.value?.source || query.source)
})
watch(autoLive, (enabled) => { if (enabled && isLegacy.value) telemetry.refreshLatest({ signal: pageController.signal }) })
onMounted(() => {
  refreshAll()
  pollTimer = window.setInterval(() => {
    clock.value = Date.now()
    if (autoLive.value && isLegacy.value && chartMode.value === 'live') telemetry.refreshLatest({ signal: pageController.signal })
  }, 2000)
  metadataTimer = window.setInterval(() => { telemetry.refreshModules({ signal: pageController.signal }); loadMonitorDevices() }, 15000)
})
onBeforeUnmount(() => {
  pageController.abort()
  pointController?.abort()
  historyController?.abort()
  window.clearInterval(pollTimer)
  window.clearInterval(metadataTimer)
  if (!props.embedded) telemetry.clear()
  else telemetry.clearHistory()
})
</script>

<template>
  <section class="page unified-monitor" :class="{ 'equipment-directory-page': !showingDetail, 'embedded-detail': embedded }">
    <header v-if="!embedded" class="device-toolbar content-page-header"><div><h1 class="content-page-title">测点详情 </h1></div><el-button :icon="RefreshCcw" :loading="refreshing" @click="refreshAll">刷新设备</el-button></header>
    <div v-if="showingDetail && !embedded" class="source-summary"><span :class="telemetry.errors.modules ? 'warn' : ''">采集模块 · {{ telemetry.modules?.length ?? '—' }} 个 · {{ dateTime(telemetry.moduleTime) }}</span><span :class="monitorError ? 'warn' : ''">声纹设备 · {{ monitorDevices?.length ?? '—' }} 台 · {{ dateTime(monitorTime) }}</span></div>
    <div v-if="telemetry.errors.modules" class="monitor-error" role="alert">采集模块获取失败：{{ telemetry.errors.modules }}</div>
    <div v-if="monitorError" class="monitor-error" role="alert">声纹设备获取失败：{{ monitorError }}</div>
    <div class="device-workspace" :class="{ 'directory-view': !showingDetail }">
      <section v-if="!showingDetail" class="equipment-directory">
        <header class="fleet-overview">
          <div class="fleet-intro"><h2>设备运行总览</h2><span class="fleet-sync">{{ refreshing ? '正在同步设备状态…' : '最近同步 · ' + dateTime(telemetry.moduleTime || monitorTime) }}</span></div>
          <div class="fleet-stats" aria-label="设备状态概览">
            <button v-for="item in [{id: 'all', label: '全部设备', value: deviceStats.total}, {id: 'online', label: '在线设备', value: deviceStats.online}, {id: 'offline', label: '离线设备', value: deviceStats.offline}, {id: 'unknown', label: '状态未知', value: deviceStats.unknown}]" :key="item.id" :class="[item.id, {active: statusFilter === item.id}]" :aria-pressed="statusFilter === item.id" @click="statusFilter = item.id"><span>{{ item.label }}</span><strong>{{ telemetry.modules === null && monitorDevices === null ? '—' : item.value }}<small>台</small></strong></button>
          </div>
        </header>
        <div class="fleet-controls">
          <div class="fleet-source-tabs" role="group" aria-label="设备来源"><button :class="{active: source === 'all'}" :aria-pressed="source === 'all'" @click="source = 'all'">全部设备 <span>{{ entries.length }}</span></button><button :class="{active: source === 'legacy'}" :aria-pressed="source === 'legacy'" @click="source = 'legacy'">采集模块 <span>{{ telemetry.modules?.length ?? '—' }}</span></button><button :class="{active: source === 'monitor'}" :aria-pressed="source === 'monitor'" @click="source = 'monitor'">声纹设备 <span>{{ monitorDevices?.length ?? '—' }}</span></button></div>
          <label class="fleet-search"><Search :size="17" /><input v-model="deviceSearch" aria-label="搜索设备名称或编号" placeholder="搜索设备名称或编号" /><button v-if="deviceSearch" aria-label="清空搜索" @click="deviceSearch = ''">×</button></label>
        </div>
        <div class="fleet-result"><span>设备目录 <b>{{ visibleEntries.length }}</b></span><span>{{ statusFilter === 'all' ? '全部状态' : statusFilter === 'online' ? '仅在线设备' : statusFilter === 'offline' ? '仅离线设备' : '仅状态未知设备' }} · 点击卡片进入监测</span></div>
        <div class="fleet-grid">
          <RouterLink v-for="entry in visibleEntries" :key="entry.key" class="fleet-card" :aria-label="(entry.source === 'legacy' ? '采集模块 ' : '声纹设备 ')+entry.id+' '+entry.name" :to="{ path: '/device/detail', query: { source: entry.source, device: entry.id, tab: availableTab(route.query.tab, entry.source) } }">
            <div class="fleet-card-top"><span class="fleet-kind"><component :is="entry.source === 'legacy' ? Server : Fan" :size="14" />{{ entry.source === 'legacy' ? '采集模块' : '声纹设备' }}</span><span class="fleet-status" :class="tone(entry.online)"><i></i>{{ status(entry.online) }}</span></div>
            <div class="fleet-stage">
              <div class="fleet-stage-grid" aria-hidden="true"></div>
              <div class="fleet-podium" aria-hidden="true"><span></span></div>
              <EquipmentVisual :name="entry.name" :source="entry.source" :device-id="entry.id" :online="(entry.source === 'legacy' ? telemetry.errors.modules : monitorError) ? undefined : entry.online" />
              <span class="fleet-stage-coordinate" aria-hidden="true">{{ entry.id }}</span>
            </div>
            <div class="fleet-card-body"><span class="fleet-id">{{ entry.id }}</span><h3>{{ entry.name }}</h3><div class="fleet-card-metrics"><span>监测点位 <b>{{ entryPointCount(entry) }}<small> 个</small></b></span><span>{{ entry.source === 'legacy' ? '通讯协议' : '采集类型' }} <b>{{ entry.source === 'legacy' ? entry.raw.protocol || '—' : '声纹采集' }}</b></span></div></div>
            <footer><span>进入实时监测</span><span class="fleet-arrow" aria-hidden="true">↗</span></footer>
          </RouterLink>
        </div>
        <div v-if="!visibleEntries.length" class="fleet-empty"><Server :size="32" /><h3>{{ refreshing ? '正在加载设备…' : '暂无匹配设备' }}</h3><button @click="resetDeviceFilters">重置筛选</button></div>

      </section>
      <aside v-if="showingDetail && selected" class="device-profile device-info-card">
        <button v-if="embedded" type="button" class="back-link profile-back" @click="emit('close')">‹ 返回点位监测</button>
        <RouterLink v-else class="back-link" :to="{ path: '/device', query: route.query.machine ? { machine: route.query.machine } : {} }">‹ {{ route.query.machine ? '返回整机监测' : '返回设备列表' }}</RouterLink>
        <h2>{{ profileName }}</h2><EquipmentVisual class="profile-equipment-visual" :name="profileName" :image-src="profileImage" :source="selected.source" :device-id="selected.id" :online="(isLegacy ? telemetry.errors.modules : monitorError) ? undefined : selected.online" :paused="!autoLive" />
        <dl><div><dt>设备编号</dt><dd>{{ selected.id }}</dd></div><div><dt>设备来源</dt><dd>{{ isLegacy ? '采集模块' : '声纹设备' }}</dd></div><div><dt>设备状态</dt><dd :class="tone(selected.online)">{{ status(selected.online) }}</dd></div><div><dt>监测点位</dt><dd>{{ isLegacy ? points.length : channels.length }} 个</dd></div><div v-if="isLegacy"><dt>通讯协议</dt><dd>{{ selected.raw.protocol || '—' }}</dd></div></dl>
      </aside>
      <main v-if="showingDetail" class="device-detail">
        <div v-if="!selected" class="device-empty"><Server :size="38" /><p>正在加载设备，或该设备已不可用</p><RouterLink to="/device">返回设备列表</RouterLink></div>
        <template v-else>
          <header class="selection-summary"><div><h2>{{ profileName }} <span :class="tone(selected.online)">{{ status(selected.online) }}</span></h2><p>{{ selected.id }} · {{ isLegacy ? selected.raw.protocol || '采集模块' : '声纹设备' }}</p></div><span class="source-tag">{{ isLegacy ? '采集模块' : '声纹设备' }}</span></header>
          <div class="device-detail-tabs" role="tablist" aria-label="设备数据视图"><button v-for="tab in detailTabs" :id="'device-tab-'+tab.id" :key="tab.id" role="tab" :aria-selected="chartMode === tab.id" :aria-controls="'device-panel-'+tab.id" :class="{active: chartMode === tab.id}" @click="chartMode = tab.id">{{ tab.label }}</button></div>
          <div v-if="!embedded && chartMode !== 'info' && chartMode !== 'live'" class="point-tabs" aria-label="分析点位">
            <template v-if="isLegacy"><button v-for="point in points" :key="point.pointId" :class="{active: selectedPoint?.pointId === point.pointId}" :aria-pressed="selectedPoint?.pointId === point.pointId" @click="selectedPointId = point.pointId">{{ point.name || point.pointCode }}</button></template>
            <template v-else><button v-for="channel in channels" :key="channel.channelId" :class="{active: selectedChannel?.channelId === channel.channelId}" :aria-pressed="selectedChannel?.channelId === channel.channelId" @click="selectedChannelId = channel.channelId">{{ acousticChannelDisplayName(selected?.raw, channel) }}</button></template>
          </div>
          <p v-if="isLegacy && chartMode !== 'live' && chartMode !== 'info'" class="point-meta">采集 IP：{{ selected.raw.host || '未提供' }}</p>
          <section :id="'device-panel-'+chartMode" role="tabpanel" :aria-labelledby="'device-tab-'+chartMode" class="device-tab-content">
            <template v-if="chartMode === 'info'">
              <article class="device-info-card"><h3>设备信息</h3><dl><div><dt>设备名称</dt><dd>{{ selected.name }}</dd></div><div><dt>设备编号</dt><dd>{{ selected.id }}</dd></div><div><dt>设备来源</dt><dd>{{ isLegacy ? '采集模块' : '声纹设备' }}</dd></div><div><dt>运行状态</dt><dd :class="tone(selected.online)">{{ status(selected.online) }}</dd></div><div v-if="isLegacy"><dt>通讯协议</dt><dd>{{ selected.raw.protocol || '—' }}</dd></div><div v-if="isLegacy"><dt>连接地址</dt><dd>{{ selected.raw.host || '—' }}{{ selected.raw.port ? ':'+selected.raw.port : '' }}</dd></div><div><dt>监测点位</dt><dd>{{ isLegacy ? points.length : channels.length }} 个</dd></div></dl></article>
              <MonitorDeviceDetails v-if="!isLegacy" :device="selected.raw" />
            </template>
            <template v-else-if="isLegacy">
              <div v-if="selected.raw.runtimeStatus?.offlineReason" class="monitor-error">{{ selected.raw.runtimeStatus.offlineReason }}</div>
              <div v-if="telemetry.errors.points" class="monitor-error" role="alert">点位获取失败：{{ telemetry.errors.points }} <button @click="loadPoints">重试点位</button></div>
              <p v-if="telemetry.loadingPoints" class="empty-copy">正在获取监测点位…</p>
              <p v-else-if="!points.length" class="empty-copy">该设备暂无可查询点位</p>
              <template v-else>
                <template v-if="chartMode === 'live'">
                  <header class="chart-toolbar"><strong>全部监测点位 · {{ points.length }} 个<span v-if="points.some(isVibrationPoint)"> · 振动 {{ points.filter(isVibrationPoint).length }} 项</span></strong><label><el-switch v-model="autoLive" aria-label="实时自动刷新" /><span>{{ autoLive ? '每 2 秒刷新' : '刷新已暂停' }}</span></label></header>
                  <div v-if="telemetry.errors.latest" class="monitor-error" role="alert">实时更新失败：{{ telemetry.errors.latest }}</div>
                  <ConfigurableDashboard default-grid-class="live-point-grid" :scope="'point-device:' + selected.key" :items="pointCards.map(card => ({ id: pointKey(card.point), title: card.point.name || card.point.pointCode, card }))" :default-span="embedded ? 4 : 2" :default-height="embedded ? 500 : 330">
                    <template #card="{ item }">                    <article class="live-point-card" :style="{ '--point-color': item.card.color }">
                      <header><h3>{{ item.card.point.name || item.card.point.pointCode }}</h3><span :class="item.card.stale ? 'warn' : 'muted'">{{ item.card.stale ? '数据未更新' : item.card.latest ? '实时采样' : '等待采样' }}</span></header>
                      <div class="point-value">{{ numberText(item.card.latest?.value) }} <small>{{ item.card.point.unit }}</small></div>
                      <p class="point-meta">采集 IP：{{ selected.raw.host || '未提供' }}</p>
                      <p class="point-meta">{{ item.card.point.channelId }} · {{ item.card.point.pointCode }}</p>
                      <div class="point-chart" role="img" :aria-label="(item.card.point.name || item.card.point.pointCode)+'实时折线，'+item.card.count+'个已采集样本'"><EChart :option="item.card.option" /></div>
                      <footer>{{ dateTime(item.card.latest?.collectedAt) }} · 质量 {{ item.card.latest?.quality ?? '—' }}</footer>
                    </article></template>

                  </ConfigurableDashboard>

                </template>
                <TrendPage v-else-if="chartMode === 'trend'" embedded :module-id="selected.id" :point="selectedPoint" />
                <article v-else-if="chartMode === 'history'" class="telemetry-panel history-panel"><form class="history-form" @submit.prevent="queryHistory"><label>开始时间<input v-model="historyStart" type="datetime-local" step="1" aria-label="开始时间" required /></label><label>结束时间<input v-model="historyEnd" type="datetime-local" step="1" aria-label="结束时间" required /></label><label>最多条数<input v-model.number="historyLimit" type="number" min="1" max="100000" step="1" aria-label="最多条数" required /></label><el-button native-type="submit" :icon="Search" :loading="telemetry.loadingHistory">查询历史</el-button></form>
                  <div class="quick-range"><button @click="recentRange(10)">最近 10 分钟</button><button @click="recentRange(60)">最近 1 小时</button><span>本地时间 · 起始包含，结束不包含</span></div>
                  <div v-if="telemetry.errors.history" class="monitor-error" role="alert">{{ telemetry.errors.history }}</div>
                  <div v-if="telemetry.history" class="history-summary"><span>{{ telemetry.history.points.length }} 条 · 最小 {{ numberText(historyMin) }} / 最大 {{ numberText(historyMax) }} {{ selectedPoint.unit }}</span><small>已查询 #{{ telemetry.history.requested.pointId }} · {{ dateTime(telemetry.history.requested.start) }} → {{ dateTime(telemetry.history.requested.end) }}</small></div>
                  <p v-if="telemetry.loadingHistory" class="empty-copy" role="status">正在查询历史数据…</p>
                  <p v-if="telemetry.history?.points.length >= telemetry.history?.requested.limit" class="monitor-error">结果已达到查询上限，可能未覆盖完整区间。请缩短时间范围或提高上限。</p>

                  <TelemetryHistoryList v-if="telemetry.history" :samples="telemetry.history.points" :point="selectedPoint" />
</article>
              </template>
            </template>
            <template v-else>
              <p v-if="!channels.length" class="empty-copy">该设备暂无声纹点位</p>
              <ConfigurableDashboard default-grid-class="live-point-grid" v-else-if="chartMode === 'live'" :scope="'point-device:' + selected.key" :items="channels.map(channel => ({ id: channel.channelId, title: acousticChannelDisplayName(selected.raw, channel), channel }))" :default-span="embedded ? 4 : 2" :default-height="500">
                <template #card="{ item }"><SpectrumPage show-address :key="selected.key + item.channel.channelId" embedded compact :accent-color="pointColor(JSON.stringify([selected.id, item.channel.channelId]))" :device="selected.raw" :channel-id="item.channel.channelId" display-mode="live" /></template>
              </ConfigurableDashboard>
              <SpectrumPage show-address v-else-if="chartMode === 'spectrum'" :key="selected.key" embedded :device="selected.raw" :channel-id="selectedChannel.channelId" :display-mode="chartMode" />
              <div v-else class="capability-empty"><Database :size="32" /><h3>当前声纹点位暂无历史采样列表</h3></div>
            </template>
          </section>
        </template>
      </main>
    </div>
  </section>
</template>

<style scoped>
.unified-monitor { display: flex; flex-direction: column; padding: 16px; overflow-y: auto; color: var(--text-main); background: var(--page-bg); gap: 12px; --accent: #50d8cb; --warning: #ffad66; scrollbar-width: thin; }
.device-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 20px; }.device-toolbar h1 small { color: var(--text-muted); font-size: 14px; font-weight: 400; margin-left: 10px; }
.source-summary { display: flex; gap: 24px; font-size: 14px; color: var(--text-muted); }.monitor-error { color: var(--warning); font-size: 14px; padding: 10px 12px; border: 1px solid #ffad6635; border-radius: 5px; background: #ffad6608; line-height: 1.6; overflow-wrap: anywhere; }.monitor-error button { border: 0; background: none; color: inherit; text-decoration: underline; }
.device-workspace { display: grid; grid-template-columns: 270px minmax(0,1fr); gap: 14px; flex: 1; min-height: 560px; }.device-directory { border: 1px solid var(--glass-border); background: var(--glass-card); border-radius: 8px; padding: 10px; align-self: start; position: sticky; top: 0; }.source-filter { display: flex; gap: 4px; padding-bottom: 10px; }.source-filter button { flex: 1 0 auto; white-space: nowrap; background: transparent; color: var(--text-muted); border: 1px solid transparent; border-radius: 4px; padding: 6px 3px; font-size: 14px; }.source-filter button.active { color: var(--accent); background: #50d8cb14; border-color: #50d8cb25; }
.device-list { display: grid; gap: 7px; max-height: 580px; overflow-y: auto; scrollbar-width: thin; }.device-entry { text-align: left; width: 100%; padding: 12px 10px; border: 1px solid var(--glass-border); border-radius: 6px; background: transparent; color: var(--text-main); }.device-entry.selected { border-color: #50d8cb80; background: #50d8cb0b; }.device-entry > div { display: flex; align-items: center; gap: 7px; }.device-entry strong { font-size: 14px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.device-entry i { margin-left: auto; font-size: 14px; white-space: nowrap; font-style: normal; }.device-entry svg { color: var(--accent); flex-shrink: 0; }.device-entry p { margin: 7px 0 4px; color: var(--text-soft); font-size: 14px; overflow-wrap: anywhere; }.device-entry small { font-size: 14px; color: var(--text-muted); }
.device-detail { min-width: 0; display: flex; flex-direction: column; gap: 12px; }.selection-summary { display: flex; justify-content: space-between; align-items: center; padding: 13px 16px; border: 1px solid var(--glass-border); border-radius: 8px; background: var(--glass-card); }.selection-summary h2 { font-size: 19px; margin: 0 0 7px; }.selection-summary h2 span { margin-left: 12px; font-size: 14px; font-weight: 400; }.selection-summary p { margin: 0; font-size: 14px; color: var(--text-muted); }.source-tag { color: var(--accent); border: 1px solid #50d8cb30; padding: 5px 8px; font-size: 14px; border-radius: 5px; }
.point-selector { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 14px; }.point-selector label { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }.point-selector :deep(.el-select) { max-width: 540px; flex: 1; }.point-selector > span { color: var(--text-muted); font-size: 14px; white-space: nowrap; }.point-cards { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 8px; max-height: 220px; overflow-y: auto; }.point-cards button { text-align: left; border: 1px solid var(--glass-border); border-radius: 6px; padding: 11px; background: var(--glass-card); color: var(--text-main); min-width: 0; }.point-cards button.active { border-color: #50d8cb80; }.point-cards button > span { display: block; font-size: 14px; }.point-cards strong { display: block; color: var(--accent); font-size: 28px; font-weight: 500; margin: 7px 0; }.point-cards small { color: var(--text-muted); font-size: 14px; overflow-wrap: anywhere; }.point-cards strong small { margin-left: 5px; }
.telemetry-panel { border: 1px solid var(--glass-border); border-radius: 8px; background: var(--glass-card); min-width: 0; padding: 0 14px; }.chart-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-bottom: 1px solid var(--glass-border); min-height: 47px; }.mode-tabs { display: flex; gap: 12px; }.mode-tabs button { display: flex; align-items: center; gap: 6px; font-size: 14px; border: 0; background: none; color: var(--text-muted); padding: 8px 0; }.mode-tabs button.active { color: var(--accent); }.chart-toolbar label { display: flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; white-space: nowrap; }
.sample-summary { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-top: 15px; }.sample-summary > strong { font-size: 34px; color: var(--accent); font-weight: 500; }.sample-summary small { font-size: 15px; }.sample-summary > span, .sample-summary > b { font-size: 14px; color: var(--text-muted); }.telemetry-chart { height: 330px; }.chart-note { color: var(--text-muted); font-size: 14px; line-height: 1.8; margin: 6px 0 14px; }
.history-form { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr) 95px auto; gap: 10px; align-items: end; margin: 15px 0 10px; }.history-form label { display: grid; gap: 6px; font-size: 14px; color: var(--text-muted); min-width: 0; }.history-form input { background: var(--surface); color: var(--text-main); border: 1px solid var(--glass-border); border-radius: 4px; height: 32px; min-width: 0; width: 100%; font: inherit; padding: 3px 6px; color-scheme: dark; }.quick-range { display: flex; align-items: center; gap: 12px; }.quick-range button { font-size: 14px; border: 0; background: transparent; color: var(--accent); padding: 4px 0; }.quick-range span { font-size: 14px; color: var(--text-muted); margin-left: auto; }.history-summary { display: grid; gap: 6px; margin-top: 13px; font-size: 14px; color: var(--text-soft); }.history-summary small { color: var(--text-muted); font-size: 14px; }
.empty-copy, .external-note { color: var(--text-muted); font-size: 14px; line-height: 1.7; }.device-empty { display: grid; place-content: center; justify-items: center; min-height: 400px; color: var(--text-muted); font-size: 15px; }.unified-monitor .good { color: #8ee6a8; }.unified-monitor .warn { color: var(--warning); }.unified-monitor .muted { color: var(--text-muted); }
:global(.light-theme .unified-monitor) { --accent: #237f76; --warning: #b65015; }:global(.light-theme .unified-monitor .good) { color: #287452; }:global(.light-theme .unified-monitor input) { color-scheme: light; }
@media (max-width:1300px) { .device-workspace { grid-template-columns: 205px minmax(0,1fr); }.unified-monitor { padding: 12px; }.history-form { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }.point-selector { flex-wrap: wrap; }.point-selector label { flex-basis: 100%; }.device-toolbar h1 small { display: block; margin: 6px 0 0; } }

.directory-heading { display: flex; gap: 8px; align-items: center; padding: 4px 0 14px; color: var(--accent); font-size: 16px; }
.directory-heading span { margin-left: auto; color: var(--text-muted); font-size: 14px; }
.device-detail-tabs { display: flex; border-bottom: 1px solid var(--glass-border); gap: 8px; background: var(--glass-card); border-radius: 8px 8px 0 0; padding: 0 8px; }
.device-detail-tabs button { flex: 1; padding: 16px 8px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: var(--text-muted); font-size: 17px; white-space: nowrap; }
.device-detail-tabs button.active { color: var(--accent); border-bottom-color: var(--accent); background: #50d8cb08; }
.device-tab-content { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.device-info-card, .capability-empty { border: 1px solid var(--glass-border); border-radius: 8px; background: var(--glass-card); padding: 20px; }
.device-info-card h3 { font-size: 19px; margin: 0 0 20px; }
.device-info-card dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin: 0; font-size: 16px; }
.device-info-card dt { color: var(--text-muted); margin-bottom: 8px; }
.device-info-card dd { margin: 0; overflow-wrap: anywhere; }
.capability-empty { min-height: 280px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; color: var(--text-muted); }
.capability-empty h3 { color: var(--text-main); font-size: 20px; }
.capability-empty p { max-width: 560px; font-size: 16px; line-height: 1.8; margin: 0; }
@media (max-width: 1300px) { .device-detail-tabs { gap: 0; padding: 0; } .device-detail-tabs button { font-size: 15px; padding: 14px 5px; } }

.directory-view.device-workspace { display: block; }
.directory-view .device-directory { position: static; padding: 20px; }
.directory-view .device-list { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); max-height: none; }
.device-entry { text-decoration: none; transition: border-color .2s, background .2s; }
.device-entry:hover { border-color: var(--accent); background: #50d8cb0b; }
.device-profile { align-self: start; position: sticky; top: 0; }
.profile-back { border:0; padding:0; background:transparent; font:inherit; color:var(--accent); cursor:pointer; }
.device-profile h2 { font-size: 21px; margin-top: 22px; overflow-wrap: anywhere; }
.device-profile dl { grid-template-columns: 1fr; font-size: 14px; }
.back-link { color: var(--accent); text-decoration: none; }
.equipment-illustration { height: 180px; display: grid; place-items: center; color: var(--accent); background: radial-gradient(ellipse, #50d8cb18, transparent 70%); margin-bottom: 22px; }
:deep(.live-point-grid) { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.live-point-card { min-width: 0; border: 1px solid var(--glass-border); border-radius: 10px; background: var(--glass-card); padding: 18px 16px 12px; }
.live-point-card header { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.live-point-card h3 { margin: 0; font-size: 17px; overflow-wrap: anywhere; }
.live-point-card header span { font-size: 12px; white-space: nowrap; }
.point-value { font-size: 34px; color: var(--point-color); margin-top: 18px; font-variant-numeric: tabular-nums; }
.point-value small { font-size: 15px; color: var(--text-muted); }
.point-meta, .live-point-card footer { font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; }
.point-chart { height: 150px; }
.point-tabs { display: flex; flex-wrap: wrap; gap: 8px; }
.point-tabs button { padding: 9px 14px; border: 1px solid var(--glass-border); border-radius: 6px; color: var(--text-muted); background: var(--glass-card); }
.point-tabs button.active { border-color: var(--accent); color: var(--accent); }
@media (max-width: 1500px) { :deep(.live-point-grid) { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 900px) { .device-workspace { grid-template-columns: minmax(0, 1fr); } .device-profile { position: static; } .device-profile dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } .equipment-illustration { display: none; } .device-detail-tabs { overflow-x: auto; } }
@media (max-width: 600px) { :deep(.live-point-grid) { grid-template-columns: minmax(0, 1fr); } .source-summary { flex-wrap: wrap; gap: 8px; } }

/* Equipment directory */
.equipment-directory-page { --directory-accent: #6cb6dc; }
.equipment-directory { min-width: 0; }
.fleet-overview { display: flex; justify-content: space-between; align-items: center; gap: 30px; padding: 28px 30px; border: 1px solid var(--glass-border); border-radius: 10px; background: radial-gradient(ellipse at 5% 0, #3d8cb51a, transparent 65%), var(--glass-card); }
.eyebrow { font-size: 11px; letter-spacing: 3px; color: var(--directory-accent); }
.fleet-intro h2 { margin: 10px 0; font-size: 27px; font-weight: 500; letter-spacing: 1px; }
.fleet-intro p { color: var(--text-muted); font-size: 13px; margin: 0 0 18px; line-height: 1.7; }
.fleet-sync { color: var(--text-muted); font-size: 12px; }
.fleet-stats { display: grid; grid-template-columns: repeat(4, minmax(85px, 1fr)); gap: 10px; min-width: 42%; }
.fleet-stats button { text-align: left; background: transparent; color: var(--text-muted); border: 1px solid transparent; border-left-color: var(--glass-border); border-radius: 4px; padding: 16px; }
.fleet-stats button.active { background: #6cb6dc09; border-color: #6cb6dc35; }
.fleet-stats button > span { font-size: 13px; white-space: nowrap; }
.fleet-stats strong { display: block; font-size: 36px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--text-main); margin-top: 14px; }
.fleet-stats .online strong { color: #59b69a; }.fleet-stats .offline strong { color: #d4a56b; }
.fleet-stats small { font-size: 12px; color: var(--text-muted); margin-left: 8px; }
.fleet-controls { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 24px; border-bottom: 1px solid var(--glass-border); padding-bottom: 14px; }
.fleet-source-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.fleet-source-tabs button { border: 1px solid transparent; border-radius: 5px; padding: 10px 16px; background: transparent; color: var(--text-muted); font-size: 14px; }
.fleet-source-tabs button.active { background: #6cb6dc12; color: var(--directory-accent); border-color: #6cb6dc35; }
.fleet-source-tabs button span { margin-left: 10px; opacity: .7; font-size: 12px; }
.fleet-search { display: flex; align-items: center; gap: 10px; width: 280px; padding: 9px 12px; border: 1px solid var(--glass-border); border-radius: 5px; color: var(--text-muted); background: var(--glass-card); }
.fleet-search:focus-within { border-color: var(--directory-accent); }
.fleet-search input { min-width: 0; width: 100%; border: 0; outline: 0; color: var(--text-main); font: inherit; font-size: 13px; background: transparent; }
.fleet-search button { border: 0; background: none; color: var(--text-muted); }
.fleet-result { display: flex; justify-content: space-between; gap: 12px; margin: 19px 0 14px; color: var(--text-muted); font-size: 12px; }
.fleet-result > span:first-child { color: var(--text-main); font-size: 14px; }.fleet-result b { margin-left: 7px; color: var(--directory-accent); }
.fleet-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
.fleet-card { display: block; min-width: 0; border: 1px solid var(--glass-border); border-radius: 9px; overflow: hidden; color: var(--text-main); background: linear-gradient(145deg, #4382a808, transparent 65%), var(--glass-card); text-decoration: none; transition: border-color .2s, box-shadow .2s, transform .2s; }
.fleet-card:hover, .fleet-card:focus-visible { border-color: #6cb6dc80; box-shadow: 0 8px 24px #0002; transform: translateY(-3px); outline: none; }
.fleet-card-top { display: flex; justify-content: space-between; gap: 10px; padding: 17px 18px 0; font-size: 12px; }
.fleet-kind { display: flex; align-items: center; gap: 6px; color: var(--text-muted); }
.fleet-status { display: flex; align-items: center; gap: 6px; }.fleet-status i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.fleet-card-body { padding: 0 18px 18px; }.fleet-id { color: var(--text-muted); font-size: 11px; letter-spacing: 1.5px; overflow-wrap: anywhere; }
.fleet-card h3 { font-size: 18px; font-weight: 500; margin: 7px 0 18px; overflow-wrap: anywhere; }
.fleet-card-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fleet-card-metrics > span { color: var(--text-muted); font-size: 12px; }.fleet-card-metrics b { display: block; font-size: 14px; font-weight: 400; color: var(--text-soft); margin-top: 8px; overflow-wrap: anywhere; }.fleet-card-metrics small { font-size: 12px; }
.fleet-card footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--glass-border); padding: 11px 18px; color: var(--directory-accent); font-size: 12px; background: #6cb6dc04; }.fleet-arrow { font-size: 21px; }
.fleet-empty { display: grid; justify-items: center; padding: 50px 20px; color: var(--text-muted); }.fleet-empty h3 { font-size: 18px; }.fleet-empty p { font-size: 14px; }.fleet-empty button { background: transparent; color: var(--directory-accent); border: 1px solid var(--glass-border); border-radius: 5px; padding: 8px 18px; }
.fleet-footnote { color: var(--text-muted); font-size: 12px; margin: 20px 0 5px; }
.profile-equipment-visual { margin: 12px -12px 24px; height: 210px; }
.profile-equipment-visual :deep(img) { position: absolute; inset: 5%; width: 90%; height: 90%; object-fit: contain; }
@media (max-width: 1550px) { .fleet-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }.fleet-overview { gap: 20px; padding: 24px; }.fleet-stats button { padding: 12px; } }
@media (max-width: 1150px) { .fleet-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.fleet-overview { flex-direction: column; align-items: stretch; }.fleet-stats { min-width: 0; }.fleet-controls { flex-wrap: wrap; }.fleet-search { width: 100%; } }
@media (max-width: 600px) { .fleet-grid { grid-template-columns: minmax(0, 1fr); }.fleet-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }.fleet-result { flex-wrap: wrap; }.fleet-source-tabs button { padding: 8px; }.fleet-intro h2 { font-size: 23px; } }
/* Open equipment stands, with perspective confined to the model and pedestal. */
.fleet-grid { gap: 24px 20px; padding: 8px 2px 20px; }
.fleet-card { position: relative; isolation: isolate; overflow: visible; border: 0; border-radius: 0; background: transparent; }
.fleet-card:hover, .fleet-card:focus-visible { transform: none; box-shadow: none; }
.fleet-card:focus-visible { outline: 1px solid var(--directory-accent); outline-offset: 5px; border-radius: 8px; }
.fleet-card-top { padding: 8px 12px 0; font-size: 10px; }
.fleet-stage { position: relative; height: 195px; isolation: isolate; perspective: 700px; }
.fleet-stage-grid { position: absolute; inset: 70px 5% 4px; z-index: -2; background-image: linear-gradient(var(--glass-border) 1px, transparent 1px), linear-gradient(90deg, var(--glass-border) 1px, transparent 1px); background-size: 24px 24px; transform: rotateX(65deg); mask-image: radial-gradient(ellipse, #0008, transparent 70%); }
.fleet-podium { position: absolute; width: 68%; height: 110px; left: 16%; bottom: 5px; transform: rotateX(62deg) rotateZ(-12deg); transform-style: preserve-3d; border: 1px solid var(--control-border-active); border-radius: 18px; background: linear-gradient(135deg, var(--glass-highlight), var(--glass-card)), var(--page-bg); box-shadow: 0 1px 0 var(--glass-border), 0 3px 0 var(--page-bg), 0 5px 0 var(--glass-border), 0 10px 0 var(--page-bg), 0 12px 0 var(--glass-border), 8px 25px 20px #0004; transition: transform .45s, box-shadow .45s; }
.fleet-podium span { position: absolute; inset: 10px; border: 1px solid var(--glass-border); border-radius: 12px; }
.fleet-podium::after { content: ''; position: absolute; left: 25%; right: 25%; bottom: -8px; height: 2px; background: var(--directory-accent); box-shadow: 0 0 12px var(--directory-accent); opacity: .5; }
.fleet-stage :deep(.equipment-visual) { position: absolute; inset: 0 0 16px; height: auto; background: none; overflow: visible; }
.fleet-stage :deep(.equipment-visual::before), .fleet-stage :deep(.visual-baseline) { display: none; }
.fleet-stage :deep(.equipment-symbol) { padding: 18px; border-radius: 9px; background: linear-gradient(135deg, var(--glass-highlight), var(--glass-card)), var(--page-bg); color: var(--text-soft); border-color: var(--control-border); transform: perspective(600px) rotateY(-24deg) rotateX(8deg) translateY(-8px); box-shadow: 2px 1px 0 var(--glass-border), 5px 3px 0 var(--page-bg), 7px 4px 0 var(--control-border), 12px 20px 20px #0004; transition: transform .45s, box-shadow .45s; }
.fleet-stage :deep(.equipment-glyph) { width: 55px; height: 55px; }
.fleet-stage :deep(img) { width: 85%; height: 145px; transform: perspective(600px) rotateY(-12deg) translateY(-8px); filter: drop-shadow(10px 20px 10px #0005); transition: transform .45s; }
.fleet-stage :deep(.operation-ring) { z-index: 2; bottom: 2px; width: 70%; height: 40px; }
.fleet-stage :deep(.operation-state) { right: 12px; bottom: 2px; }
.fleet-stage-coordinate { position: absolute; left: 12px; bottom: 18px; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; letter-spacing: 1px; color: var(--text-muted); opacity: .65; }
.fleet-card:hover .fleet-podium, .fleet-card:focus-visible .fleet-podium { transform: rotateX(62deg) rotateZ(-5deg) translateY(-4px); }
.fleet-card:hover :deep(.equipment-symbol), .fleet-card:focus-visible :deep(.equipment-symbol) { transform: perspective(600px) rotateY(-10deg) rotateX(4deg) translateY(-14px); }
.fleet-card:hover :deep(img), .fleet-card:focus-visible :deep(img) { transform: perspective(600px) rotateY(-3deg) translateY(-14px); }
.fleet-card-body { padding: 10px 14px 12px; border-top: 1px solid var(--glass-border); background: linear-gradient(180deg, var(--glass-card), transparent); }
.fleet-card-body > .fleet-id { display: none; }
.fleet-card h3 { margin: 0 0 10px; height: 40px; line-height: 20px; font-size: 15px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.fleet-card-metrics { gap: 10px; }
.fleet-card-metrics > span { font-size: 10px; }
.fleet-card-metrics > span + span { padding-left: 12px; border-left: 1px solid var(--glass-border); }
.fleet-card-metrics b { font-size: 13px; margin-top: 5px; }
.fleet-card footer { margin: 0 14px; padding: 7px 0; background: transparent; font-size: 10px; }
.fleet-arrow { font-size: 17px; transition: transform .3s; }
.fleet-card:hover .fleet-arrow { transform: translate(2px, -2px); }
@media (prefers-reduced-motion: reduce) { .fleet-card, .fleet-card *, .fleet-card :deep(*) { transition: none !important; } }
</style>
