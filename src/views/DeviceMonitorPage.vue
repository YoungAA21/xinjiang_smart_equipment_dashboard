<script setup>
import ConfigurableDashboard from '../components/ConfigurableDashboard.vue'
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HomePointCard from '../components/HomePointCard.vue'
import HomeSoundChart from '../components/HomeSoundChart.vue'
import MonitorPointDetails from '../components/MonitorPointDetails.vue'
import { useTelemetryStore } from '../stores/telemetry'
import { useHomeDevicesStore } from '../stores/homeDevices'
import { telemetryApi } from '../services/telemetry.js'
import { api } from '../services/api.js'
import { auth } from '../services/auth.js'
import { createSoundPreview } from '../services/soundPreview.js'
import { acousticChannelDisplayName, presentAcousticChannels } from '../charts/machineGroups.js'
import { configuredMonitoringPoints, discoveredMonitoringModules, monitoringPointName, sortMonitoringModules, sortMonitoringPoints } from '../charts/equipmentCatalog.js'
import { monitoringLocations, monitoringLocationOf, locationPoint } from '../charts/monitoringLocations.js'
import { pointConfiguration } from '../stores/pointConfiguration.js'
import { detailTabLocations } from '../charts/pointDetailTabs.js'
import { locationHierarchyLabel } from '../charts/machineTaxonomy.js'
import { pointKey } from '../charts/telemetry.js'
import { requestedPointRow } from '../charts/homePointNavigation.js'
import { useRecentHistory } from '../composables/useRecentHistory.js'
import HistoryCacheStatus from '../components/HistoryCacheStatus.vue'

const route = useRoute()
const router = useRouter()
const telemetry = useTelemetryStore()
const monitor = useHomeDevicesStore()
const pointMap = ref({})
const pointErrors = ref({})
const reportInformation = inject('reportInformation', () => {})
watch(pointErrors, errors => {
  for (const [id, error] of Object.entries(errors)) if (error) reportInformation('测点配置 · ' + id, error)
}, { deep: true })
const loadedAt = new Map()
const busy = ref(false)
const paused = ref(false)
const headerControlsExpanded = inject('homeControlsExpanded', ref(false))
const now = ref(Date.now())
const controller = new AbortController()
let sampleTimer, configTimer
const requestedLocation = computed(() => monitoringLocations.find(item => item.id === route.query.location))
const locationOptions = computed(() => detailTabLocations(monitoringLocations, pointConfiguration.detailLocationIds))
const selected = computed(() => requestedLocation.value || locationOptions.value[0] || { id: '', name: '', modules: [] })
const selectedKey = ref('')
const colors = { VibrationRms: '#508cef', VibrationUnbalance: '#508cef', Temperature: '#d99b3b', NegativePressure: '#18a99a', Speed: '#39a9ff', Current: '#a8cf71' }
const sources = computed(() => [
  ...sortMonitoringModules(discoveredMonitoringModules(telemetry.modules || [], telemetry.latest || [])).map(module => ({ id: module.moduleId, source: 'legacy', online: module.runtimeStatus?.isOnline, points: configuredMonitoringPoints(pointMap.value[module.moduleId] || [], telemetry.latest, module.moduleId), raw: module })),
  ...(monitor.devices || []).map(device => ({ id: device.deviceId, source: 'monitor', online: device.online, points: presentAcousticChannels(device), raw: device })),
])
const rows = computed(() => sources.value.flatMap(member => member.points
  .filter(point => monitoringLocationOf(member, point) === selected.value.id)
  .map(point => ({
    key: member.source === 'legacy' ? pointKey(point) : JSON.stringify([member.id, point.channelId]),
    member, point: member.source === 'legacy' ? locationPoint(point) : point, color: colors[point.metricType] || '#8089e9',
  }))))
