<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { acousticChannelDisplayName } from '../charts/machineGroups.js'
import { isMeasurementPoint, monitoringPointName, sortMonitoringModules, sortMonitoringPoints } from '../charts/equipmentCatalog.js'
import { monitoringLocations, monitoringLocationOf, locationPoint } from '../charts/monitoringLocations.js'
import { pointKey } from '../charts/telemetry.js'

const route = useRoute()
const router = useRouter()
const telemetry = useTelemetryStore()
const monitor = useHomeDevicesStore()
const pointMap = ref({})
const pointErrors = ref({})
const loadedAt = new Map()
const busy = ref(false)
const paused = ref(false)
const now = ref(Date.now())
const controller = new AbortController()
let sampleTimer, configTimer
const selected = computed(() => monitoringLocations.find(item => item.id === route.query.location) || monitoringLocations[0])
const selectedKey = ref('')
const colors = { VibrationRms: '#508cef', VibrationUnbalance: '#508cef', Temperature: '#d99b3b', NegativePressure: '#18a99a', Speed: '#39a9ff', Current: '#a8cf71' }
const sources = computed(() => [
  ...sortMonitoringModules(telemetry.modules || []).map(module => ({ id: module.moduleId, source: 'legacy', online: module.runtimeStatus?.isOnline, points: pointMap.value[module.moduleId] || [], raw: module })),
  ...(monitor.devices || []).map(device => ({ id: device.deviceId, source: 'monitor', online: device.online, points: device.channels || [], raw: device })),
])
const rows = computed(() => sources.value.flatMap(member => member.points
  .filter(point => monitoringLocationOf(member, point) === selected.value.id)
  .map(point => ({
    key: member.source === 'legacy' ? pointKey(point) : JSON.stringify([member.id, point.channelId]),
    member, point: locationPoint(point), color: colors[point.metricType] || '#8089e9',
  }))))
