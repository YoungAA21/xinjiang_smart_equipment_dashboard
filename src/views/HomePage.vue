<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { Search, RefreshCw, Activity, AudioLines, Thermometer, Gauge, Eye, EyeOff } from 'lucide-vue-next'
import HomeMonitorTile from '../components/HomeMonitorTile.vue'
import HomeDeviceDialog from '../components/HomeDeviceDialog.vue'
import { createSoundPreview } from '../services/soundPreview.js'
import { api } from '../services/api'
import { auth } from '../services/auth'
import { useTelemetryStore } from '../stores/telemetry'
import { useHomeDevicesStore } from '../stores/homeDevices'
import { telemetryApi } from '../services/telemetry'
import { pointKey } from '../charts/telemetry'
import { groupMachineDevices } from '../charts/machineGroups.js'
import { isMeasurementPoint, moduleDisplayName, sortMonitoringModules, sortMonitoringPoints } from '../charts/equipmentCatalog.js'

const telemetry = useTelemetryStore()
const homeControlsExpanded = inject('homeControlsExpanded', ref(false))
const monitor = useHomeDevicesStore()
const pointMap = ref({})
const pointLoadedAt = new Map()
const pointErrors = ref({})
const search = ref('')
const source = ref('all')
const autoRefresh = ref(true)
const refreshing = ref(false)
const now = ref(Date.now())
const switchingAcoustic = ref(false)
const controller = new AbortController()
let sampleTimer, metadataTimer
const dialogOpen = ref(false)
const deviceDialog = ref(null)
async function closeDeviceDialog(done) {
  await deviceDialog.value?.stopSession()
  done()
}
const dialogDeviceKey = ref('')
const dialogDevice = computed(() => devices.value.find(device => device.key === dialogDeviceKey.value))
async function openDeviceDialog(device) {
  if (switchingAcoustic.value) return
  switchingAcoustic.value = true
  try {
    await preview.stop()
    dialogDeviceKey.value = device.key
    dialogOpen.value = true
  } finally { switchingAcoustic.value = false }
}
const devices = computed(() => [
  ...sortMonitoringModules(telemetry.modules || []).map(module => ({ key: JSON.stringify(['legacy', module.moduleId]), source: 'legacy', id: module.moduleId, name: moduleDisplayName(module), online: module.runtimeStatus?.isOnline, points: pointMap.value[module.moduleId] || [], raw: module })),
  ...(monitor.devices || []).map(device => ({ key: JSON.stringify(['monitor', device.deviceId]), source: 'monitor', id: device.deviceId, name: device.deviceName || device.deviceId, online: device.online, points: device.channels || [], raw: device })),
])
const machineData = computed(() => groupMachineDevices(devices.value))
const activeMachineId = ref('ZJ117')
const activeMachine = computed(() => machineData.value.groups.find(machine => machine.id === activeMachineId.value) || machineData.value.groups[0])
const connectionKey = (device, channel) => JSON.stringify([device.id, channel.channelId])
const currentTime = computed(() => new Date(now.value).toLocaleTimeString('zh-CN', { hour12: false }))
const machineState = machine => machine.members.some(member => member.source === 'legacy' ? telemetry.errors.modules : monitor.error) ? '状态待确认' : machine.status
const categories = [
  { id: 'vibration', name: '振动监测', color: '#368ce8', icon: Activity },
  { id: 'temperature', name: '温度监测', color: '#db8b2b', icon: Thermometer },
  { id: 'pressure', name: '负压监测', color: '#18a99a', icon: Gauge },
  { id: 'other', name: '电机与其他参数', color: '#8875d9', icon: Gauge },
  { id: 'acoustic', name: '声纹监测', color: '#688bea', icon: AudioLines },
]
const categoryOf = (point, member) => member.source === 'monitor' ? 'acoustic' : String(point.metricType || '').startsWith('Vibration') ? 'vibration' : point.metricType === 'Temperature' ? 'temperature' : point.metricType === 'NegativePressure' ? 'pressure' : 'other'
const allRows = computed(() => activeMachine.value.members.flatMap(member => member.points.map(point => ({ member, point, key: member.source === 'legacy' ? pointKey(point) : connectionKey(member, point), category: categoryOf(point, member) }))))
const sections = computed(() => categories.map(category => ({ ...category, rows: allRows.value.filter(row => row.category === category.id && (source.value === 'all' || row.member.source === source.value) && `${row.member.name} ${row.member.id} ${row.point.name || row.point.channelName || ''} ${row.point.pointCode || row.point.channelId}`.toLowerCase().includes(search.value.trim().toLowerCase())) })).filter(category => category.rows.length))
const staleCount = computed(() => allRows.value.filter(row => {
  if (row.member.source !== 'legacy') return false
  const last = telemetry.buffers[row.key]?.at(-1)
  return last && now.value - Date.parse(last.collectedAt) > 10000
}).length)
const acousticCount = computed(() => allRows.value.filter(row => row.member.source === 'monitor').length)
const activeErrors = computed(() => activeMachine.value.members.filter(member => pointErrors.value[member.id]).map(member => `${member.id}：${pointErrors.value[member.id]}`))
const historyState = ref({})
let warmingHistory = false
const historyLoading = computed(() => allRows.value.some(row => historyState.value[row.key] === 'loading'))
const historyFailed = computed(() => allRows.value.some(row => historyState.value[row.key] === 'error'))
async function warmHistory() {
  if (warmingHistory || controller.signal.aborted) return
  warmingHistory = true
  try {
    while (!controller.signal.aborted) {
      const batch = allRows.value.filter(row => row.member.source === 'legacy' && Number.isSafeInteger(Number(row.point.pointId)) && !historyState.value[row.key]).slice(0, 2)
      if (!batch.length) break
      await Promise.all(batch.map(async row => {
        historyState.value[row.key] = 'loading'
        try {
          await telemetry.seedRecentPoints(row.point, { signal: controller.signal })
          if (!controller.signal.aborted) historyState.value[row.key] = 'ready'
        } catch {
          if (!controller.signal.aborted) historyState.value[row.key] = 'error'
        }
      }))
    }
  } finally { warmingHistory = false }
}
function retryHistory() {
  for (const key of Object.keys(historyState.value)) if (historyState.value[key] === 'error') delete historyState.value[key]
  warmHistory()
}
watch(allRows, warmHistory)
async function selectMachine(id) {
  if (id === activeMachineId.value || switchingAcoustic.value || dialogOpen.value) return
  switchingAcoustic.value = true
  try {
    await preview.stop()
    activeMachineId.value = id
    search.value = ''
    source.value = 'all'
  } finally { switchingAcoustic.value = false }
}
async function navigateTab(event, index) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const tabs = machineData.value.groups
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  const parent = event.currentTarget.parentElement
  await selectMachine(tabs[next].id)
  await nextTick()
  parent.querySelector(`[id="machine-tab-${activeMachineId.value}"]`)?.focus()
}
const displayRows = computed(() => {
  const rows = sections.value.flatMap(section => section.rows.map(row => ({ ...row, color: section.color, categoryName: section.name })))
  const pairs = [
    { moduleId: 'SC01', speedCode: 'MAIN_SPEED', currentCode: 'MAIN_CURRENT', title: '主机运行参数', speedName: '主机车速', currentName: '主机电流' },
    { moduleId: 'SC02', speedCode: 'AUX_SPEED', currentCode: 'AUX_CURRENT', title: '辅机运行参数', speedName: '辅机车速', currentName: '辅机电流' },
  ]
  for (const pair of pairs) {
    const speedIndex = rows.findIndex(row => row.member.id === pair.moduleId && row.point.pointCode === pair.speedCode)
    const currentIndex = rows.findIndex(row => row.member.id === pair.moduleId && row.point.pointCode === pair.currentCode)
    if (speedIndex < 0 || currentIndex < 0) continue
    const speed = rows[speedIndex], current = rows[currentIndex]
    rows.splice(Math.max(speedIndex, currentIndex), 1)
    rows.splice(Math.min(speedIndex, currentIndex), 1)
    rows.push({
      key: `${pair.moduleId}-COMBINED-READINGS`, member: speed.member, point: speed.point,
      category: speed.category, categoryName: pair.title, color: speed.color,
      combined: { ...pair, speed: { ...speed.point, key: speed.key }, current: { ...current.point, key: current.key } },
    })
  }
  return rows.map(row => row.member.source === 'monitor'
    ? { ...row, soundFrame: soundFrames.value[row.key], soundStatus: soundCardStatus(row) }
    : row)
})
const soundFrames = ref({})
const soundStatus = ref('等待连接')
const preview = createSoundPreview({ api, token: () => auth.getToken(), Socket: WebSocket,
  onFrame(deviceId, channelId, data) {
    const key = JSON.stringify([deviceId, channelId])
    const previous = soundFrames.value[key] || { rows: [], sampleRate: 22000 }
    const row = Array.isArray(data.waterfallRow) ? data.waterfallRow : null
    soundFrames.value[key] = {
      rows: row ? [...previous.rows.slice(-219), row] : previous.rows,
      sampleRate: Number(data.sampleRate || data.sample_rate || data.audioSampleRate) || previous.sampleRate,
      receivedAt: Date.now(),
    }
  },
  onStatus(value) { soundStatus.value = value },
})
const soundTargets = computed(() => {
  if (!autoRefresh.value || dialogOpen.value || switchingAcoustic.value || monitor.error) return []
  const targets = new Map()
  for (const row of displayRows.value) {
    if (row.member.source !== 'monitor' || row.point.online !== true || row.member.online === false) continue
    if (!targets.has(row.member.id)) targets.set(row.member.id, { deviceId: row.member.id, channelIds: [] })
    targets.get(row.member.id).channelIds.push(row.point.channelId)
  }
  return [...targets.values()]
})
let soundTargetIndex = 0, soundTimer
const targetSignature = computed(() => JSON.stringify(soundTargets.value))
watch(targetSignature, () => {
  soundTargetIndex = 0
  preview.setTarget(soundTargets.value[0]).catch(() => {})
})
function soundCardStatus(row) {
  if (monitor.error) return '状态待确认'
  if (row.point.online === false || row.member.online === false) return '离线'
  if (!autoRefresh.value) return '已暂停'
  const frame = soundFrames.value[row.key]
  return frame ? now.value - frame.receivedAt > 10000 ? '未更新' : '实时' : soundStatus.value
}
function collectorIp(row) {
  const collectors = row.member.raw?.collectors || []
  const collector = collectors.find(item => item.collectorId === row.point.collectorId)
  return collector?.ip || (collectors.length === 1 ? collectors[0].ip : '')
}
function fanGroupOf(row) {
  if (row.member.source === 'legacy' && row.member.id === 'VSE03') {
    const suffix = row.point.pointCode?.match(/_v_(\d+)$/)?.[1]
    if (['01', '02', '08', '09'].includes(suffix)) return 've'
    if (['03', '04', '10', '11'].includes(suffix)) return 'max'
  }
  if (row.member.source === 'legacy' && row.member.id === 'TEMP02') {
    if (['BEARING_TEMP_07', 'BEARING_TEMP_08'].includes(row.point.pointCode)) return 've'
    if (['BEARING_TEMP_09', 'BEARING_TEMP_10'].includes(row.point.pointCode)) return 'max'
  }
  if (row.member.source === 'monitor') {
    const ip = collectorIp(row)
    if (ip === '192.168.4.119') return 've'
    if (ip === '192.168.4.111') {
      const channel = `${row.point.channelId || ''} ${row.point.channelName || row.point.name || ''}`
      return /(?:CH(?:ANNEL)?[-_ ]?0?1\b|通道\s*1\b)/i.test(channel) ? 've' : 'max'
    }
  }
  return ''
}
const isFanLayout = computed(() => activeMachineId.value === 'ZJ117')
const isZb25Layout = computed(() => activeMachineId.value === 'ZB25')
const fanGroups = computed(() => [
  { id: 've', title: 'VE 风机', rows: displayRows.value.filter(row => fanGroupOf(row) === 've') },
  { id: 'max', title: 'MAX 风机', rows: displayRows.value.filter(row => fanGroupOf(row) === 'max') },
].filter(group => group.rows.length))
const pressureRows = computed(() => isFanLayout.value ? displayRows.value.filter(row => row.category === 'pressure') : [])
const fanRemainderRows = computed(() => isFanLayout.value ? displayRows.value.filter(row => !fanGroupOf(row) && row.category !== 'pressure') : [])
const zb25PressureRows = computed(() => isZb25Layout.value ? displayRows.value.filter(row => row.category === 'pressure') : [])
const zb25Rows = computed(() => {
  if (!isZb25Layout.value) return []
  const rows = displayRows.value.filter(row => row.category !== 'pressure')
  const mainParameters = rows.filter(row => row.combined?.moduleId === 'SC01')
  const motorDrive = rows.filter(row => row.member.id === 'VSE04' && row.point.pointCode === 'SE04_v_01')
  const placed = new Set([...mainParameters, ...motorDrive].map(row => row.key))
  const ordered = [...mainParameters, ...rows.filter(row => !placed.has(row.key)), ...motorDrive]
  const motorDriveIndex = ordered.findIndex(row => motorDrive.some(motorRow => motorRow.key === row.key))
  const fourthRowSecondColumn = 13
  if (motorDriveIndex >= 0 && ordered.length > fourthRowSecondColumn) {
    ;[ordered[fourthRowSecondColumn], ordered[motorDriveIndex]] = [ordered[motorDriveIndex], ordered[fourthRowSecondColumn]]
  }
  return ordered
})