const layoutItems = computed(() => rows.value.map(row => ({ id: row.key, title: rowName(row), row })))
const recentHistory = useRecentHistory(computed(() => rows.value.filter(row => row.member.source === 'legacy').map(row => row.point)), telemetry, controller.signal)
const acousticRows = computed(() => rows.value.filter(row => row.member.source === 'monitor'))
const selectedErrors = computed(() => selected.value.modules.filter(id => pointErrors.value[id]).map(id => `${id}：${pointErrors.value[id]}`))
const selectedRow = computed(() => {
  const row = rows.value.find(item => item.key === selectedKey.value)
  return row ? { ...row, soundFrame: soundFrames.value[row.key], soundStatus: soundCardStatus(row) } : null
})
function selectLocation(id) {
  router.replace({ path: '/device', query: { location: id } })
}
watch(() => selected.value.id, () => { selectedKey.value = '' })
watch(() => pointConfiguration.detailLocationIds, () => {
  if (requestedLocation.value && !pointConfiguration.detailLocationIds.includes(requestedLocation.value.id)) {
    const { location: _location, machine: _machine, model: _model, ...query } = route.query
    router.replace({ path: '/device', query: { ...query, ...(locationOptions.value[0] ? { location: locationOptions.value[0].id } : {}) } })
  }
})
function openPoint(row) { selectedKey.value = row.key }
watch([rows, () => route.query], () => {
  const row = requestedPointRow(rows.value, route.query)
  if (!row) return
  selectedKey.value = row.key
  // Consume the request once so metadata refreshes do not reopen a closed drawer.
  const { openPoint: _openPoint, ...query } = route.query
  router.replace({ path: '/device', query })
}, { immediate: true })
const rowName = row => row.member.source === 'monitor' ? acousticChannelDisplayName(row.member.raw, row.point) : monitoringPointName(row.point)
function navigateLocation(event, index) {
  const key = event.key
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
  event.preventDefault()
  const next = key === 'Home' ? 0 : key === 'End' ? locationOptions.value.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + locationOptions.value.length) % locationOptions.value.length
  selectLocation(locationOptions.value[next].id)
  document.getElementById(`location-tab-${locationOptions.value[next].id}`)?.focus()
}
const soundFrames = ref({})
const soundStatus = ref('等待连接')
const preview = createSoundPreview({ api, token: () => auth.getToken(), Socket: WebSocket,
  onFrame(deviceId, channelId, data) {
    const key = JSON.stringify([deviceId, channelId])
    const previous = soundFrames.value[key] || { rows: [], sampleRate: 22000 }
    soundFrames.value[key] = {
      rows: Array.isArray(data.waterfallRow) ? [...previous.rows.slice(-219), data.waterfallRow] : previous.rows,
      sampleRate: Number(data.sampleRate || data.sample_rate || data.audioSampleRate) || previous.sampleRate,
      receivedAt: Date.now(),
    }
  },
  onStatus(value) { soundStatus.value = value },
})
function soundCardStatus(row) {
  if (monitor.error) return '状态待确认'
  if (row.point.online === false || row.member.online === false) return '离线'
  if (paused.value) return '已暂停'
  const frame = soundFrames.value[row.key]
  return frame ? now.value - frame.receivedAt > 10000 ? '未更新' : '实时' : soundStatus.value
}
const soundTargets = computed(() => {
  if (paused.value || monitor.error || selectedRow.value) return []
  const visible = acousticRows.value
  const targets = new Map()
  for (const row of visible) {
    if (row.member.source !== 'monitor' || row.point.online !== true || row.member.online === false) continue
    if (!targets.has(row.member.id)) targets.set(row.member.id, { deviceId: row.member.id, channelIds: [] })
    targets.get(row.member.id).channelIds.push(row.point.channelId)
  }
  return [...targets.values()]
})
let soundTargetIndex = 0, soundTimer
watch(() => JSON.stringify(soundTargets.value), () => {
  soundTargetIndex = 0
  preview.setTarget(soundTargets.value[0]).catch(() => {})
})
async function refresh(force = false) {
  if (busy.value || controller.signal.aborted) return
  busy.value = true
  try {
    await Promise.all([telemetry.refreshModules({ signal: controller.signal }), monitor.refresh({ signal: controller.signal }), telemetry.refreshLatest({ signal: controller.signal })])
    if (controller.signal.aborted) return
    const modules = telemetry.modules || []
    const ids = new Set(modules.map(module => module.moduleId))
    for (const id of Object.keys(pointMap.value)) if (!ids.has(id)) { delete pointMap.value[id]; delete pointErrors.value[id]; loadedAt.delete(id) }
    const pending = modules.filter(module => force || !loadedAt.has(module.moduleId) || Date.now() - loadedAt.get(module.moduleId) >= 300000)
    for (let i = 0; i < pending.length && !controller.signal.aborted; i += 2) {
      await Promise.all(pending.slice(i, i + 2).map(async module => {
        try {
          const result = await telemetryApi.getModulePoints(module.moduleId, { signal: controller.signal })
          if (controller.signal.aborted) return
          if (result?.moduleId !== module.moduleId || !Array.isArray(result.points)) throw new Error('点位返回格式不正确')
          pointMap.value[module.moduleId] = sortMonitoringPoints(result.points.map(point => ({ ...point, moduleId: module.moduleId })))
          loadedAt.set(module.moduleId, Date.now())
          delete pointErrors.value[module.moduleId]
        } catch (error) {
          if (!controller.signal.aborted) {
            loadedAt.delete(module.moduleId)
            pointErrors.value[module.moduleId] = error.name === 'TimeoutError' ? '点位配置请求超时，稍后自动重试' : error.message || '点位配置获取失败'
          }
        }
      }))
    }
  } finally { busy.value = false }
}
onMounted(() => {
  refresh()
  sampleTimer = setInterval(() => { now.value = Date.now(); if (!paused.value) telemetry.refreshLatest({ signal: controller.signal }) }, 2000)
  configTimer = setInterval(() => { if (!paused.value) refresh() }, 30000)
  soundTimer = setInterval(() => {
    if (soundTargets.value.length > 1) {
      soundTargetIndex = (soundTargetIndex + 1) % soundTargets.value.length
      preview.setTarget(soundTargets.value[soundTargetIndex]).catch(() => {})
    }
  }, 5000)
})
onBeforeUnmount(() => {
  controller.abort()
  clearInterval(sampleTimer); clearInterval(configTimer); clearInterval(soundTimer)
  preview.stop().catch(() => {})
  telemetry.clear(); monitor.clear()
})
</script>

