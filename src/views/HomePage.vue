<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Activity, Search, RefreshCw, Radio, Server, Wifi } from 'lucide-vue-next'
import EquipmentVisual from '../components/EquipmentVisual.vue'
import HomePointCard from '../components/HomePointCard.vue'
import SpectrumPage from './SpectrumPage.vue'
import { useTelemetryStore } from '../stores/telemetry'
import { useHomeDevicesStore } from '../stores/homeDevices'
import { telemetryApi } from '../services/telemetry'
import { pointKey } from '../charts/telemetry'
import { equipmentSceneLayout } from '../charts/equipmentScene.js'
import { moduleDisplayName, sortMonitoringModules, sortMonitoringPoints } from '../charts/equipmentCatalog.js'

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
let sampleTimer, metadataTimer, sceneObserver
const sceneViewport = ref(null)
const sceneSize = ref({ width: 780, height: 540 })
const colors = ['#39a9ff', '#ff9800', '#00c875']
const devices = computed(() => [
  ...sortMonitoringModules(telemetry.modules || []).map(module => ({ key: JSON.stringify(['legacy', module.moduleId]), source: 'legacy', id: module.moduleId, name: moduleDisplayName(module), online: module.runtimeStatus?.isOnline, points: pointMap.value[module.moduleId] || [], raw: module })),
  ...(monitor.devices || []).map(device => ({ key: JSON.stringify(['monitor', device.deviceId]), source: 'monitor', id: device.deviceId, name: device.deviceName || device.deviceId, online: device.online, points: device.channels || [], raw: device })),
])
const visibleDevices = computed(() => devices.value.filter(device => (source.value === 'all' || device.source === source.value) && `${device.name} ${device.id}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const sceneZoom = ref(1)
const maxSceneZoom = computed(() => Math.max(1, Math.min(1.6, sceneSize.value.width / 310)))
const effectiveSceneZoom = computed(() => Math.min(sceneZoom.value, maxSceneZoom.value))
let drag = null, dragged = false
const sceneExtent = computed(() => ({ width: sceneSize.value.width, height: Math.max(sceneSize.value.height, sceneLayout.value.height * effectiveSceneZoom.value) }))
function beginSceneDrag(event) {
  dragged = false
  if (event.pointerType !== 'mouse' || event.button !== 0) return
  drag = { y: event.clientY, top: sceneViewport.value.scrollTop }
}
function moveSceneDrag(event) {
  if (!drag) return
  const dy = event.clientY - drag.y
  if (Math.abs(dy) > 6) dragged = true
  if (dragged) {
    sceneViewport.value.setPointerCapture(event.pointerId)
    sceneViewport.value.scrollTop = drag.top - dy
  }
}
function endSceneDrag(event) {
  drag = null
  if (sceneViewport.value?.hasPointerCapture(event.pointerId)) sceneViewport.value.releasePointerCapture(event.pointerId)
}
async function resetScene() {
  sceneZoom.value = 1
  await nextTick()
  sceneViewport.value?.scrollTo({ left: 0, top: 0, behavior: 'smooth' })
}
const sceneDevices = visibleDevices
const sceneLayout = computed(() => equipmentSceneLayout(sceneDevices.value.length, sceneSize.value.width / effectiveSceneZoom.value, 600))
watch(sceneDevices, async devices => {
  if (activeAcoustic.value && !devices.some(device => device.source === 'monitor' && device.points.some(channel => connectionKey(device, channel) === activeAcoustic.value))) {
    await acousticPanel.value?.[0]?.stopSession()
    activeAcoustic.value = ''
  }
})
const onlineCount = computed(() => devices.value.filter(device => device.online === true).length)
const offlineCount = computed(() => devices.value.filter(device => device.online === false).length)
const unknownCount = computed(() => devices.value.filter(device => device.online !== true && device.online !== false).length)
const pointCount = computed(() => devices.value.reduce((total, device) => total + device.points.length, 0))
const hasData = computed(() => telemetry.modules !== null || monitor.devices !== null)
const currentTime = computed(() => new Date(now.value).toLocaleString('zh-CN', { hour12: false }))
const connectionKey = (device, channel) => JSON.stringify([device.id, channel.channelId])
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
  sceneObserver = new ResizeObserver(([entry]) => {
    sceneSize.value = { width: entry.contentRect.width, height: entry.contentRect.height }
  })
  if (sceneViewport.value) sceneObserver.observe(sceneViewport.value)
  refresh()
  sampleTimer = window.setInterval(() => {
    now.value = Date.now()
    if (autoRefresh.value) telemetry.refreshLatest({ signal: controller.signal })
  }, 2000)
  metadataTimer = window.setInterval(() => { if (autoRefresh.value) refresh() }, 30000)
})
onBeforeUnmount(() => {
  sceneObserver?.disconnect()
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
    <div class="scene-workspace">
      <section class="equipment-scene" aria-label="设备空间总览">
        <header class="scene-heading"><div><span>设备空间总览 · {{ sceneDevices.length }} 台</span><small>示意布局 · 点位直接展示 · 每行两项 · 超过四项内部滚动</small></div><div class="scene-tools"><button aria-label="缩小场景" :disabled="effectiveSceneZoom <= 1" @click="sceneZoom = Math.max(1, effectiveSceneZoom - .15)">−</button><span>{{ Math.round(effectiveSceneZoom * 100) }}%</span><button aria-label="放大场景" :disabled="effectiveSceneZoom >= maxSceneZoom" @click="sceneZoom = Math.min(maxSceneZoom, effectiveSceneZoom + .15)">+</button><button @click="resetScene">回到总览</button></div></header>
        <div ref="sceneViewport" class="scene-scroll" tabindex="0" aria-label="设备场景，可上下拖动或使用上下方向键滚动" @pointerdown="beginSceneDrag" @pointermove="moveSceneDrag" @pointerup="endSceneDrag" @pointercancel="endSceneDrag" @lostpointercapture="drag = null">
          <div class="scene-extent" :style="{ width: sceneExtent.width + 'px', height: sceneExtent.height + 'px' }">
          <div class="scene-world" :style="{ width: sceneLayout.width + 'px', height: sceneLayout.height + 'px', transform: 'scale(' + effectiveSceneZoom + ')', '--scene-node-width': sceneLayout.nodeWidth + 'px' }">
            <div class="scene-floor" aria-hidden="true"><div class="scene-route"></div><span class="scene-floor-label">EQUIPMENT MONITORING</span></div>
            <article v-for="(device, index) in sceneDevices" :key="device.key" class="scene-node" :class="{ offline: device.online === false }" :style="{ left: sceneLayout.positions[index].left + 'px', top: sceneLayout.positions[index].top + 'px' }" :aria-label="device.name + '实时监测'">
              <span class="scene-node-id">{{ device.id }} <i>{{ stateText((device.source === 'legacy' ? telemetry.errors.modules : monitor.error) ? undefined : device.online) }}</i></span>
              <span class="scene-pedestal" aria-hidden="true"></span>
              <EquipmentVisual :name="device.name" :source="device.source" :device-id="device.id" :online="(device.source === 'legacy' ? telemetry.errors.modules : monitor.error) ? undefined : device.online" :paused="!autoRefresh" />
              <h2 class="scene-node-name" :title="device.name">{{ device.name }}</h2>
              <div class="scene-point-heading"><span>{{ device.points.length }} 个点位</span><span v-if="device.points.length > 4">上下滚动查看 ↓</span><RouterLink :to="{ path: '/device/detail', query: { source: device.source, device: device.id, tab: 'live' } }" :aria-label="device.name + '设备详情'">详情 ↗</RouterLink></div>
              <div class="scene-point-viewport" tabindex="0" role="region" :aria-label="device.name + '全部点位，上下滚动查看'" @pointerdown.stop @pointermove.stop @pointerup.stop @wheel.stop>
                <div v-if="device.source === 'legacy' && pointErrors[device.id]" class="wall-error" role="alert">{{ pointErrors[device.id] }}</div>
                <template v-if="device.source === 'legacy'">
                  <HomePointCard v-for="(point, pointIndex) in device.points" :key="pointKey(point)" compact :point="point" :samples="telemetry.buffers[pointKey(point)] || []" :color="colors[pointIndex % colors.length]" :now="now" :paused="!autoRefresh" />
                </template>
                <template v-else><template v-for="(channel, channelIndex) in device.points" :key="connectionKey(device, channel)">
                  <SpectrumPage v-if="activeAcoustic === connectionKey(device, channel)" ref="acousticPanel" embedded compact :device="device.raw" :channel-id="channel.channelId" :accent-color="colors[channelIndex % colors.length]" display-mode="live" />
                  <section v-else class="scene-acoustic-point"><header><h3>{{ channel.name || channel.channelName || channel.channelId }}</h3><span>{{ stateText(channel.online) }}</span></header><p>— <small>波形 RMS</small></p><button :disabled="!autoRefresh || channel.online !== true || device.online === false || switchingAcoustic" @click="selectAcoustic(device, channel)">{{ channel.online === false ? '点位离线' : '监听此点位' }}</button></section>
                </template></template>
                <p v-if="!device.points.length" class="wall-empty">{{ refreshing ? '正在加载点位…' : '暂无监测点位' }}</p>
              </div>
            </article>
          </div>
          </div>
        </div>
        <footer class="scene-legend"><span><i></i>在线采集</span><span><i></i>离线</span><span>各设备独立监测 · 曲线来自实时采样</span></footer>
      </section>
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
.stage-equipment :deep(.operation-ring) { height: 35px; bottom: 0; }
.stage-equipment :deep(.operation-state) { right: -22px; bottom: 8px; }
.stage-equipment :deep(img) { width: 100%; height: 100%; filter: drop-shadow(0 10px 8px #0005); }
.stage-equipment :deep(.equipment-symbol) { padding: 10px; border-radius: 10px; color: var(--text-soft); background: var(--glass-card); border-color: var(--glass-border); }
.stage-equipment :deep(.equipment-glyph) { width: 43px; height: 43px; }
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
.spatial-view .module-stage.is-running .stage-equipment { animation: equipment-hover 6s ease-in-out infinite; animation-delay: var(--entry-delay); transform-origin: center bottom; }.spatial-view .module-stage.is-running .stage-orbit { animation: stage-breathe 4s ease-in-out infinite; }
.spatial-view .wall-device:nth-child(2n) .module-stage { perspective: 600px; }.spatial-view .wall-device:hover .stage-plinth { box-shadow: 0 4px 0 var(--page-bg), 0 5px 0 var(--control-border-active), 0 0 22px #46907c25; }
@keyframes equipment-hover { 0%,100% { transform: perspective(650px) translateY(-2px) rotateY(-7deg); } 50% { transform: perspective(650px) translateY(-7px) rotateY(7deg); } }
@keyframes stage-breathe { 0%,100% { opacity: .4; transform: scale(.95) rotate(-7deg); } 50% { opacity: 1; transform: scale(1.03) rotate(7deg); } }
.is-paused .stage-equipment, .is-paused .stage-orbit { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) { .spatial-view .stage-equipment, .spatial-view .module-stage.is-running .stage-orbit { animation: none; } }
.scene-workspace { display: grid; grid-template-columns: minmax(0, 1fr) 350px; gap: 16px; min-height: 600px; }
.equipment-scene { min-width: 0; position: relative; display: flex; flex-direction: column; border: 1px solid var(--glass-border); border-radius: 10px; overflow: hidden; background: radial-gradient(ellipse at 50% 55%, #46907c12, transparent 70%), var(--page-bg); }
.scene-heading { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 15px 18px; z-index: 1; }
.scene-heading > div:first-child { display: grid; gap: 5px; font-size: 14px; }
.scene-heading small { font-size: 10px; color: var(--wall-muted); }
.scene-device-count { font-size: 10px; color: var(--wall-accent); white-space: nowrap; }
.scene-scroll { position: relative; flex: 1; min-width: 0; min-height: 460px; overflow: hidden; }
.scene-world { position: absolute; left: 50%; top: 50%; transform-origin: center; perspective: 900px; isolation: isolate; }
.scene-floor { position: absolute; inset: 35px 10px -10px; z-index: -1; transform: rotateX(35deg) rotateZ(-8deg); border: 1px solid var(--control-border); border-radius: 20px; background: linear-gradient(var(--glass-border) 1px, transparent 1px), linear-gradient(90deg, var(--glass-border) 1px, transparent 1px), var(--glass-card-soft); background-size: 38px 38px; box-shadow: 0 8px 0 var(--page-bg), 0 9px 0 var(--glass-border), 0 30px 50px #0003; }
.scene-route { position: absolute; top: 48%; left: 6%; right: 6%; height: 15px; border-top: 1px solid #39a9ff45; border-bottom: 1px dashed #39a9ff25; background: linear-gradient(90deg, transparent, #39a9ff12, transparent); }
.scene-floor-label { position: absolute; bottom: 17px; right: 20px; font-size: 11px; letter-spacing: 5px; color: var(--wall-muted); opacity: .3; }
.scene-node { position: absolute; width: 205px; padding: 0; border: 0; background: transparent; color: var(--text-main); cursor: pointer; text-align: left; isolation: isolate; transition: transform .3s; }
.scene-node:focus-visible { outline: 1px solid var(--wall-accent); outline-offset: 7px; border-radius: 8px; }
.scene-node:hover { transform: translateY(-4px); }
.scene-node-id { display: flex; justify-content: space-between; align-items: center; font-size: 9px; letter-spacing: 1px; color: var(--wall-muted); }
.scene-node-id i { font-style: normal; color: var(--wall-accent); letter-spacing: 0; }
.scene-node.offline .scene-node-id i { color: #ff9800; }
.scene-node :deep(.equipment-visual) { height: 115px; overflow: visible; background: none; }
.scene-node :deep(.equipment-visual::before), .scene-node :deep(.visual-baseline), .scene-node :deep(.operation-state) { display: none; }
.scene-node :deep(.equipment-symbol) { padding: 13px; border-radius: 6px; background: linear-gradient(135deg, var(--glass-highlight), var(--glass-card)), var(--page-bg); transform: perspective(500px) rotateY(-25deg) rotateX(9deg); box-shadow: 3px 2px 0 var(--glass-border), 6px 4px 0 var(--page-bg), 7px 5px 0 var(--control-border), 12px 17px 12px #0004; color: var(--text-soft); }
.scene-node :deep(.equipment-glyph) { width: 43px; height: 43px; }
.scene-node :deep(img) { height: 100px; width: 165px; transform: perspective(500px) rotateY(-15deg); }
.scene-node :deep(.operation-ring) { height: 30px; bottom: 0; }
.scene-pedestal { position: absolute; width: 150px; height: 65px; top: 76px; left: 27px; z-index: -1; transform: perspective(500px) rotateX(55deg) rotateZ(-12deg); border-radius: 12px; border: 1px solid var(--control-border); background: linear-gradient(var(--glass-card), var(--glass-card)), var(--page-bg); box-shadow: 0 5px 0 var(--page-bg), 0 6px 0 var(--glass-border), 0 10px 0 var(--page-bg), 0 11px 0 var(--glass-border), 6px 16px 18px #0004; transition: box-shadow .3s, border-color .3s; }
.scene-node.selected .scene-pedestal { border-color: var(--wall-accent); box-shadow: 0 5px 0 var(--page-bg), 0 6px 0 var(--control-border-active), 0 10px 0 var(--page-bg), 0 11px 0 var(--control-border-active), 0 0 25px #00c87520; }
.scene-node-name { display: block; margin-top: 8px; font-size: 11px; line-height: 17px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.scene-node.selected .scene-node-name { color: var(--wall-accent); }
.scene-reading { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-top: 3px; }
.scene-reading > span { color: #39a9ff; font-size: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.scene-reading small { font-size: 9px; color: var(--wall-muted); }
.scene-reading svg { width: 98px; height: 26px; overflow: visible; }
.scene-reading path { fill: none; stroke: #39a9ff; stroke-width: 1.3; }
.scene-reading-label { display: block; font-size: 9px; color: var(--wall-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-legend { display: flex; flex-wrap: wrap; gap: 16px; padding: 12px 18px; font-size: 10px; color: var(--wall-muted); }
.scene-legend i { display: inline-block; width: 5px; height: 5px; margin-right: 5px; border-radius: 50%; background: #00c875; }
.scene-legend > span:nth-child(2) i { background: #ff9800; }
.scene-inspector.wall-device-grid { display: block; padding: 12px 8px; border: 1px solid var(--glass-border); border-radius: 10px; background: var(--glass-card-soft); }
.scene-inspector .parameter-viewport { height: 320px; }
.scene-inspector .module-stage { height: 95px; }
.scene-inspector .module-stage .stage-equipment { height: 85px; }
.scene-inspector .module-caption h2 { font-size: 13px; }
@media (min-width: 1800px) { .scene-workspace { grid-template-columns: minmax(0, 1fr) 390px; min-height: 680px; } }
@media (max-width: 1150px) { .scene-workspace { grid-template-columns: minmax(0, 1fr); } .scene-inspector .parameter-viewport { height: 224px; } .scene-inspector .module-stage { display: none; } .scene-inspector .module-caption h2 { height: auto; } }
/* Touchscreen presentation: readable equipment, expandable world, bottom detail dock. */
.scene-workspace { position: relative; display: block; height: max(650px, calc(100dvh - 235px)); min-height: 650px; }
.equipment-scene { height: 100%; box-sizing: border-box; }
.details-open .equipment-scene { padding-bottom: 310px; }
.scene-tools { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.scene-tools button, .close-inspector { min-width: 44px; min-height: 44px; padding: 0 13px; border: 1px solid var(--control-border); border-radius: 6px; color: var(--text-main); background: var(--page-bg); cursor: pointer; font-size: 14px; }
.scene-tools button:disabled { opacity: .35; cursor: default; }
.scene-heading > div:first-child { font-size: 18px; }
.scene-heading small { font-size: 12px; }
.scene-scroll { min-height: 0; overflow-x: hidden; overflow-y: auto; touch-action: pan-y; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: var(--control-border-active) transparent; cursor: grab; user-select: none; }
.scene-scroll:active { cursor: grabbing; }
.scene-scroll:focus-visible { outline: 1px solid var(--wall-accent); outline-offset: -2px; }
.scene-extent { position: relative; }
.scene-world { left: 0; top: 0; transform-origin: top left; }
.scene-node { width: var(--scene-node-width, 270px); }
.scene-node.selected { transform: translateY(-3px) scale(1.06); z-index: 2; }
.scene-node-id { font-size: 13px; }
.scene-node :deep(.equipment-visual) { height: 145px; }
.scene-node :deep(.equipment-glyph) { width: 64px; height: 64px; }
.scene-node :deep(.equipment-symbol) { padding: 18px; }
.scene-node :deep(img) { width: 225px; height: 135px; pointer-events: none; }
.scene-pedestal { width: 200px; height: 80px; top: 98px; left: 35px; }
.scene-node-name { font-size: 16px; line-height: 24px; }
.scene-reading > span { font-size: 26px; }
.scene-reading small { font-size: 13px; }
.scene-reading svg { width: 115px; height: 32px; }
.scene-reading-label { font-size: 12px; line-height: 20px; }
.scene-legend { font-size: 12px; }
.scene-inspector.wall-device-grid { position: absolute; bottom: 0; left: 0; right: 0; height: 300px; box-sizing: border-box; padding: 12px 18px; background: var(--page-bg); border-color: var(--control-border-active); box-shadow: 0 -12px 35px #0003; z-index: 5; }
.dock-actions { position: absolute; top: 10px; right: 14px; z-index: 2; display: flex; align-items: center; gap: 12px; }
.dock-actions a { display: inline-flex; align-items: center; min-height: 44px; color: var(--wall-accent); font-size: 14px; text-decoration: none; }
.scene-inspector .module-stage, .scene-inspector .module-topline, .scene-inspector .wall-device-footer { display: none; }
.scene-inspector .module-stage-header { padding: 0 210px 0 0; }
.scene-inspector .module-caption { display: flex; align-items: center; gap: 20px; padding: 0 0 8px; text-align: left; }
.scene-inspector .module-caption h2 { height: auto; margin: 0; font-size: 18px; line-height: 28px; }
.scene-inspector .module-caption p { font-size: 12px; }
.scene-inspector .parameter-heading { height: 26px; font-size: 12px; padding-left: 0; }
.scene-inspector .parameter-viewport { height: 210px; }
.scene-inspector .module-parameters { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.scene-inspector .parameter-column { display: contents; }
.scene-inspector .module-parameters::before { display: none; }
.scene-inspector .module-parameters :deep(.home-point.compact) { height: 185px; grid-template-rows: 36px 37px 100px; }
.scene-inspector .module-parameters :deep(.compact h3) { font-size: 14px; line-height: 18px; }
.scene-inspector .module-parameters :deep(.compact .home-point-value) { height: 33px; }
.scene-inspector .module-parameters :deep(.compact .home-point-value strong) { font-size: 28px; }
.scene-inspector .module-parameters :deep(.compact .home-point-chart) { height: 100px; }
.scene-inspector .single-point .module-parameters { grid-template-columns: minmax(0, 1fr); }
.wall-metrics article { padding: 6px 14px; }
.wall-heading { padding-bottom: 6px; }
.wall-heading p, .wall-eyebrow { display: none; }
@media (max-width: 900px) { .scene-heading { flex-wrap: wrap; } .scene-inspector .module-caption { display: block; } .scene-inspector .module-caption p { justify-content: flex-start; } .scene-inspector .module-parameters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .scene-inspector .parameter-viewport { height: 180px; } }
.scene-node { cursor: default; }
.scene-node:hover { transform: none; }
.scene-node-name { margin: 8px 0 0; font-weight: 500; }
.scene-point-heading { display: flex; align-items: center; gap: 8px; height: 38px; color: var(--wall-muted); font-size: 12px; }
.scene-point-heading > span:nth-child(2) { font-size: 11px; }
.scene-point-heading a { margin-left: auto; color: var(--wall-accent); text-decoration: none; padding: 10px 0; }
.scene-point-viewport { height: 257px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 128px; align-content: start; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; touch-action: pan-y; scrollbar-width: thin; scrollbar-color: var(--control-border-active) transparent; scrollbar-gutter: stable; border-top: 1px solid var(--glass-border); background: linear-gradient(180deg, var(--glass-card), transparent), var(--page-bg); cursor: auto; user-select: text; }
.scene-point-viewport > .wall-error, .scene-point-viewport > .wall-empty { grid-column: 1 / -1; }
.scene-node .scene-pedestal { left: calc(50% - 100px); }
.scene-point-viewport:focus-visible { outline: 1px solid var(--wall-accent); outline-offset: 2px; }
.scene-point-viewport :deep(.home-point.compact) { box-sizing: border-box; height: 128px; display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: 31px 28px 56px; padding: 6px 8px; border: 0; border-bottom: 1px solid var(--glass-border); border-radius: 0; background: transparent; }
.scene-point-viewport :deep(.compact header) { align-items: flex-start; }
.scene-point-viewport :deep(.compact h3) { font-size: 14px; line-height: 16px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.scene-point-viewport :deep(.compact .home-point-value) { height: 28px; margin: 0; }
.scene-point-viewport :deep(.compact .home-point-value strong) { font-size: 26px; }
.scene-point-viewport :deep(.compact .home-point-chart) { grid-column: 1; grid-row: 3; height: 56px; }
.scene-acoustic-point { height: 128px; box-sizing: border-box; padding: 8px; border-bottom: 1px solid var(--glass-border); }
.scene-acoustic-point header { display: flex; justify-content: space-between; gap: 8px; }
.scene-acoustic-point h3 { margin: 0; font-size: 14px; }
.scene-acoustic-point header span, .scene-acoustic-point small { font-size: 11px; color: var(--wall-muted); }
.scene-acoustic-point p { font-size: 24px; margin: 7px 0; }
.scene-acoustic-point button { min-height: 36px; width: 100%; color: var(--wall-accent); background: var(--control-bg); border: 1px solid var(--control-border); border-radius: 4px; cursor: pointer; }
.scene-acoustic-point button:disabled { opacity: .4; cursor: default; }
.scene-point-viewport :deep(.acoustic-point-card) { margin: 0; border-radius: 0; padding: 8px; }
.scene-point-viewport :deep(.compact-waveform) { height: 56px; }
</style>
