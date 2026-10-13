<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { telemetryApi } from '../services/telemetry'
import { api } from '../services/api'
import { acousticChannelDisplayName, fanGroupOf } from '../charts/machineGroups.js'
import { isMeasurementPoint, monitoringPointName, sortMonitoringPoints } from '../charts/equipmentCatalog.js'
import { mergeGatewayInventory } from '../charts/gatewayCatalog.js'

const modules = ref([]), devices = ref([]), statuses = ref([])
const errors = reactive({}), loading = ref(false), detailLoading = ref(false)
const search = ref(''), machine = ref('全部'), kind = ref('全部'), state = ref('全部')
const selectedKey = ref('legacy:VSE03'), activePoints = ref([]), pointError = ref('')
const controller = new AbortController()
let pointController, pointVersion = 0, timer
const rows = computed(() => mergeGatewayInventory({ modules: modules.value, devices: devices.value, statuses: statuses.value, failed: errors }))
const selected = computed(() => rows.value.find(row => row.key === selectedKey.value))
const visible = computed(() => rows.value.filter(row => (machine.value === '全部' || row.machine === machine.value) && (kind.value === '全部' || row.kind === kind.value) && (state.value === '全部' || row.status === state.value) && `${row.name} ${row.host} ${row.controlHost || ''} ${row.entry?.host || ''} ${row.entry?.id || ''}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const groups = computed(() => ['ZJ117', 'ZB25', 'YB55', '其他'].map(id => ({ id, rows: visible.value.filter(row => row.machine === id) })).filter(group => group.rows.length))
const counts = computed(() => ({ total: rows.value.length, online: rows.value.filter(row => row.online).length, offline: rows.value.filter(row => ['离线', '已停止'].includes(row.status)).length, pending: rows.value.filter(row => !['在线', '离线', '已停止'].includes(row.status)).length }))
const dateText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const facts = computed(() => {
  const row = selected.value
  if (!row) return []
  const raw = row.entry?.raw || {}, runtime = row.runtime
  return [['设备', row.machine], ['模块编号', row.entry?.id || row.moduleIds[0]], ['安装位置', row.location], ['所属交换机', row.network], ['通讯 IP', row.host], ['协议 / 驱动', raw.protocol || runtime.driver], ['端口', raw.port ?? raw.audioPort ?? runtime.port], ['从站地址', raw.unitId], ['采样率', runtime.configuredSampleRate ? `${runtime.configuredSampleRate} Hz` : null], ['最后数据', dateText(runtime.lastDataAt || raw.lastSeenAt)], ['状态更新', dateText(runtime.lastUpdatedAt || runtime.updatedAt)]]
})
function pointName(point) { return selected.value?.source === 'legacy' ? monitoringPointName(point) : acousticChannelDisplayName(selected.value?.entry?.device || {}, point) }
function pointGroup(point) {
  const row = selected.value
  if (!row?.entry) return '—'
  const group = fanGroupOf({ member: { source: row.source, id: row.entry.id, raw: row.entry.device || row.entry.raw }, point })
  return group === 've' ? 'VE 风机' : group === 'max' ? 'MAX 风机' : '—'
}
async function refresh() {
  if (loading.value || controller.signal.aborted) return
  loading.value = true
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])
  const results = await Promise.allSettled([telemetryApi.getModules({ signal }), api.getMonitorDevices({ signal }), api.getCollectorStatuses({ signal })])
  if (controller.signal.aborted) return
  results.forEach((result, index) => {
    const key = ['modules', 'devices', 'statuses'][index]
    const value = result.status === 'fulfilled' ? index === 0 ? result.value?.modules : result.value : null
    if (!Array.isArray(value)) { errors[key] = result.reason?.message || '返回格式不正确'; return }
    ;[modules, devices, statuses][index].value = value
    delete errors[key]
  })
  loading.value = false
  await loadPoints()
}
async function loadPoints() {
  pointController?.abort()
  const version = ++pointVersion
  activePoints.value = []
  pointError.value = ''
  detailLoading.value = false
  const row = selected.value
  if (!row?.entry) return
  if (row.source === 'monitor') { activePoints.value = row.entry.points; return }
  pointController = new AbortController()
  detailLoading.value = true
  try {
    const result = await telemetryApi.getModulePoints(row.entry.id, { signal: AbortSignal.any([controller.signal, pointController.signal]) })
    if (version !== pointVersion || controller.signal.aborted) return
    if (String(result?.moduleId) !== row.entry.id || !Array.isArray(result?.points)) throw new Error('点位返回格式不正确')
    activePoints.value = sortMonitoringPoints(result.points.filter(isMeasurementPoint))
  } catch (error) { if (version === pointVersion && !controller.signal.aborted) pointError.value = error.message || '点位加载失败' }
  finally { if (version === pointVersion) detailLoading.value = false }
}
watch(selectedKey, loadPoints)
onMounted(() => { refresh(); timer = window.setInterval(refresh, 30000) })
onBeforeUnmount(() => { controller.abort(); pointVersion++; pointController?.abort(); window.clearInterval(timer) })
defineExpose({ refresh })
</script>

<template>
  <section class="module-overview" :aria-busy="loading">
    <div class="module-counts"><div>模块总数<strong>{{ counts.total }}</strong></div><div>在线<strong>{{ counts.online }}</strong></div><div>离线 / 停止<strong>{{ counts.offline }}</strong></div><div>待确认<strong>{{ counts.pending }}</strong></div></div>
    <div class="module-filters">
      <input v-model="search" aria-label="搜索模块" placeholder="模块 / IP / 编号" />
      <select v-model="machine" aria-label="筛选设备"><option v-for="value in ['全部','ZJ117','ZB25','YB55','其他']" :key="value" :value="value">{{ value === '全部' ? '全部设备' : value }}</option></select>
      <select v-model="kind" aria-label="筛选类型"><option v-for="value in ['全部','振动','温度','压力','控制','声纹','其他']" :key="value" :value="value">{{ value === '全部' ? '全部类型' : value }}</option></select>
      <select v-model="state" aria-label="筛选状态"><option v-for="value in ['全部','在线','离线','已停止','连接中','状态未知','状态待确认','未接入']" :key="value" :value="value">{{ value === '全部' ? '全部状态' : value }}</option></select>
    </div>
    <p v-for="(error, key) in errors" :key="key" class="module-error" role="alert">{{ { modules:'数值模块', devices:'声纹配置', statuses:'声纹状态' }[key] }}：{{ error }}</p>
    <div class="module-workspace">
      <div class="module-groups">
        <section v-for="group in groups" :key="group.id" class="panel module-group">
          <h2>{{ group.id }} <span>{{ group.rows.length }}</span></h2>
          <div class="module-grid"><button v-for="row in group.rows" :key="row.key" class="module-card" :class="{ active: selectedKey === row.key }" :aria-pressed="selectedKey === row.key" @click="selectedKey = row.key">
            <div><strong>{{ row.name }}</strong><span class="module-state" :class="{ online: row.online, offline: row.status === '离线' }">{{ row.status }}</span></div>
            <div><span>{{ row.kind }}</span><span>{{ row.host || row.entry?.host || '—' }}</span></div>
          </button></div>
        </section>
        <div v-if="!groups.length" class="empty-state">无匹配模块</div>
      </div>
      <section v-if="selected" class="panel module-detail">
        <header><h2>{{ selected.name }}</h2><span class="module-state" :class="{ online: selected.online }">{{ selected.status }}</span></header>
        <dl class="module-facts"><template v-for="[label,value] in facts" :key="label"><div v-if="value !== undefined && value !== null && value !== ''"><dt>{{ label }}</dt><dd>{{ value }}</dd></div></template></dl>
        <p v-if="selected.runtime.offlineReason || selected.runtime.lastError" class="module-error">{{ selected.runtime.offlineReason || selected.runtime.lastError }}</p>
        <header class="module-point-heading"><h3>监测点位</h3><button :disabled="detailLoading || !selected.entry" @click="loadPoints">{{ detailLoading ? '加载中' : '刷新点位' }}</button></header>
        <p v-if="pointError" class="module-error" role="alert">{{ pointError }}</p>
        <el-table :data="activePoints" class="gateway-table" max-height="300" :empty-text="detailLoading ? '加载中' : '暂无接口点位'">
          <el-table-column label="名称" min-width="150"><template #default="{row}">{{ pointName(row) }}</template></el-table-column>
          <el-table-column label="分组" width="100"><template #default="{row}">{{ pointGroup(row) }}</template></el-table-column>
          <el-table-column prop="channelId" label="通道" min-width="100" />
          <el-table-column prop="pointCode" label="点位编码" min-width="125" />
          <el-table-column label="寄存器" width="90"><template #default="{row}">{{ row.address ?? '—' }}</template></el-table-column>
          <el-table-column prop="unit" label="单位" width="100" />
        </el-table>
      </section>
    </div>
  </section>
</template>

<style scoped>
.module-overview { color:var(--text-main); }
.module-counts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:12px 0; }
.module-counts > div { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border:1px solid var(--glass-border); border-radius:8px; background:var(--glass-card); font-size:15px; }
.module-counts strong { font-size:28px; color:#50b9a8; }
.module-filters { display:flex; flex-wrap:wrap; gap:10px; margin:12px 0; }
input,select,button { font:inherit; color:var(--text-main); } input,select,.module-point-heading button { padding:8px 12px; background:var(--page-bg); border:1px solid var(--glass-border); border-radius:5px; }
button { cursor:pointer; } button:focus-visible { outline:2px solid #368ce8; outline-offset:2px; }
.module-workspace { display:grid; grid-template-columns:minmax(0,1fr) minmax(520px,1.05fr); gap:14px; align-items:start; }
.module-groups { display:grid; gap:12px; }.module-group { padding:14px; }.module-group h2 { margin:0 0 12px; display:flex; gap:12px; font-size:17px; }.module-group h2 span { color:var(--text-muted); }
.module-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.module-card { min-width:0; padding:12px; border:1px solid var(--glass-border); border-radius:6px; background:var(--glass-card); text-align:left; }.module-card.active { border-color:#50b9a8; background:color-mix(in srgb,#50b9a8 10%,var(--page-bg)); }
.module-card > div { display:flex; justify-content:space-between; gap:8px; align-items:center; }.module-card > div + div { margin-top:12px; font-size:14px; color:var(--text-soft); }.module-card strong { font-size:15px; }.module-state { white-space:nowrap; font-size:14px; color:#d6a354; }.module-state.online { color:#50b9a8; }.module-state.offline { color:#ee867c; }
.module-detail { padding:18px; }.module-detail header { display:flex; align-items:center; justify-content:space-between; gap:10px; }.module-detail h2 { font-size:18px; margin:0; }.module-detail h3 { font-size:15px; margin:18px 0 10px; }
.module-facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 12px; padding-bottom:16px; border-bottom:1px solid var(--glass-border); }.module-facts dt { font-size:14px; color:var(--text-muted); }.module-facts dd { margin:6px 0 0; font-size:15px; overflow-wrap:anywhere; }
.module-error { color:#dfa357; font-size:14px; margin:10px 0; }.module-point-heading { margin-top:12px; }.module-point-heading h3 { margin:0; }
@media(max-width:1300px) { .module-workspace { grid-template-columns:1fr; }.module-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media(max-width:750px) { .module-counts,.module-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.module-facts { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