<template>
  <section class="page machine-monitor">
    <header class="monitor-heading">
      <nav class="location-tabs" role="tablist" aria-label="监测点位">
        <button v-for="(location, index) in locationOptions" :id="'location-tab-'+location.id" :key="location.id" type="button" role="tab" :aria-selected="selected.id === location.id" :aria-controls="'location-panel-'+selected.id" :tabindex="selected.id === location.id ? 0 : -1" :class="{ active: selected.id === location.id }" :title="locationHierarchyLabel(location)" @click="selectLocation(location.id)" @keydown="navigateLocation($event, index)">{{ location.name }}</button>
      </nav>
      <div class="monitor-actions">
        <button type="button" class="point-layout-button" :aria-label="paused ? '恢复自动刷新' : '暂停自动刷新'" :title="paused ? '恢复自动刷新' : '暂停自动刷新'" :aria-pressed="paused" @click="paused = !paused">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path v-if="paused" d="m8 5 11 7-11 7Z"/><path v-else d="M8 5v14M16 5v14"/></svg>
        </button>
        <span id="point-layout-actions" class="point-layout-actions"></span>
        <button type="button" class="point-layout-button" aria-label="刷新数据" title="刷新数据" :disabled="busy" @click="refresh(true)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" :class="{ spinning: busy }" aria-hidden="true"><path d="M20 7a9 9 0 0 0-15 0M4 17a9 9 0 0 0 15 0M20 3v4h-4M4 21v-4h4"/></svg></button>
        <button type="button" class="point-layout-button" :aria-label="headerControlsExpanded ? '隐藏主题与账户设置' : '显示主题与账户设置'" :title="headerControlsExpanded ? '隐藏主题与账户设置' : '显示主题与账户设置'" :aria-expanded="headerControlsExpanded" @click="headerControlsExpanded = !headerControlsExpanded"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg></button>
      </div>
    </header>
<!--    <HistoryCacheStatus />-->
<!--    <p v-if="recentHistory.loading.value" class="pending-note" role="status">正在补齐近期历史采样…</p>-->
<!--    <p v-if="recentHistory.failed.value" class="monitor-warning" role="alert">部分测点近期历史加载失败。<button type="button" @click="recentHistory.retry()">重试历史</button></p>-->
    <p v-if="!selected.id" class="monitor-empty">暂无已展示的大点位，请在参数配置中设置顶部按钮。<RouterLink to="/settings/parameters">前往参数配置</RouterLink></p>
    <div v-else :id="'location-panel-'+selected.id" :key="selected.id" role="tabpanel" :aria-label="selected.name" class="location-content">
      <ConfigurableDashboard uniform :scope="'point-location:' + selected.id" :items="layoutItems" :default-span="2" :default-height="320">
        <template #toolbar="{ editing, toggleEditing, reset }">
          <Teleport to="#point-layout-actions" defer>
            <button type="button" class="point-layout-button layout-icon" :class="{ active: editing }" :aria-label="editing ? '完成布局' : '编辑布局'" :title="editing ? '完成布局' : '编辑布局'" :aria-pressed="editing" @click="toggleEditing">
              <svg v-if="editing" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            </button>
            <button v-if="editing" type="button" class="point-layout-button" aria-label="恢复默认布局" title="恢复默认布局" @click="reset"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7"/></svg></button>
          </Teleport>
        </template>
        <template #card="{ item }">
          <article class="monitor-measurement" role="button" tabindex="0" :aria-label="rowName(item.row)+'详情'" aria-haspopup="dialog" @click="openPoint(item.row)" @keydown.enter.prevent="openPoint(item.row)" @keydown.space.prevent="openPoint(item.row)">
            <HomePointCard v-if="item.row.member.source === 'legacy'" :point="item.row.point" :samples="telemetry.buffers[item.row.key] || []" :color="item.row.color" :now="now" :paused="paused" />
            <HomeSoundChart v-else :frame="soundFrames[item.row.key]" :name="rowName(item.row)" :status="soundCardStatus(item.row)" />
          </article>
        </template>
      </ConfigurableDashboard>
      <p v-if="!rows.length" class="monitor-empty">{{ busy ? '正在加载…' : '暂无数据' }}</p>
    </div>
    <MonitorPointDetails v-if="selectedRow" :key="selectedRow.key" :row="selectedRow" :location="selected.id" @close="selectedKey = ''" />
  </section>