async function refresh({ reloadPoints = true } = {}) {
  if (refreshing.value || controller.signal.aborted) return
  refreshing.value = true
  try {
    await Promise.all([telemetry.refreshModules({ signal: controller.signal }), monitor.refresh({ signal: controller.signal }), telemetry.refreshLatest({ signal: controller.signal })])
    const activeModules = telemetry.modules || []
    const activeIds = new Set(activeModules.map(module => module.moduleId))
    for (const id of Object.keys(pointMap.value)) {
      if (!activeIds.has(id)) { delete pointMap.value[id]; delete pointErrors.value[id]; pointLoadedAt.delete(id) }
    }
    // Configuration changes slowly; automatic refresh reuses successful loads for five minutes.
    const modules = activeModules.filter(module => reloadPoints || !pointLoadedAt.has(module.moduleId) || Date.now() - pointLoadedAt.get(module.moduleId) >= 300000)
    for (let offset = 0; offset < modules.length && !controller.signal.aborted; offset += 2) {
      await Promise.all(modules.slice(offset, offset + 2).map(async module => {
        try {
          const result = await telemetryApi.getModulePoints(module.moduleId, { signal: controller.signal })
          if (controller.signal.aborted) return
          if (!Array.isArray(result?.points) || result.moduleId !== module.moduleId) throw new Error('点位返回格式不正确')
          // Home charts and counts include measurements only.
          pointMap.value[module.moduleId] = sortMonitoringPoints(result.points.filter(isMeasurementPoint))
          pointLoadedAt.set(module.moduleId, Date.now())
          delete pointErrors.value[module.moduleId]
        } catch (error) {
          if (!controller.signal.aborted) {
            pointLoadedAt.delete(module.moduleId)
            const reason = error.name === 'TimeoutError' ? '点位配置请求超时，已重试' : error.message || '点位获取失败'
            pointErrors.value[module.moduleId] = `${reason}。${pointMap.value[module.moduleId] ? '保留上次点位，稍后自动重试' : '稍后自动重试，也可点击刷新数据'}`
          }
        }
      }))
    }
  } finally { refreshing.value = false }
}
async function toggleLive(value) {
  if (!value) await preview.stop().catch(() => {})
  else await telemetry.refreshLatest({ signal: controller.signal })
}
onMounted(() => {
  soundTimer = window.setInterval(() => {
    const targets = soundTargets.value
    if (!targets.length) return
    if (targets.length > 1 || ['连接断开', '连接异常', '连接失败'].includes(soundStatus.value)) {
      soundTargetIndex = (soundTargetIndex + 1) % targets.length
      preview.setTarget(targets[soundTargetIndex]).catch(() => {})
    }
  }, 10000)
  refresh()
  sampleTimer = window.setInterval(() => {
    now.value = Date.now()
    if (autoRefresh.value) telemetry.refreshLatest({ signal: controller.signal })
  }, 2000)
  metadataTimer = window.setInterval(() => { if (autoRefresh.value) refresh({ reloadPoints: false }) }, 30000)
})
onBeforeUnmount(() => {
  window.clearInterval(soundTimer)
  preview.stop().catch(() => {})
  controller.abort()
  window.clearInterval(sampleTimer)
  window.clearInterval(metadataTimer)
  telemetry.clear()
  monitor.clear()
})
</script>

