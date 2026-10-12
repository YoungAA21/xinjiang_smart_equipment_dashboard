<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import HomePointCard from '../components/HomePointCard.vue'
import { useTelemetryStore } from '../stores/telemetry'
import { useHomeDevicesStore } from '../stores/homeDevices'
import { telemetryApi } from '../services/telemetry.js'
import { groupMachineDevices } from '../charts/machineGroups.js'
import { acousticPointIp } from '../charts/pointAddress.js'
import { isMeasurementPoint, moduleDisplayName, sortMonitoringModules, sortMonitoringPoints } from '../charts/equipmentCatalog.js'
import { pointKey } from '../charts/telemetry.js'

const route = useRoute()
const telemetry = useTelemetryStore()
const monitor = useHomeDevicesStore()
const pointMap = ref({})
const pointErrors = ref({})
const loadedAt = new Map()
const busy = ref(false)
const paused = ref(false)
const now = ref(Date.now())
const search = ref('')
const controller = new AbortController()
let sampleTimer, configTimer
const sources = computed(() => [
  ...sortMonitoringModules(telemetry.modules || []).map(module => ({ key: JSON.stringify(['legacy', module.moduleId]), id: module.moduleId, name: moduleDisplayName(module), source: 'legacy', online: module.runtimeStatus?.isOnline, points: pointMap.value[module.moduleId] || [], raw: module })),
  ...(monitor.devices || []).map(device => ({ key: JSON.stringify(['monitor', device.deviceId]), id: device.deviceId, name: device.deviceName || device.deviceId, source: 'monitor', online: device.online, points: device.channels || [], raw: device })),
])
const grouped = computed(() => groupMachineDevices(sources.value))
const groups = computed(() => [...grouped.value.groups, ...(grouped.value.pending.members.length ? [grouped.value.pending] : [])])
const selected = computed(() => groups.value.find(group => group.id === (route.query.machine === 'main-pressure' ? 'ZB25' : route.query.machine)))
const showingDetail = computed(() => Boolean(route.query.machine))
const matching = computed(() => groups.value.filter(group => `${group.name} ${group.members.map(member => `${member.name} ${member.id}`).join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const colors = ['#39a9ff', '#ff9800', '#00c875']
const sourceState = member => (member.source === 'legacy' ? telemetry.errors.modules : monitor.error) ? '状态待确认' : member.online === true ? '在线' : member.online === false ? '离线' : '状态待确认'
const groupState = group => group.members.some(member => member.source === 'legacy' ? telemetry.errors.modules : monitor.error) ? '状态待确认' : group.status
const fullyLoaded = group => group.members.length > 0 && group.members.every(member => member.source === 'monitor' || Object.hasOwn(pointMap.value, member.id))
const countText = group => `${group.pointCount}${fullyLoaded(group) ? '' : '（已加载）'}`
const detailLink = (member, tab, point) => ({ path: '/device/detail', query: { source: member.source, device: member.id, tab, machine: selected.value?.id, ...(point ? { pointId: point.pointId } : {}) } })

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
})
onBeforeUnmount(() => { controller.abort(); clearInterval(sampleTimer); clearInterval(configTimer); telemetry.clear(); monitor.clear() })
</script>

<template>
  <section class="page machine-monitor">
    <header class="monitor-heading"><div><h1>设备监控</h1><p>三台设备 · 与首页使用相同点位归属</p></div><div class="monitor-actions"><label><input v-model="paused" type="checkbox" /> 暂停自动刷新</label><el-button :loading="busy" @click="refresh(true)">刷新数据</el-button></div></header>
    <p v-if="telemetry.errors.modules || telemetry.errors.latest || monitor.error" class="monitor-warning" role="alert">{{ [telemetry.errors.modules, telemetry.errors.latest, monitor.error].filter(Boolean).join('；') }}。请留意数据更新时间。</p>
    <template v-if="!showingDetail">
      <label class="monitor-search">搜索设备 <input v-model="search" placeholder="设备名称或模块编号" /></label>
      <div class="machine-directory">
        <RouterLink v-for="group in matching" :key="group.id" class="machine-entry" :to="{ path: '/device', query: { machine: group.id } }">
          <header><h2>{{ group.name }}</h2><span>{{ groupState(group) }}</span></header>
          <p>{{ group.id === 'pending' ? '归属待确认，保留展示' : '整机监测' }}</p>
          <div class="machine-totals"><strong>{{ countText(group) }}<small> 个数值/声纹点位</small></strong><span>{{ group.members.length }} 个采集来源</span></div>
          <ul><li v-for="member in group.members" :key="member.key">{{ member.name }} <small>{{ member.source === 'legacy' ? member.raw.host || 'IP未提供' : '声纹通道' }}</small></li></ul>
          <p v-if="group.members.some(member => pointErrors[member.id])" class="monitor-warning">部分点位加载失败，进入详情查看</p>
          <footer>查看全部监测点位 ↗</footer>
        </RouterLink>
      </div>
      <p v-if="!matching.length">暂无匹配设备</p>
    </template>
    <template v-else>
      <RouterLink :to="{ path: '/device' }">‹ 返回设备列表</RouterLink>
      <template v-if="selected">
        <header class="selected-machine"><h2>{{ selected.name }}</h2><span>{{ groupState(selected) }} · {{ countText(selected) }} 个点位</span></header>
        <nav class="machine-nav" aria-label="切换设备"><RouterLink v-for="group in groups" :key="group.id" :class="{ active: selected.id === group.id }" :to="{ path: '/device', query: { machine: group.id } }">{{ group.name }}</RouterLink></nav>
        <section v-for="member in selected.members" :key="member.key" class="monitor-source">
          <header><div><h3>{{ member.name }}</h3><p>{{ member.id }} · {{ sourceState(member) }} <span v-if="member.source === 'legacy'">· 采集 IP：{{ member.raw.host || '未提供' }}</span></p></div><RouterLink :to="detailLink(member, 'info')">采集来源详情 ↗</RouterLink></header>
          <p v-if="pointErrors[member.id]" class="monitor-warning">{{ pointErrors[member.id] }}</p>
          <div class="monitor-point-grid" :class="{ single: member.points.length === 1, double: member.points.length === 2 }">
            <template v-if="member.source === 'legacy'">
              <section v-for="(point, index) in member.points" :key="pointKey(point)" class="monitor-measurement">
                <HomePointCard :point="point" :source-ip="member.raw.host || ''" :samples="telemetry.buffers[pointKey(point)] || []" :color="colors[index % colors.length]" :now="now" :paused="paused" />
                <div class="point-actions"><RouterLink :to="detailLink(member, 'trend', point)">趋势分析</RouterLink><RouterLink :to="detailLink(member, 'history', point)">历史数据</RouterLink></div>
              </section>
            </template>
            <template v-else>
              <section v-for="channel in member.points" :key="channel.channelId" class="monitor-channel"><h3>{{ channel.name || channel.channelName || channel.channelId }}</h3><p>{{ channel.online === true ? '在线' : channel.online === false ? '离线' : '状态待确认' }}</p><p>网关 IP：{{ acousticPointIp(member.raw, channel) }}</p><p>通道：{{ channel.channelId }}</p><RouterLink :to="{ path: '/device/detail', query: { source: 'monitor', device: member.id, machine: selected.id, channelId: channel.channelId, tab: 'spectrum' } }">声纹监测与频谱 ↗</RouterLink></section>
            </template>
          </div>
          <p v-if="!member.points.length">{{ busy ? '正在加载点位…' : '暂无数值监测点位' }}</p>
        </section>
        <p v-if="!selected.members.length">{{ busy ? '正在加载采集来源…' : '暂未获取到该设备的采集来源' }}</p>
      </template>
      <p v-else>未找到该设备，请返回设备列表选择。</p>
    </template>
  </section>
</template>

<style scoped>
.machine-monitor { --wall-text: var(--text-main); --wall-muted: var(--text-muted); --wall-line: var(--glass-border); --wall-point: var(--glass-card-soft); padding: 24px; overflow-y: auto; color: var(--text-main); display: flex; flex-direction: column; gap: 20px; }
h1, h2, h3 { margin: 0; } p { color: var(--text-muted); line-height: 1.6; } a { color: var(--text-soft); text-decoration: none; }
.monitor-heading, .monitor-actions, .selected-machine, .monitor-source > header, .machine-entry header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; }
.monitor-heading h1 { font-size: 26px; }.monitor-heading p { margin-bottom: 0; }
.monitor-search { display: flex; align-items: center; gap: 12px; }.monitor-search input { padding: 10px 14px; background: var(--glass-card); border: 1px solid var(--control-border); border-radius: 6px; color: var(--text-main); }
.machine-directory { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
.machine-entry, .monitor-source, .monitor-channel { min-width: 0; padding: 24px; border: 1px solid var(--glass-border); border-radius: 10px; background: var(--glass-card); }
.machine-entry:hover { border-color: var(--control-border-active); }.machine-entry h2 { font-size: 22px; }.machine-entry header span { font-size: 13px; }
.machine-totals { display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0; }.machine-totals strong { font-size: 24px; }.machine-totals small { font-size: 13px; font-weight: normal; }.machine-totals span { align-self: center; }
.machine-entry ul { padding-left: 18px; line-height: 1.8; font-size: 14px; }.machine-entry li small { display: block; color: var(--text-muted); }.machine-entry footer { border-top: 1px solid var(--glass-border); padding-top: 16px; margin-top: 16px; }
.monitor-warning { padding: 12px; border: 1px solid #e4a26055; color: #d99545; border-radius: 6px; }
.machine-nav { display: flex; flex-wrap: wrap; gap: 10px; }.machine-nav a { padding: 10px 16px; border: 1px solid var(--glass-border); border-radius: 6px; }.machine-nav .active { background: var(--control-bg-active); border-color: var(--control-border-active); }
.monitor-point-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; margin-top: 18px; }.monitor-point-grid.single { grid-template-columns: minmax(0, 1fr); }.monitor-point-grid.double { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.monitor-measurement { min-width: 0; }.point-actions { display: flex; gap: 24px; padding: 12px 4px; }.monitor-point-grid :deep(.home-point-chart) { height: 170px; }.monitor-point-grid.single :deep(.home-point-chart), .monitor-point-grid.double :deep(.home-point-chart) { height: 230px; }
@media (max-width: 1100px) { .machine-directory, .monitor-point-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 650px) { .machine-monitor { padding: 14px; }.machine-directory, .monitor-point-grid, .monitor-point-grid.double { grid-template-columns: minmax(0, 1fr); } }
</style>