</template>

<style scoped>
.machine-monitor { --wall-text:var(--text-main); --wall-muted:var(--text-muted); --wall-line:var(--glass-border); --wall-point:var(--glass-card-soft); padding:0 14px 12px; overflow-y:auto; color:var(--text-main); display:flex; flex-direction:column; gap:16px; }
.location-tabs { display:flex; align-items:center; gap:6px; overflow-x:auto; padding:4px 0; scrollbar-width:thin; }
.location-tabs button { flex:1 0 auto; min-height:36px; padding:7px 10px; border:1px solid var(--glass-border); border-radius:6px; color:var(--text-main); background:var(--glass-card); font:inherit; font-size:14px; white-space:nowrap; cursor:pointer; }
.location-tabs button.active { background:var(--control-bg-active); border-color:var(--control-border-active); color:var(--text-highlight); box-shadow:inset 0 -2px 0 #a8ff7d; }
.location-tabs button:focus-visible,.monitor-measurement:focus-visible,.monitor-channel:focus-visible { outline:2px solid #a8ff7d; outline-offset:2px; }
.monitor-heading { display:flex; align-items:center; gap:20px; flex:none; position:sticky; top:0; z-index:10; background:var(--page-bg); padding:0 0 8px; border-bottom:1px solid var(--glass-border); }
.monitor-heading .location-tabs { flex:1; min-width:0; gap:8px; }
.monitor-actions { display:flex; align-items:center; gap:8px; flex:none; }
h1 { margin:0; font-size:22px; font-weight:600; }
.monitor-actions { font-size:14px; color:var(--text-muted); }
.monitor-actions label { display:flex; align-items:center; gap:6px; }
.monitor-actions a { color:#368ce8; }
.monitor-refresh-actions,.point-layout-actions { display:flex; align-items:center; gap:8px; flex-wrap:nowrap; }
.point-layout-button { display:grid; place-items:center; width:34px; height:34px; padding:8px; border:1px solid var(--glass-border); border-radius:6px; color:var(--text-muted); background:var(--glass-card); cursor:pointer; }
.point-layout-button:hover { color:var(--text-main); background:var(--control-bg-active); }
.point-layout-button:focus-visible { outline:2px solid var(--control-border-active); outline-offset:2px; }
.point-layout-button.active { color:var(--text-highlight); border-color:var(--control-border-active); background:var(--control-bg-active); }
.point-layout-button:disabled { opacity:.5; cursor:default; }
.spinning { animation:point-refresh-spin 1s linear infinite; }
@keyframes point-refresh-spin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .spinning { animation:none; } }
.location-content { display:flex; flex-direction:column; gap:16px; }
.monitor-measurement,.monitor-channel { min-width:0; border-radius:8px; cursor:pointer; }
.monitor-measurement:hover,.monitor-channel:hover { box-shadow:0 0 0 1px var(--control-border-active); }
.monitor-channel { padding:14px 0 4px; border:1px solid var(--glass-border); background:var(--glass-card-soft); }
.monitor-channel :deep(.plot),.monitor-channel :deep(.spectrogram-canvas) { height:200px; }
.monitor-warning { margin:0; padding:10px 14px; border:1px solid #e4a26055; color:#d99545; border-radius:6px; }
.monitor-empty { color:var(--text-muted); text-align:center; padding:48px; }
@media(max-width:1200px) { .monitor-heading { flex-wrap:wrap; gap:6px; }.monitor-heading .location-tabs { flex-basis:100%; }.monitor-actions { margin-left:auto; } }
@media(max-width:650px) { .machine-monitor { padding:0 14px 14px; } }
</style>