<template>
  <section class="page home-monitor" :class="{ paused: !autoRefresh }">
    <div class="station-bar">
    <nav class="machine-tabs" role="tablist" aria-label="选择监测设备">
      <button v-for="(machine, index) in machineData.groups" :id="'machine-tab-'+machine.id" :key="machine.id" role="tab" :aria-selected="activeMachineId === machine.id" :aria-controls="'machine-panel-'+machine.id" :tabindex="activeMachineId === machine.id ? 0 : -1" :class="{ active: activeMachineId === machine.id }" :disabled="switchingAcoustic" @click="selectMachine(machine.id)" @keydown="navigateTab($event, index)"><span class="tab-number">0{{ index + 1 }}</span><span class="tab-title"><strong>{{ machine.name }}</strong><small>{{ machineState(machine) }}</small></span><span class="tab-dot" :class="{ online: machineState(machine) === '采集在线', warning: ['部分离线', '采集离线'].includes(machineState(machine)) }"></span></button>
    </nav>
    <div class="station-actions"><span class="refresh-indicator"><i></i>{{ autoRefresh ? '实时' : '暂停' }} · {{ currentTime }}</span><button class="plain-button view-settings" :aria-label="homeControlsExpanded ? '隐藏设置' : '显示设置'" :title="homeControlsExpanded ? '隐藏设置' : '显示设置'" :aria-expanded="homeControlsExpanded" @click="homeControlsExpanded = !homeControlsExpanded"><EyeOff v-if="homeControlsExpanded" :size="18"/><Eye v-else :size="18"/></button><el-button :icon="RefreshCw" :loading="refreshing" @click="refresh">刷新</el-button></div>
    </div>
    <div v-if="homeControlsExpanded" class="home-controls"><label><Search :size="16"/><input v-model="search" aria-label="搜索当前设备点位" placeholder="搜索当前设备点位" /></label><select v-model="source" aria-label="点位来源"><option value="all">全部点位</option><option value="legacy">数值监测</option><option value="monitor">声纹通道</option></select><el-switch v-model="autoRefresh" aria-label="自动刷新" @change="toggleLive" /><span>自动刷新</span></div>
    <p v-if="telemetry.errors.modules || telemetry.errors.latest || monitor.error" class="home-warning" role="alert">{{ [telemetry.errors.modules, telemetry.errors.latest, monitor.error].filter(Boolean).join('；') }}。保留最近数据，请留意采样时间。</p>
    <Transition name="machine-fade" mode="out-in">
      <main :id="'machine-panel-'+activeMachineId" :key="activeMachineId" role="tabpanel" :aria-labelledby="'machine-tab-'+activeMachineId" class="machine-panel">
        <header class="device-summary"><span>{{ activeMachine.pointCount }} 个点位 · 声纹 {{ acousticCount }} 路 <b v-if="staleCount">· {{ staleCount }} 个未更新</b></span><span>{{ historyLoading ? '正在载入最近10分钟采样…' : '最近300个真实采样 · 新数据滚动替换' }}</span><RouterLink :to="{ path: '/device', query: { machine: activeMachineId } }">设备详情 ↗</RouterLink></header>
        <p v-if="historyFailed" class="home-warning">部分历史采样未加载，暂显示已收到的数据。<button @click="retryHistory">重试历史</button></p>
        <p v-for="error in activeErrors" :key="error" class="home-warning">{{ error }}</p>
        <div v-if="isFanLayout" class="fan-layout">
          <section v-for="group in fanGroups" :key="group.id" class="fan-group" :class="group.id">
            <header class="fan-group-heading"><h2>{{ group.title }}</h2><span>{{ group.rows.length }} 个监测点</span></header>
            <div class="fan-grid"><HomeMonitorTile v-for="row in group.rows" :key="row.key" :row="row" :buffers="telemetry.buffers" :now="now" :paused="!autoRefresh" :sound-status="soundStatus" @details="openDeviceDialog" /></div>
          </section>
          <section v-if="pressureRows.length" class="pressure-span">
            <header class="fan-group-heading pressure-heading"><h2>负压监测</h2><span>{{ pressureRows.length }} 个点位</span></header>
            <div class="pressure-grid"><HomeMonitorTile v-for="row in pressureRows" :key="row.key" :row="row" :buffers="telemetry.buffers" :now="now" :paused="!autoRefresh" :sound-status="soundStatus" @details="openDeviceDialog" /></div>
          </section>
          <div v-if="fanRemainderRows.length" class="monitor-grid"><HomeMonitorTile v-for="row in fanRemainderRows" :key="row.key" :row="row" :buffers="telemetry.buffers" :now="now" :paused="!autoRefresh" :sound-status="soundStatus" @details="openDeviceDialog" /></div>
        </div>
        <div v-else-if="isZb25Layout" class="zb25-layout">
          <div class="monitor-grid zb25-grid"><HomeMonitorTile v-for="row in zb25Rows" :key="row.key" :row="row" :buffers="telemetry.buffers" :now="now" :paused="!autoRefresh" :sound-status="soundStatus" @details="openDeviceDialog" /></div>
          <section v-if="zb25PressureRows.length" class="zb25-pressure-span">
            <header class="fan-group-heading pressure-heading"><h2>负压监测</h2><span>{{ zb25PressureRows.length }} 个点位</span></header>
            <div class="pressure-grid"><HomeMonitorTile v-for="row in zb25PressureRows" :key="row.key" :row="row" :buffers="telemetry.buffers" :now="now" :paused="!autoRefresh" :sound-status="soundStatus" @details="openDeviceDialog" /></div>
          </section>
        </div>
        <div v-else class="monitor-grid"><HomeMonitorTile v-for="row in displayRows" :key="row.key" :row="row" :buffers="telemetry.buffers" :now="now" :paused="!autoRefresh" :sound-status="soundStatus" @details="openDeviceDialog" /></div>
        <div v-if="!displayRows.length" class="home-empty"><Activity :size="32"/><h3>{{ refreshing ? '正在加载监测点位' : '暂无可展示的点位' }}</h3><p>{{ search || source !== 'all' ? '请调整筛选条件。' : '点位配置获取成功后会自动展示。' }}</p></div>
      </main>
    </Transition>
    <aside v-if="machineData.pending.members.length" class="pending-note">另有 {{ machineData.pending.members.length }} 个采集来源待确认归属 <RouterLink :to="{ path: '/device', query: { machine: 'pending' } }">查看 ↗</RouterLink></aside>
    <el-dialog v-model="dialogOpen" :before-close="closeDeviceDialog" :title="dialogDevice?.name || '设备详情'" width="94vw" top="3vh" class="home-device-dialog" append-to-body append-to=".dashboard-shell" destroy-on-close>
      <HomeDeviceDialog ref="deviceDialog" v-if="dialogDevice && dialogOpen" :key="dialogDevice.key" :device="dialogDevice" :buffers="telemetry.buffers" :now="now" :paused="!autoRefresh" :error="dialogDevice.source === 'legacy' ? pointErrors[dialogDevice.id] || telemetry.errors.latest || telemetry.errors.modules : monitor.error" />
    </el-dialog>
  </section>
