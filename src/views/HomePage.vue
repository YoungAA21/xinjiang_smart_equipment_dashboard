<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Activity, Search, RefreshCw, Radio, Server, Wifi } from 'lucide-vue-next'
import EquipmentVisual from '../components/EquipmentVisual.vue'
import HomePointCard from '../components/HomePointCard.vue'
import SpectrumPage from './SpectrumPage.vue'
import { useTelemetryStore } from '../stores/telemetry'
import { useHomeDevicesStore } from '../stores/homeDevices'
import { telemetryApi } from '../services/telemetry'
import { pointKey } from '../charts/telemetry'
import { isVibrationPoint, moduleDisplayName, sortMonitoringModules, sortMonitoringPoints } from '../charts/equipmentCatalog.js'

const telemetry = useTelemetryStore()
const monitor = useHomeDevicesStore()
const pointMap = ref({})
const pointErrors = ref({})
const search = ref('')
const source = ref('all')
const autoRefresh = ref(true)
const refreshing = ref(false)
const now = ref(Date.now())
const activeAcoustic = ref('')
const switchingAcoustic = ref(false)
const acousticPanel = ref(null)
const controller = new AbortController()
let sampleTimer, metadataTimer
const colors = ['#39a9ff', '#ff9800', '#00c875']
const devices = computed(() => [
  ...sortMonitoringModules(telemetry.modules || []).map(module => ({ key: JSON.stringify(['legacy', module.moduleId]), source: 'legacy', id: module.moduleId, name: moduleDisplayName(module), online: module.runtimeStatus?.isOnline, points: pointMap.value[module.moduleId] || [], raw: module })),
  ...(monitor.devices || []).map(device => ({ key: JSON.stringify(['monitor', device.deviceId]), source: 'monitor', id: device.deviceId, name: device.deviceName || device.deviceId, online: device.online, points: device.channels || [], raw: device })),
])
const visibleDevices = computed(() => devices.value.filter(device => (source.value === 'all' || device.source === source.value) && `${device.name} ${device.id}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const onlineCount = computed(() => devices.value.filter(device => device.online === true).length)
const offlineCount = computed(() => devices.value.filter(device => device.online === false).length)
const unknownCount = computed(() => devices.value.filter(device => device.online !== true && device.online !== false).length)
const pointCount = computed(() => devices.value.reduce((total, device) => total + device.points.length, 0))
const hasData = computed(() => telemetry.modules !== null || monitor.devices !== null)
const currentTime = computed(() => new Date(now.value).toLocaleString('zh-CN', { hour12: false }))
const connectionKey = (device, channel) => JSON.stringify([device.id, channel.channelId])
const pointGroups = points => {
  if (points.length <= 1) return [{ points, offset: 0 }]
  const midpoint = Math.ceil(points.length / 2)
  return [{ points: points.slice(0, midpoint), offset: 0 }, { points: points.slice(midpoint), offset: midpoint }]
}
const stateText = online => online === true ? '在线' : online === false ? '离线' : '状态未知'

async function refresh() {
  if (refreshing.value || controller.signal.aborted) return
  refreshing.value = true
  try {
    await Promise.all([telemetry.refreshModules({ signal: controller.signal }), monitor.refresh({ signal: controller.signal }), telemetry.refreshLatest({ signal: controller.signal })])
    const modules = telemetry.modules || []
    for (let offset = 0; offset < modules.length && !controller.signal.aborted; offset += 4) {
      await Promise.all(modules.slice(offset, offset + 4).map(async module => {
        try {
          const result = await telemetryApi.getModulePoints(module.moduleId, { signal: controller.signal })
          if (controller.signal.aborted) return
          if (!Array.isArray(result?.points) || result.moduleId !== module.moduleId) throw new Error('点位返回格式不正确')
          pointMap.value[module.moduleId] = sortMonitoringPoints(result.points)
          delete pointErrors.value[module.moduleId]
        } catch (error) {
          if (!controller.signal.aborted) pointErrors.value[module.moduleId] = error.message || '点位获取失败'
        }
      }))
    }
  } finally { refreshing.value = false }
}
async function selectAcoustic(device, channel) {
  if (switchingAcoustic.value || controller.signal.aborted) return
  switchingAcoustic.value = true
  try {
    // The monitor service grants one session per user. Close it before switching.
    await acousticPanel.value?.[0]?.stopSession()
    if (!controller.signal.aborted) activeAcoustic.value = connectionKey(device, channel)
  } finally { switchingAcoustic.value = false }
}
async function toggleLive(value) {
  if (!value) {
    await acousticPanel.value?.[0]?.stopSession()
    activeAcoustic.value = ''
  } else await telemetry.refreshLatest({ signal: controller.signal })
}
onMounted(() => {
  refresh()
  sampleTimer = window.setInterval(() => {
    now.value = Date.now()
    if (autoRefresh.value) telemetry.refreshLatest({ signal: controller.signal })
  }, 2000)
  metadataTimer = window.setInterval(() => { if (autoRefresh.value) refresh() }, 30000)
})
onBeforeUnmount(() => {
  controller.abort()
  window.clearInterval(sampleTimer)
  window.clearInterval(metadataTimer)
  telemetry.clear()
  monitor.clear()
})
</script>

<template>
  <section class="page live-wall spatial-view" :class="{ 'is-paused': !autoRefresh }">
    <header class="wall-heading">
      <div><span class="wall-eyebrow">REALTIME EQUIPMENT CENTER</span><h1>设备实时监测中心 <span class="wall-live"><i></i>{{ autoRefresh ? 'LIVE' : 'PAUSED' }}</span></h1><p>全域设备 · 多点位感知 · 实时运行态势</p></div>
      <div class="wall-actions"><time>{{ currentTime }}</time><div><el-switch v-model="autoRefresh" aria-label="首页实时刷新" @change="toggleLive" /><span>实时刷新</span><el-button :icon="RefreshCw" :loading="refreshing" @click="refresh">刷新数据</el-button></div></div>
    </header>
    <section class="wall-metrics" aria-label="实时监测概览">
      <article><Server :size="23" /><div><span>接入设备</span><strong>{{ hasData ? devices.length : '—' }}<small>台</small></strong></div><b>01</b></article>
      <article><Wifi :size="23" /><div><span>在线设备</span><strong class="green">{{ hasData ? onlineCount : '—' }}<small>台</small></strong></div><b>02</b></article>
      <article><Radio :size="23" /><div><span>已加载监测点位</span><strong>{{ hasData ? pointCount : '—' }}<small>个</small></strong></div><b>03</b></article>
      <article><Activity :size="23" /><div><span>离线设备</span><strong class="orange">{{ hasData ? offlineCount : '—' }}<small>台</small></strong></div><span class="unknown-note">未知 {{ unknownCount }}</span><b>04</b></article>
    </section>
    <div v-if="telemetry.errors.modules || telemetry.errors.latest || monitor.error" class="wall-error" role="alert"><span v-if="telemetry.errors.modules">设备列表：{{ telemetry.errors.modules }}。</span><span v-if="telemetry.errors.latest">实时采样：{{ telemetry.errors.latest }}。</span><span v-if="monitor.error">声纹设备：{{ monitor.error }}。</span>保留最近成功数据，请留意采样时间。</div>
    <div class="wall-controls"><div role="group" aria-label="首页设备来源"><button v-for="item in [{id:'all',label:'全部设备'}, {id:'legacy',label:'采集模块'}, {id:'monitor',label:'声纹设备'}]" :key="item.id" :class="{active: source === item.id}" :aria-pressed="source === item.id" @click="source = item.id">{{ item.label }}</button></div><label><Search :size="16" /><input v-model="search" aria-label="搜索设备名称或编号" placeholder="搜索设备名称 / 编号" /></label><span>{{ visibleDevices.length }} 台设备 · 2 秒更新</span></div>
    <div class="wall-device-grid">
      <article v-for="(device, deviceIndex) in visibleDevices" :key="device.key" class="wall-device" :style="{ '--entry-delay': Math.min(deviceIndex, 6) * 70 + 'ms' }">
        <header class="module-stage-header">
          <div class="module-topline"><span>{{ device.source === 'legacy' ? '采集模块' : '声纹设备' }} / {{ device.id }}</span><RouterLink :to="{ path:'/device/detail', query:{source:device.source, device:device.id, tab:'live'} }" :aria-label="'查看' + device.name + '详情'">详情 ↗</RouterLink></div>
          <div class="module-stage"><div class="stage-orbit" aria-hidden="true"></div><EquipmentVisual class="stage-equipment" :name="device.name" :source="device.source" :device-id="device.id" /><div class="stage-plinth" aria-hidden="true"></div></div>
          <div class="module-caption"><h2 :title="device.name">{{ device.name }}</h2><p><span class="module-state" :class="device.online === true ? 'online' : device.online === false ? 'offline' : ''"><i></i>{{ stateText(device.online) }}</span><span>{{ device.points.length }} 个点位</span><span v-if="device.source === 'legacy' && device.points.some(isVibrationPoint)">振动 {{ device.points.filter(isVibrationPoint).length }} 项</span><span v-else>{{ device.source === 'legacy' ? device.raw.protocol || '采集模块' : '声纹采集' }}</span></p></div>
        </header>
        <div class="parameter-heading"><span>实时点位 <b>{{ device.points.length }}</b></span><span>{{ device.points.length > 4 ? '上下滚动查看全部 ↓' : '独立采样 · 实时曲线' }}</span></div>
        <div class="parameter-viewport" tabindex="0" role="region" :aria-label="device.name + '实时点位，可上下滚动'" :class="{ 'single-point': device.points.length === 1, 'few-points': device.points.length <= 2 }">
        <div v-if="pointErrors[device.id] && device.source === 'legacy'" class="wall-error" role="alert">{{ pointErrors[device.id] }}</div>
        <div class="wall-points module-parameters">
          <div v-for="(group, groupIndex) in pointGroups(device.points)" :key="groupIndex" class="parameter-column" :aria-label="groupIndex === 0 ? '左侧参数' : '右侧参数'">
          <template v-if="device.source === 'legacy'"><HomePointCard compact v-for="(point, index) in group.points" :key="pointKey(point)" :point="point" :samples="telemetry.buffers[pointKey(point)] || []" :color="colors[(group.offset + index) % colors.length]" :now="now" :paused="!autoRefresh" /></template>
          <template v-else><template v-for="(channel, index) in group.points" :key="connectionKey(device, channel)">
            <SpectrumPage v-if="activeAcoustic === connectionKey(device, channel)" ref="acousticPanel" embedded compact :device="device.raw" :channel-id="channel.channelId" :accent-color="colors[(group.offset + index) % colors.length]" display-mode="live" />
            <section v-else class="wall-acoustic-point"><header><h3>{{ channel.name || channel.channelName || channel.channelId }}</h3><span>{{ stateText(channel.online) }}</span></header><strong>— <small>波形 RMS</small></strong><div class="acoustic-placeholder"><Activity :size="30" /><span>{{ channel.online === false ? '点位离线' : '连接后显示实时波形' }}</span></div><button :disabled="!autoRefresh || channel.online !== true || device.online === false || switchingAcoustic" @click="selectAcoustic(device, channel)">监听此点位 →</button></section>
          </template></template>
          </div>
        </div>
        <p v-if="!device.points.length" class="wall-empty">{{ refreshing ? '正在加载点位…' : '该设备暂无监测点位' }}</p>
        </div>
        <footer class="wall-device-footer"><span class="signal-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>{{ device.source === 'legacy' ? '各点位独立采样 · 最近 300 个时间点' : '声纹实时监听 · 同时监听一个点位' }}</span><span>{{ autoRefresh ? '实时监测' : '刷新已暂停' }}</span></footer>
      </article>
    </div>
    <div v-if="!visibleDevices.length" class="wall-empty"><Server :size="34" /><p>{{ refreshing ? '正在加载设备…' : '暂无匹配设备，请调整筛选或刷新重试' }}</p></div>
    <footer class="wall-footer"><span><i></i>设备状态与采样时间独立展示</span><span>蓝 · 橙 · 绿 / 多点位实时趋势</span></footer>
  </section>
</template>

<style scoped>
.live-wall { --wall-text: var(--text-main); --wall-muted: var(--text-muted); --wall-line: var(--glass-border); --wall-point: var(--glass-card-soft); --wall-card: var(--glass-card); --wall-accent: #8ee6a8; padding: 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; background: var(--page-bg); color: var(--wall-text); }
.wall-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--wall-line); position: relative; }
.wall-heading::after { content: ''; position: absolute; bottom: -1px; left: 0; width: 120px; height: 2px; background: linear-gradient(90deg, transparent, var(--wall-accent), transparent); animation: heading-scan 9s ease-in-out infinite; }
.wall-eyebrow { font-size: 10px; letter-spacing: 4px; color: var(--text-soft); }.wall-heading h1 { display: flex; gap: 18px; align-items: center; font-size: 28px; font-weight: 500; letter-spacing: 2px; margin: 10px 0; }.wall-heading p { font-size: 12px; color: var(--wall-muted); margin: 0; letter-spacing: 2px; }
.wall-live { display: flex; gap: 7px; align-items: center; font-size: 10px; letter-spacing: 2px; color: var(--wall-accent); padding: 5px 9px; border: 1px solid var(--control-border-active); border-radius: 4px; }.wall-live i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: beacon 2s ease-out infinite; }
.wall-actions { display: grid; gap: 12px; justify-items: end; }.wall-actions time { color: var(--text-soft); font-size: 16px; font-variant-numeric: tabular-nums; letter-spacing: 1px; }.wall-actions > div { display: flex; align-items: center; gap: 9px; font-size: 12px; color: var(--wall-muted); }
.wall-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }.wall-metrics article { display: flex; align-items: center; gap: 20px; padding: 18px 22px; border: 1px solid var(--wall-line); background: linear-gradient(110deg, rgba(70, 144, 124, .07), transparent), var(--wall-card); border-radius: 7px; position: relative; overflow: hidden; }.wall-metrics article > svg { color: var(--wall-accent); }.wall-metrics article > b { position: absolute; right: 12px; top: 8px; color: var(--glass-border); font-size: 26px; font-weight: 400; }.wall-metrics article div > span { font-size: 12px; color: var(--wall-muted); }.wall-metrics strong { display: block; color: var(--text-soft); font-size: 34px; font-weight: 500; margin-top: 5px; font-variant-numeric: tabular-nums; }.wall-metrics small { font-size: 12px; margin-left: 8px; color: var(--wall-muted); }.wall-metrics .green { color: var(--wall-accent); }.wall-metrics .orange { color: #e4a260; }.unknown-note { margin-left: auto; color: var(--wall-muted); font-size: 11px; align-self: end; }
.wall-controls { display: flex; align-items: center; gap: 20px; }.wall-controls > div { display: flex; gap: 5px; }.wall-controls button { background: transparent; color: var(--wall-muted); border: 1px solid transparent; padding: 8px 16px; border-radius: 4px; font-size: 13px; }.wall-controls button.active { background: var(--control-bg-active); border-color: var(--control-border-active); color: var(--wall-accent); }.wall-controls label { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--wall-line); border-radius: 4px; color: var(--wall-muted); }.wall-controls input { background: transparent; color: var(--wall-text); border: 0; outline: none; font-size: 12px; width: 180px; }.wall-controls label:focus-within { border-color: var(--wall-accent); }.wall-controls > span { font-size: 11px; color: var(--wall-muted); margin-left: auto; }
.wall-device-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
.wall-device { min-width: 0; background: var(--wall-card); border: 1px solid var(--wall-line); border-radius: 9px; position: relative; overflow: hidden; box-shadow: inset 0 1px 0 var(--glass-highlight), 0 12px 30px #0002; animation: card-arrive .6s both; animation-delay: var(--entry-delay); transition: border-color .25s, box-shadow .25s; }.wall-device:hover { border-color: var(--control-border-active); box-shadow: 0 0 24px rgba(70, 144, 124, .08); }.wall-device::before { content: ''; position: absolute; top: 0; left: 0; width: 90px; height: 1px; background: linear-gradient(90deg, transparent, var(--wall-accent), transparent); animation: card-scan 8s linear infinite; animation-delay: var(--entry-delay); }
.wall-device-header { display: flex; align-items: center; gap: 12px; padding: 12px 18px 12px 10px; border-bottom: 1px solid var(--wall-line); }.wall-device .wall-device-photo { width: 100px; height: 82px; flex-shrink: 0; }.wall-device-photo :deep(.equipment-symbol) { padding: 8px; border-radius: 8px; }.wall-device-photo :deep(.equipment-symbol) { color: var(--text-soft); background: var(--glass-card); border-color: var(--glass-border); }
.wall-device-photo :deep(svg) { width: 42px; height: 42px; }.wall-device-photo :deep(.visual-baseline) { bottom: 0; }.wall-device-title { min-width: 0; flex: 1; }.wall-device-title > span { font-size: 10px; letter-spacing: 1px; color: var(--wall-muted); overflow-wrap: anywhere; }.wall-device-title h2 { font-size: 18px; margin: 6px 0 9px; font-weight: 500; overflow-wrap: anywhere; }.wall-device-title p { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--wall-muted); margin: 0; }.wall-device-title p > span { margin-left: 10px; }.wall-device-title i { width: 5px; height: 5px; border-radius: 50%; background: var(--text-muted); }.wall-device-title i.online { background: #00c875; box-shadow: 0 0 8px #00c87550; }.wall-device-title i.offline { background: #ff9800; }.wall-device-header > a { color: var(--wall-accent); text-decoration: none; font-size: 11px; white-space: nowrap; }
.wall-points { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding: 14px; }.wall-device-footer { display: flex; align-items: center; gap: 9px; padding: 0 16px 13px; font-size: 10px; color: var(--wall-muted); }.wall-device-footer > span:last-child { margin-left: auto; }.signal-bars { display: flex; align-items: center; gap: 2px; height: 12px; }.signal-bars i { background: #46907C; width: 2px; height: 8px; animation: signal-wave 1.4s ease-in-out infinite alternate; }.signal-bars i:nth-child(2n) { animation-delay: -.5s; }.signal-bars i:nth-child(3n) { animation-delay: -.9s; }
.wall-acoustic-point { min-width: 0; padding: 13px 12px; border: 1px solid var(--wall-line); border-radius: 7px; background: var(--wall-point); }.wall-acoustic-point header { display: flex; justify-content: space-between; gap: 8px; }.wall-acoustic-point h3 { font-size: 13px; margin: 0; font-weight: 500; }.wall-acoustic-point header span { font-size: 10px; color: var(--wall-muted); }.wall-acoustic-point > strong { display: block; font-size: 28px; color: var(--wall-accent); margin-top: 12px; font-weight: 400; }.wall-acoustic-point small { font-size: 11px; color: var(--wall-muted); }.acoustic-placeholder { height: 96px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--wall-muted); font-size: 11px; }.acoustic-placeholder svg { opacity: .35; }.wall-acoustic-point button { width: 100%; background: rgba(70, 144, 124, .08); color: var(--wall-accent); border: 1px solid var(--control-border); padding: 7px; font-size: 11px; border-radius: 4px; }.wall-acoustic-point button:disabled { opacity: .4; cursor: not-allowed; }
.wall-error { color: #e4a260; border: 1px solid #e4a26030; background: #e4a26008; padding: 10px 14px; font-size: 12px; line-height: 1.7; }.wall-empty { color: var(--wall-muted); text-align: center; padding: 35px; font-size: 14px; }.wall-footer { display: flex; justify-content: space-between; gap: 15px; font-size: 11px; color: var(--wall-muted); padding: 8px 0; }.is-paused .signal-bars i, .is-paused .wall-live i, .is-paused .wall-heading::after, .is-paused .wall-device::before { animation-play-state: paused; }
@keyframes card-arrive { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }@keyframes heading-scan { 0%,100% { left: 0; opacity: .3; } 50% { left: calc(100% - 120px); opacity: 1; } }@keyframes card-scan { from { left: -90px; } to { left: 100%; } }@keyframes beacon { 0% { box-shadow: 0 0 0 0 rgba(142, 230, 168, .27); } 100% { box-shadow: 0 0 0 7px rgba(142, 230, 168, 0); } }@keyframes signal-wave { from { transform: scaleY(.35); } to { transform: scaleY(1.3); } }
:global(.light-theme .live-wall) { --wall-accent: #237f76; }
@media (min-width: 2100px) { .wall-device-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 1200px) { .wall-device-grid { grid-template-columns: minmax(0, 1fr); }.wall-metrics article { padding: 14px; gap: 10px; }.wall-controls { flex-wrap: wrap; }.wall-controls > span { margin-left: 0; } }
@media (max-width: 650px) { .live-wall { padding: 14px; }.wall-heading { align-items: start; flex-direction: column; }.wall-heading h1 { font-size: 22px; letter-spacing: 0; }.wall-actions { justify-items: start; }.wall-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }.wall-metrics article > svg { display: none; }.wall-points { grid-template-columns: minmax(0, 1fr); }.wall-device-photo { width: 72px; }.wall-device-header { gap: 6px; }.wall-device-title h2 { font-size: 15px; }.wall-footer { flex-wrap: wrap; } }
@media (prefers-reduced-motion: reduce) { .live-wall *, .live-wall *::before, .live-wall *::after { animation: none !important; transition: none !important; } }

/* Dense responsive layout. */
.live-wall { padding: 16px 20px; gap: 12px; }
.wall-heading { padding-bottom: 10px; }.wall-heading h1 { font-size: 23px; margin: 5px 0; }.wall-heading p { font-size: 11px; }.wall-eyebrow { font-size: 9px; letter-spacing: 3px; }.wall-actions { gap: 5px; }.wall-actions time { font-size: 13px; }
.wall-metrics { gap: 12px; }.wall-metrics article { padding: 10px 16px; gap: 12px; }.wall-metrics article > div { display: flex; align-items: center; gap: 16px; }.wall-metrics strong { font-size: 27px; margin: 0; }.wall-metrics article > b { font-size: 18px; opacity: .6; }.wall-metrics .unknown-note { font-size: 10px; }
.wall-controls { gap: 10px; }.wall-controls button { padding: 6px 10px; font-size: 12px; }.wall-controls label { padding: 6px 10px; }.wall-controls input { width: 150px; }.wall-controls > span { margin-left: 0; font-size: 10px; }
.wall-device-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; padding: 6px 3px 18px; }
.wall-device { background: linear-gradient(140deg, var(--glass-card), transparent 75%), var(--page-bg); border-radius: 7px; animation-name: compact-arrive; transition: transform .32s ease, border-color .25s, box-shadow .3s; }
.wall-device-header { padding: 8px 10px 8px 7px; gap: 7px; }.wall-device .wall-device-photo { width: 55px; height: 48px; }.wall-device-photo :deep(svg) { width: 27px; height: 27px; }.wall-device-photo :deep(.equipment-symbol) { padding: 5px; }.wall-device-title > span { font-size: 9px; letter-spacing: .5px; }.wall-device-title h2 { font-size: 14px; margin: 3px 0 5px; }.wall-device-title p { font-size: 10px; gap: 5px; }.wall-device-header > a { font-size: 10px; }
.wall-points { grid-template-columns: minmax(0, 1fr); gap: 5px; padding: 8px; }.wall-device-footer { padding: 0 10px 8px; gap: 5px; font-size: 9px; }.wall-device-footer > span:last-child { display: none; }
.spatial-view .wall-device { --depth-y: 0px; --tilt-y: -1deg; transform: perspective(1000px) translateY(var(--depth-y)) rotateY(var(--tilt-y)) rotateX(1deg); transform-origin: center; box-shadow: 3px 4px 0 var(--control-bg), 5px 6px 0 var(--glass-border), 0 16px 24px #0003, inset 0 1px 0 var(--glass-highlight); }
.spatial-view .wall-device:nth-child(3n + 2) { --depth-y: 12px; --tilt-y: 0deg; }
.spatial-view .wall-device:nth-child(3n) { --tilt-y: 1deg; }
.spatial-view .wall-device:hover, .spatial-view .wall-device:focus-within { transform: perspective(1000px) translateY(calc(var(--depth-y) - 4px)) rotateY(0) rotateX(0); border-color: var(--control-border-active); box-shadow: 2px 3px 0 var(--control-bg), 3px 4px 0 var(--glass-border), 0 20px 30px #0004, 0 0 18px #46907c12; z-index: 1; }
.wall-acoustic-point { display: grid; grid-template-columns: 1fr auto; column-gap: 10px; padding: 8px 10px; }.wall-acoustic-point header { grid-column: 1; }.wall-acoustic-point h3 { font-size: 11px; }.wall-acoustic-point > strong { grid-column: 1; margin-top: 5px; font-size: 21px; }.wall-acoustic-point .acoustic-placeholder { display: none; }.wall-acoustic-point > button { grid-column: 2; grid-row: 1 / 3; align-self: center; font-size: 10px; }
.wall-points :deep(.acoustic-point-card) { padding: 10px; }.wall-points :deep(.acoustic-point-card h3) { font-size: 12px; }.wall-points :deep(.acoustic-value) { font-size: 22px; margin-top: 6px; }.wall-points :deep(.compact-waveform) { height: 85px; }
.wall-footer { font-size: 10px; padding: 0; }
@keyframes compact-arrive { from { opacity: 0; } to { opacity: 1; } }
@media (min-width: 1800px) { .wall-device-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }.spatial-view .wall-device:nth-child(n) { --depth-y: 0px; --tilt-y: -1deg; }.spatial-view .wall-device:nth-child(4n + 2), .spatial-view .wall-device:nth-child(4n + 3) { --depth-y: 12px; --tilt-y: 0deg; }.spatial-view .wall-device:nth-child(4n) { --tilt-y: 1deg; } }
@media (max-width: 1250px) { .wall-device-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.spatial-view .wall-device:nth-child(n) { --depth-y: 0px; --tilt-y: 0deg; }.spatial-view .wall-device:nth-child(even) { --depth-y: 10px; }.wall-controls { flex-wrap: wrap; }.wall-metrics article > div { gap: 8px; }.wall-metrics article > svg { display: none; } }
@media (max-width: 700px) { .wall-device-grid { grid-template-columns: minmax(0, 1fr); }.spatial-view .wall-device:nth-child(n) { transform: none; --depth-y: 0px; }.wall-heading { flex-wrap: wrap; }.live-wall { padding: 12px; }.wall-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (prefers-reduced-motion: reduce) { .wall-device { animation: none; transition: none; }.spatial-view .wall-device:hover, .spatial-view .wall-device:focus-within { transform: perspective(1000px) translateY(var(--depth-y)) rotateY(var(--tilt-y)) rotateX(1deg); } }

/* Equipment stands: depth is applied to the equipment, not the data panels. */
.wall-device-grid { gap: 20px 18px; }
.wall-device, .spatial-view .wall-device:nth-child(n), .spatial-view .wall-device:hover, .spatial-view .wall-device:focus-within { transform: none; border: 0; border-radius: 0; background: transparent; box-shadow: none; overflow: visible; }
.wall-device::before { display: none; }
.module-stage-header { padding: 0 10px; }
.module-topline { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 9px; color: var(--wall-muted); letter-spacing: .6px; }
.module-topline a { color: var(--wall-accent); font-size: 10px; text-decoration: none; }
.module-stage { position: relative; height: 112px; display: grid; place-items: center; isolation: isolate; }
.module-stage .stage-equipment { position: relative; width: 180px; height: 100px; overflow: visible; z-index: 2; background: none; }
.stage-equipment :deep(img) { width: 100%; height: 100%; filter: drop-shadow(0 10px 8px #0005); }
.stage-equipment :deep(.equipment-symbol) { padding: 10px; border-radius: 10px; color: var(--text-soft); background: var(--glass-card); border-color: var(--glass-border); }
.stage-equipment :deep(svg) { width: 43px; height: 43px; }
.stage-equipment :deep(.visual-baseline), .stage-equipment::before { display: none; }
.stage-plinth { position: absolute; z-index: 1; width: 158px; height: 30px; bottom: 0; border: 1px solid var(--control-border-active); border-radius: 50%; background: radial-gradient(ellipse, #46907c25, #46907c04 70%); box-shadow: 0 4px 0 var(--page-bg), 0 5px 0 var(--glass-border), 0 10px 20px #0003; }
.stage-orbit { position: absolute; bottom: 0; width: 210px; height: 45px; border: 1px dashed #46907c30; border-radius: 50%; transform: rotate(-7deg); }
.module-caption { position: relative; text-align: center; padding: 7px 0 9px; }
.module-caption h2 { font-size: 14px; line-height: 20px; height: 40px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-weight: 500; margin: 0 0 6px; overflow-wrap: anywhere; }.module-caption p { display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; gap: 10px; height: 16px; font-size: 10px; color: var(--wall-muted); margin: 0; }
.module-state { display: inline-flex; align-items: center; gap: 5px; }.module-state i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }.module-state.online { color: var(--wall-accent); }.module-state.offline { color: #ff9800; }
.parameter-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 28px; padding: 0 12px; border-top: 1px solid var(--glass-border); color: var(--wall-muted); font-size: 10px; }
.parameter-heading b { margin-left: 5px; color: var(--text-soft); font-weight: 500; font-variant-numeric: tabular-nums; }
.parameter-heading > span:last-child { font-size: 9px; }
.parameter-viewport { height: 224px; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; scrollbar-color: var(--control-border-active) transparent; scrollbar-gutter: stable; background: linear-gradient(180deg, var(--glass-card), transparent); }
.parameter-viewport:focus-visible { outline: 1px solid var(--control-border-active); outline-offset: 2px; }
.wall-points.module-parameters { position: relative; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 4px 8px 6px; }
.module-parameters::before { content: ''; position: absolute; top: 8px; bottom: 8px; width: 1px; left: 50%; background: linear-gradient(transparent, var(--glass-border), transparent); }
.parameter-column { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.module-parameters :deep(.home-point.compact) { box-sizing: border-box; flex: 0 0 103px; height: 103px; grid-template-columns: minmax(0, 1fr); grid-template-rows: 32px 27px 31px; padding: 6px 7px 3px; border: 0; border-bottom: 1px solid var(--glass-border); background: transparent; border-radius: 0; }
.module-parameters :deep(.compact header) { align-items: flex-start; }
.module-parameters :deep(.compact h3) { line-height: 16px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.module-parameters :deep(.compact .home-point-value) { margin-top: 4px; height: 23px; }.module-parameters :deep(.compact .home-point-value strong) { font-size: 21px; }
.module-parameters :deep(.compact .home-point-chart) { grid-column: 1; grid-row: 3; height: 31px; }
.module-parameters .wall-acoustic-point { display: block; padding: 7px; border: 0; border-bottom: 1px solid var(--glass-border); background: transparent; }.module-parameters .wall-acoustic-point > button { margin-top: 8px; }
.module-parameters :deep(.acoustic-point-card) { border: 0; border-bottom: 1px solid var(--glass-border); border-radius: 0; background: transparent; padding: 7px; }.module-parameters :deep(.acoustic-point-card header) { flex-wrap: wrap; gap: 3px; }.module-parameters :deep(.compact-waveform) { height: 75px; }
.single-point .module-parameters { grid-template-columns: minmax(0, 1fr); }
.single-point .module-parameters::before { display: none; }
.few-points .module-parameters :deep(.home-point.compact) { height: 207px; flex-basis: 207px; grid-template-rows: 32px 40px 120px; }
.few-points .module-parameters :deep(.compact .home-point-value) { height: 36px; }
.few-points .module-parameters :deep(.compact .home-point-value strong) { font-size: 28px; }
.few-points .module-parameters :deep(.compact .home-point-chart) { height: 120px; }
.few-points .module-parameters .acoustic-placeholder { display: flex; height: 75px; }
.parameter-viewport .wall-empty { margin: 0; padding: 65px 12px; font-size: 12px; }
.wall-device-footer { padding: 4px 12px 0; opacity: .75; }
.spatial-view .stage-equipment { animation: equipment-hover 6s ease-in-out infinite; animation-delay: var(--entry-delay); transform-origin: center bottom; }.spatial-view .stage-orbit { animation: stage-breathe 4s ease-in-out infinite; }
.spatial-view .wall-device:nth-child(2n) .module-stage { perspective: 600px; }.spatial-view .wall-device:hover .stage-plinth { box-shadow: 0 4px 0 var(--page-bg), 0 5px 0 var(--control-border-active), 0 0 22px #46907c25; }
@keyframes equipment-hover { 0%,100% { transform: perspective(650px) translateY(-2px) rotateY(-7deg); } 50% { transform: perspective(650px) translateY(-7px) rotateY(7deg); } }
@keyframes stage-breathe { 0%,100% { opacity: .4; transform: scale(.95) rotate(-7deg); } 50% { opacity: 1; transform: scale(1.03) rotate(7deg); } }
.is-paused .stage-equipment, .is-paused .stage-orbit { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) { .spatial-view .stage-equipment, .spatial-view .stage-orbit { animation: none; } }
</style>