const numericRows = computed(() => rows.value.filter(row => row.member.source === 'legacy'))
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
function openPoint(row) { selectedKey.value = row.key }
const rowName = row => row.member.source === 'monitor' ? acousticChannelDisplayName(row.member.raw, row.point) : monitoringPointName(row.point)
function navigateLocation(event, index) {
  const key = event.key
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return
  event.preventDefault()
  const next = key === 'Home' ? 0 : key === 'End' ? monitoringLocations.length - 1 : (index + (key === 'ArrowRight' ? 1 : -1) + monitoringLocations.length) % monitoringLocations.length
  selectLocation(monitoringLocations[next].id)
  document.getElementById(`location-tab-${monitoringLocations[next].id}`)?.focus()
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
          pointMap.value[module.moduleId] = sortMonitoringPoints(result.points.filter(isMeasurementPoint))
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
    <Teleport to="#monitor-location-tabs" defer>
      <nav class="location-tabs" role="tablist" aria-label="监测点位">
        <button v-for="(location, index) in monitoringLocations" :id="'location-tab-'+location.id" :key="location.id" type="button" role="tab" :aria-selected="selected.id === location.id" :aria-controls="'location-panel-'+selected.id" :tabindex="selected.id === location.id ? 0 : -1" :class="{ active: selected.id === location.id }" :title="location.machine + ' · ' + location.name" @click="selectLocation(location.id)" @keydown="navigateLocation($event, index)">{{ location.name }}</button>
      </nav>
    </Teleport>
    <header class="monitor-heading">
      <h1>{{ selected.machine }} · {{ selected.name }}</h1>
      <div class="monitor-actions"><label><input v-model="paused" type="checkbox" /> 暂停自动刷新</label><el-button :loading="busy" @click="refresh(true)">刷新数据</el-button></div>
    </header>
    <p v-if="telemetry.errors.modules || telemetry.errors.latest || monitor.error" class="monitor-warning" role="alert">{{ [telemetry.errors.modules, telemetry.errors.latest, monitor.error].filter(Boolean).join('；') }}</p>
    <p v-for="message in selectedErrors" :key="message" class="monitor-warning" role="alert">{{ message }}</p>
    <div :id="'location-panel-'+selected.id" :key="selected.id" role="tabpanel" :aria-labelledby="'location-tab-'+selected.id" class="location-content">
      <div v-if="numericRows.length" class="monitor-point-grid" :class="{ single: numericRows.length === 1, double: numericRows.length === 2 }">
        <article v-for="row in numericRows" :key="row.key" class="monitor-measurement" role="button" tabindex="0" :aria-label="rowName(row)+'详情'" aria-haspopup="dialog" @click="openPoint(row)" @keydown.enter.prevent="openPoint(row)" @keydown.space.prevent="openPoint(row)">
          <HomePointCard :point="row.point" :samples="telemetry.buffers[row.key] || []" :color="row.color" :now="now" :paused="paused" />
        </article>
      </div>
      <div v-if="acousticRows.length" class="acoustic-grid" :class="{ single: acousticRows.length === 1 }">
        <article v-for="row in acousticRows" :key="row.key" class="monitor-channel" role="button" tabindex="0" :aria-label="rowName(row)+'详情'" aria-haspopup="dialog" @click="openPoint(row)" @keydown.enter.prevent="openPoint(row)" @keydown.space.prevent="openPoint(row)">
          <HomeSoundChart :frame="soundFrames[row.key]" :name="rowName(row)" :status="soundCardStatus(row)" />
        </article>
      </div>
      <p v-if="!rows.length" class="monitor-empty">{{ busy ? '正在加载…' : '暂无数据' }}</p>
    </div>
    <MonitorPointDetails v-if="selectedRow" :key="selectedRow.key" :row="selectedRow" :location="selected.id" @close="selectedKey = ''" />
  </section>
</template>

<style scoped>
.machine-monitor { --wall-text:var(--text-main); --wall-muted:var(--text-muted); --wall-line:var(--glass-border); --wall-point:var(--glass-card-soft); padding:18px 24px; overflow-y:auto; color:var(--text-main); display:flex; flex-direction:column; gap:16px; }
.location-tabs { display:flex; align-items:center; gap:6px; overflow-x:auto; padding:4px 0; scrollbar-width:thin; }
.location-tabs button { flex:1 0 auto; min-height:36px; padding:7px 10px; border:1px solid var(--glass-border); border-radius:6px; color:var(--text-main); background:var(--glass-card); font:inherit; font-size:14px; white-space:nowrap; cursor:pointer; }
.location-tabs button.active { background:var(--control-bg-active); border-color:var(--control-border-active); color:var(--text-highlight); box-shadow:inset 0 -2px 0 #a8ff7d; }
.location-tabs button:focus-visible,.monitor-measurement:focus-visible,.monitor-channel:focus-visible { outline:2px solid #a8ff7d; outline-offset:2px; }
.monitor-heading,.monitor-actions { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; }
h1 { margin:0; font-size:22px; font-weight:600; }
.monitor-actions { font-size:14px; color:var(--text-muted); }
.monitor-actions label { display:flex; align-items:center; gap:6px; }
.location-content { display:flex; flex-direction:column; gap:16px; }
.monitor-point-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
.monitor-point-grid.single { grid-template-columns:minmax(0,1fr); }
.monitor-point-grid.double,.acoustic-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
.acoustic-grid.single { grid-template-columns:minmax(0,1fr); }
.monitor-measurement,.monitor-channel { min-width:0; border-radius:8px; cursor:pointer; }
.monitor-measurement:hover,.monitor-channel:hover { box-shadow:0 0 0 1px var(--control-border-active); }
.monitor-point-grid :deep(.home-point-chart) { height:170px; }
.monitor-point-grid :deep(.home-point h3) { font-size:15px; }
.monitor-point-grid :deep(.home-point footer) { display:none; }
.monitor-point-grid.single :deep(.home-point-chart),.monitor-point-grid.double :deep(.home-point-chart) { height:280px; }
.monitor-channel { padding:14px 0 4px; border:1px solid var(--glass-border); background:var(--glass-card-soft); }
.monitor-channel :deep(.plot),.monitor-channel :deep(.spectrogram-canvas) { height:200px; }
.monitor-warning { margin:0; padding:10px 14px; border:1px solid #e4a26055; color:#d99545; border-radius:6px; }
.monitor-empty { color:var(--text-muted); text-align:center; padding:48px; }
@media(max-width:1100px) { .monitor-point-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:650px) { .machine-monitor { padding:14px; }.monitor-point-grid,.monitor-point-grid.double,.acoustic-grid { grid-template-columns:minmax(0,1fr); } }
</style>