</template>

<style scoped>
.home-monitor { --wall-text: var(--text-main); --wall-muted: var(--text-muted); --wall-line: var(--glass-border); --wall-point: transparent; padding: 24px 28px; overflow-y: auto; color: var(--text-main); background: var(--page-bg); display: flex; flex-direction: column; gap: 22px; }
h1,h2,h3,h4,p { margin: 0; } button, a, input, select { -webkit-tap-highlight-color: transparent; } button { cursor: pointer; } button:disabled { cursor: default; opacity: .5; } button:focus-visible, a:focus-visible { outline: 2px solid #368ce8; outline-offset: 3px; }
a { color: var(--text-soft); text-decoration: none; }.home-topbar, .top-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }.eyebrow { font-size: 11px; letter-spacing: 2px; color: var(--text-muted); }.home-topbar h1 { margin-top: 5px; font-size: 26px; font-weight: 600; }.refresh-indicator { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums; }.refresh-indicator i { width: 6px; height: 6px; border-radius: 50%; background: #18a99a; animation: breathe 2.8s ease-in-out infinite; }.paused .refresh-indicator i { animation: none; background: var(--text-muted); }
.plain-button { background: transparent; color: var(--text-muted); border: 0; padding: 8px; }
.machine-tabs { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 14px; }.machine-tabs button { position: relative; text-align: left; display: flex; align-items: center; gap: 16px; padding: 20px; color: var(--text-main); background: var(--glass-card); border: 1px solid var(--glass-border); border-radius: 12px; transition: background .2s, border-color .2s, transform .2s; overflow: hidden; }.machine-tabs button:hover { transform: translateY(-2px); border-color: var(--control-border-active); }.machine-tabs button.active { background: linear-gradient(110deg,#368ce815,transparent), var(--glass-card); border-color: #368ce8; }.machine-tabs button::after { content:''; position:absolute; bottom:0; left:20px; right:20px; height:3px; background:#368ce8; transform:scaleX(0); transition:transform .25s; }.machine-tabs button.active::after { transform:scaleX(1); }.tab-number { font-size:26px; font-weight:300; color:var(--text-muted); opacity:.55; }.active .tab-number { color:#368ce8; opacity:1; }.tab-title { display:grid; gap:7px; }.tab-title strong { font-size:18px; font-weight:600; }.tab-title small { font-size:12px; color:var(--text-muted); }.tab-dot { margin-left:auto; flex:none; width:7px; height:7px; border-radius:50%; background:var(--text-muted); }.tab-dot.online { background:#18a99a; }.tab-dot.warning { background:#db8b2b; }
.home-controls { display:flex; flex-wrap:wrap; align-items:center; gap:12px; font-size:13px; color:var(--text-muted); }.home-controls label { display:flex; align-items:center; gap:8px; }.home-controls input,.home-controls select { color:var(--text-main); background:var(--glass-card); border:1px solid var(--glass-border); border-radius:6px; padding:9px 12px; }
.device-summary { display:flex; align-items:center; flex-wrap:wrap; gap:24px; margin-bottom:26px; }.device-summary h2 { font-size:22px; }.device-summary p { font-size:12px; color:var(--text-muted); margin-top:8px; }.device-summary > a { margin-left:auto; font-size:13px; }.summary-values { display:flex; gap:32px; margin-left:auto; }.summary-values > div { display:grid; gap:4px; }.summary-values strong { font-size:26px; font-weight:600; font-variant-numeric:tabular-nums; }.summary-values span { color:var(--text-muted); font-size:11px; }.summary-values .attention strong { color:#db8b2b; }
.metric-section { margin-bottom:26px; }.section-heading { display:flex; align-items:center; gap:10px; margin-bottom:14px; }.category-icon { color:var(--category-color); display:grid; place-items:center; background:color-mix(in srgb,var(--category-color) 12%,transparent); width:32px; height:32px; border-radius:9px; }.section-heading h3 { font-size:16px; font-weight:600; }.section-count { color:var(--text-muted); font-size:12px; }.heading-line { height:1px; background:var(--glass-border); flex:1; margin-left:6px; }
.point-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }.point-grid.sparse { grid-template-columns:repeat(2,minmax(0,1fr)); }.point-grid.acoustic { grid-template-columns:repeat(3,minmax(0,1fr)); }.point-tile { min-width:0; background:var(--glass-card); border:1px solid var(--glass-border); border-radius:12px; overflow:hidden; transition:border-color .2s, box-shadow .2s, transform .2s; }.point-tile:hover { border-color:color-mix(in srgb,var(--category-color) 50%,var(--glass-border)); transform:translateY(-2px); box-shadow:0 8px 24px #0000000c; }.point-context { padding:12px 16px 0; display:flex; align-items:center; justify-content:space-between; gap:10px; color:var(--text-muted); font-size:11px; }.point-context > span { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }.point-context button { border:0; background:transparent; color:var(--text-muted); white-space:nowrap; font-size:11px; padding:4px 0; }
.point-tile :deep(.home-point.compact) { padding:10px 16px 14px; border:0; background:transparent; grid-template-columns:minmax(0,1fr); grid-template-rows:auto auto 72px; gap:9px; }.point-tile :deep(.compact header) { grid-column:1; grid-row:1; align-items:start; gap:8px; }.point-tile :deep(.compact h3) { font-size:14px; line-height:21px; min-height:42px; }.point-tile :deep(.compact header span) { margin-top:3px; font-size:10px; }.point-tile :deep(.compact .home-point-value) { grid-column:1; grid-row:2; height:auto; margin:0; flex-wrap:wrap; gap:7px; }.point-tile :deep(.compact .home-point-value strong) { font-size:34px; font-weight:600; letter-spacing:-1px; animation:none; }.point-tile :deep(.compact .home-point-value small) { font-size:12px; }.point-tile :deep(.compact .home-point-chart) { grid-column:1; grid-row:3; width:100%; height:72px; }.point-grid.sparse :deep(.home-point.compact) { grid-template-rows:auto auto 104px; }.point-grid.sparse :deep(.compact .home-point-chart) { height:104px; }
.acoustic-tile { padding:12px 16px 16px; }.acoustic-tile header { display:flex; gap:10px; justify-content:space-between; }.acoustic-tile h4 { font-size:15px; line-height:1.5; }.acoustic-tile header span { color:var(--text-muted); font-size:11px; white-space:nowrap; }.sound-placeholder { display:flex; gap:12px; align-items:center; justify-content:center; height:92px; color:var(--category-color); }.sound-placeholder span { color:var(--text-muted); font-size:12px; }.acoustic-tile > button { width:100%; min-height:38px; border:1px solid var(--glass-border); background:var(--control-bg); color:var(--text-soft); border-radius:7px; }.point-tile :deep(.acoustic-point-card) { border:0; background:transparent; }.home-warning { color:#c68733; background:#db8b2b0a; border:1px solid #db8b2b35; padding:12px 16px; border-radius:8px; font-size:13px; margin-bottom:12px; }.home-empty { padding:60px 20px; display:grid; justify-items:center; gap:14px; color:var(--text-muted); }.pending-note { font-size:12px; color:var(--text-muted); padding:12px 0; }.pending-note a { margin-left:16px; }
.machine-fade-enter-active,.machine-fade-leave-active { transition:opacity .18s,transform .18s; }.machine-fade-enter-from { opacity:0; transform:translateY(8px); }.machine-fade-leave-to { opacity:0; transform:translateY(-4px); }@keyframes breathe { 50% { opacity:.45; } }
:global(.home-device-dialog.el-dialog) { height:94vh; display:flex; flex-direction:column; margin-bottom:0; background:var(--page-bg); color:var(--text-main); border:1px solid var(--control-border-active); border-radius:12px; }:global(.home-device-dialog .el-dialog__body) { flex:1; min-height:0; overflow-y:auto; }:global(.home-device-dialog .el-dialog__title) { color:var(--text-main); }
@media(min-width:1800px) { .point-grid { grid-template-columns:repeat(5,minmax(0,1fr)); } }
@media(max-width:1150px) { .point-grid { grid-template-columns:repeat(3,minmax(0,1fr)); }.machine-tabs button { padding:16px 12px; gap:10px; }.tab-title strong { font-size:16px; }.tab-number { font-size:20px; }.point-grid.acoustic { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:800px) { .home-monitor { padding:18px; }.point-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.home-topbar { flex-wrap:wrap; }.tab-number { display:none; }.tab-title strong { font-size:14px; }.machine-tabs { gap:8px; }.tab-dot { display:none; }.summary-values { gap:22px; }.device-summary { gap:16px; } }
@media(max-width:520px) { .home-monitor { padding:12px; }.point-grid,.point-grid.sparse,.point-grid.acoustic { grid-template-columns:minmax(0,1fr); }.tab-title strong { font-size:12px; }.tab-title small { font-size:10px; }.machine-tabs button { padding:14px 8px; }.top-actions { gap:8px; flex-wrap:wrap; }.summary-values { margin-left:0; }.device-summary > a { margin-left:0; }.refresh-indicator { font-size:11px; } }
@media(prefers-reduced-motion:reduce) { *, *::before, *::after { animation:none!important; transition:none!important; } .point-tile:hover,.machine-tabs button:hover { transform:none; } }
/* Dense industrial overview: tabs occupy the first row, measurements use the rest. */
.home-monitor { padding: 8px 14px 12px; gap: 10px; }
.station-bar { display:flex; align-items:center; gap:20px; flex:none; position:sticky; top:-8px; z-index:10; background:var(--page-bg); padding:4px 0 8px; border-bottom:1px solid var(--glass-border); }
.station-bar .machine-tabs { flex:1; gap:8px; }
.station-bar .machine-tabs button { padding:10px 16px; border-radius:6px; gap:10px; }
.station-bar .tab-number { display:none; }
.station-bar .tab-title { display:flex; align-items:center; gap:14px; }
.station-bar .tab-title strong { font-size:16px; }
.station-bar .tab-title small { font-size:11px; }
.station-actions { display:flex; align-items:center; gap:10px; }
.station-actions .view-settings { display:grid; place-items:center; padding:8px; border-radius:6px; }
.station-actions .view-settings:hover { color:var(--text-main); background:var(--glass-card); }
.machine-panel { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px 16px; align-content:start; }
.device-summary,.machine-panel > .home-warning,.machine-panel > .home-empty { grid-column:1 / -1; }
.device-summary { gap:20px; margin:0; font-size:11px; color:var(--text-muted); }
.device-summary b { color:#db8b2b; font-weight:500; }
.device-summary > a { font-size:11px; }
.metric-section { margin:0; min-width:0; }
.metric-section.wide-section { grid-column:1 / -1; }
.section-heading { gap:7px; margin-bottom:7px; }
.category-icon { width:23px; height:23px; border-radius:5px; }
.section-heading h3 { font-size:13px; }.section-count { font-size:10px; }
.point-grid,.point-grid.sparse,.point-grid.acoustic { grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
.wide-section .point-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }
.point-grid.sparse { grid-template-columns:repeat(2,minmax(0,1fr)); }
.point-tile { border-radius:6px; }.point-tile:hover { transform:none; }
.point-context { padding:8px 14px 0; font-size:11px; }.point-context button { padding:0; font-size:11px; }
.point-tile :deep(.home-point.compact),.point-grid.sparse :deep(.home-point.compact) { padding:6px 14px 10px; grid-template-columns:minmax(82px,.85fr) minmax(90px,1.15fr); grid-template-rows:minmax(28px,auto) 66px; column-gap:8px; row-gap:4px; }
.point-tile :deep(.compact header) { grid-column:1 / -1; grid-row:1; align-items:center; }
.point-tile :deep(.compact h3) { font-size:14px; line-height:21px; min-height:0; }
.point-tile :deep(.compact .home-point-value) { grid-column:1; grid-row:2; align-self:center; margin:0; height:auto; flex-wrap:wrap; gap:4px; }
.point-tile :deep(.compact header span) { font-size:11px; }
.point-tile :deep(.compact .home-point-value strong) { font-size:30px; }
.point-tile :deep(.compact .home-point-value small) { font-size:11px; }
.point-tile :deep(.compact .home-point-chart),.point-grid.sparse :deep(.compact .home-point-chart) { grid-column:2; grid-row:2; width:100%; height:66px; align-self:center; }
.acoustic-tile { padding:12px 14px; }.acoustic-tile h4 { font-size:14px; }.sound-placeholder { height:80px; gap:10px; }.sound-placeholder svg { width:30px; }.sound-placeholder span { font-size:12px; }.acoustic-tile > button { min-height:34px; font-size:13px; }.point-tile :deep(.compact-waveform) { height:80px; }
.machine-fade-enter-active,.machine-fade-leave-active { transition:opacity .1s; }
.machine-fade-enter-from,.machine-fade-leave-to { transform:none; }
@media(max-width:1200px) { .station-bar { flex-wrap:wrap; gap:6px; }.station-bar .machine-tabs { flex-basis:100%; }.station-actions { margin-left:auto; }.station-bar .tab-title { display:grid; gap:3px; }.wide-section .point-grid { grid-template-columns:repeat(4,minmax(0,1fr)); }.point-grid,.point-grid.acoustic { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:650px) { .machine-panel { grid-template-columns:minmax(0,1fr); }.wide-section .point-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.station-bar .machine-tabs button { padding:9px 6px; }.station-bar .tab-title strong { font-size:12px; }.device-summary { gap:8px; } }
.monitor-grid { grid-column:1 / -1; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; align-items:stretch; }
.fan-layout { grid-column:1 / -1; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; align-items:start; }
.fan-group { min-width:0; padding:10px; border:1px solid color-mix(in srgb,#368ce8 28%,var(--glass-border)); border-radius:8px; background:color-mix(in srgb,#368ce8 3%,transparent); }
.fan-group.max { border-color:color-mix(in srgb,#18a99a 30%,var(--glass-border)); background:color-mix(in srgb,#18a99a 3%,transparent); }
.fan-group-heading { display:flex; align-items:center; gap:10px; margin:0 0 10px; padding:0 2px 8px; border-bottom:1px solid var(--glass-border); }
.fan-group-heading h2 { color:var(--text-main); font-size:15px; font-weight:600; }
.fan-group-heading span { color:var(--text-muted); font-size:11px; }
.fan-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.pressure-span { grid-column:1 / -1; min-width:0; }
.pressure-heading { margin-bottom:8px; }.pressure-grid { display:grid; grid-template-columns:minmax(0,1fr); }
.pressure-grid .point-tile { min-height:210px; }
.pressure-grid .point-tile :deep(.home-point.compact) { grid-template-columns:minmax(160px,17%) minmax(0,1fr); grid-template-rows:minmax(28px,auto) 126px; }
.pressure-grid .point-tile :deep(.compact .home-point-chart) { height:126px; }
.zb25-layout { grid-column:1 / -1; min-width:0; display:grid; gap:12px; }
.zb25-layout .zb25-grid { position:relative; grid-template-columns:repeat(4,minmax(0,1fr)); padding:32px 10px 10px; isolation:isolate; }
.zb25-grid::before,.zb25-grid::after { position:absolute; top:0; bottom:0; z-index:-1; width:calc(50% - 7px); box-sizing:border-box; padding:8px 12px; border:1px solid color-mix(in srgb,#368ce8 34%,var(--glass-border)); border-radius:8px; background:color-mix(in srgb,#368ce8 3%,transparent); color:var(--text-muted); font-size:13px; font-weight:600; pointer-events:none; }
.zb25-grid::before { left:0; content:'主电机'; }
.zb25-grid::after { right:0; content:'其他'; border-color:color-mix(in srgb,#18a99a 34%,var(--glass-border)); background:color-mix(in srgb,#18a99a 3%,transparent); }
.zb25-pressure-span { min-width:0; }
.point-context > span { display:flex; align-items:center; gap:6px; }
.point-context i { width:6px; height:6px; flex:none; border-radius:50%; background:var(--category-color); }
@media(max-width:1100px) { .monitor-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media(max-width:800px) { .monitor-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:650px) { .fan-layout { grid-template-columns:minmax(0,1fr); }.pressure-span { grid-column:1; }.zb25-layout .zb25-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.zb25-grid::before,.zb25-grid::after { width:calc(50% - 6px); } }
@media(max-width:480px) { .zb25-layout .zb25-grid { grid-template-columns:minmax(0,1fr); }.zb25-grid::before,.zb25-grid::after { width:100%; }.zb25-grid::after { display:none; } }
@media(max-width:800px) { .pressure-grid .point-tile :deep(.home-point.compact) { grid-template-columns:minmax(120px,34%) minmax(0,1fr); } }
@media(max-width:480px) { .monitor-grid,.fan-grid { grid-template-columns:minmax(0,1fr); } }
</style>
