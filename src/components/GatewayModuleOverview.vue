<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElDrawer } from 'element-plus'
import { telemetryApi } from '../services/telemetry'
import { fanGroupOf } from '../charts/machineGroups.js'
import { presentMonitoringPoint, monitoringPointName, sortMonitoringPoints } from '../charts/equipmentCatalog.js'
import { mergeGatewayInventory } from '../charts/gatewayCatalog.js'

const modules = ref([])
const errors = reactive({}), loading = ref(false), detailLoading = ref(false)
const search = ref(''), machine = ref('全部'), kind = ref('全部'), state = ref('全部')
const selectedKey = ref('legacy:VSE03'), rawPoints = ref([]), pointError = ref('')
const detailOpen = ref(false), refreshedAt = ref(null)
const activePoints = computed(() => rawPoints.value.map(presentMonitoringPoint))
const controller = new AbortController()
let pointController, pointVersion = 0, timer
const rows = computed(() => mergeGatewayInventory({ modules: modules.value, failed: errors }).filter(row => row.source === 'legacy'))
const selected = computed(() => rows.value.find(row => row.key === selectedKey.value))
const visible = computed(() => rows.value.filter(row => (machine.value === '全部' || row.machine === machine.value) && (kind.value === '全部' || row.kind === kind.value) && (state.value === '全部' || row.status === state.value) && `${row.name} ${row.host} ${row.controlHost || ''} ${row.entry?.host || ''} ${row.entry?.id || ''}`.toLowerCase().includes(search.value.trim().toLowerCase())))
const groups = computed(() => ['ZJ17', 'ZB25', 'YB55', '其他'].map(id => ({ id, rows: visible.value.filter(row => row.machine === id) })).filter(group => group.rows.length))
const counts = computed(() => ({ total: rows.value.length, online: rows.value.filter(row => row.online).length, offline: rows.value.filter(row => ['离线', '已停止'].includes(row.status)).length, pending: rows.value.filter(row => !['在线', '离线', '已停止'].includes(row.status)).length }))
const filtered = computed(() => search.value.trim() || [machine.value, kind.value, state.value].some(value => value !== '全部'))
function resetFilters() { search.value = ''; machine.value = kind.value = state.value = '全部' }
function openDetail(row) { selectedKey.value = row.key; detailOpen.value = true }
const dateText = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'
const facts = computed(() => {
  const row = selected.value
  if (!row) return []
  const raw = row.entry?.raw || {}, runtime = row.runtime
  return [['设备', row.machine], ['模块编号', row.entry?.id || row.moduleIds[0]], ['安装位置', row.location], ['所属交换机', row.network], ['通讯 IP', row.host], ['协议 / 驱动', raw.protocol || runtime.driver], ['端口', raw.port ?? raw.audioPort ?? runtime.port], ['从站地址', raw.unitId], ['采样率', runtime.configuredSampleRate ? `${runtime.configuredSampleRate} Hz` : null], ['最后数据', dateText(runtime.lastDataAt || raw.lastSeenAt)], ['状态更新', dateText(runtime.lastUpdatedAt || runtime.updatedAt)]]
})
function pointName(point) { return monitoringPointName(point) }
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
  try {
    const result = await telemetryApi.getModules({ signal })
    if (controller.signal.aborted) return
    if (!Array.isArray(result?.modules)) throw new Error('返回格式不正确')
    modules.value = result.modules.filter(module => !String(module.protocol || '').toLowerCase().includes('acoustic'))
    delete errors.modules
  } catch (error) {
    if (!controller.signal.aborted) errors.modules = error.message || '模块状态加载失败'
  } finally {
    loading.value = false
  }
  if (controller.signal.aborted) return
  refreshedAt.value = new Date()
  if (detailOpen.value) await loadPoints()
}
async function loadPoints() {
  pointController?.abort()
  const version = ++pointVersion
  rawPoints.value = []
  pointError.value = ''
  detailLoading.value = false
  const row = selected.value
  if (!row?.entry) return
  pointController = new AbortController()
  detailLoading.value = true
  try {
    const result = await telemetryApi.getModulePoints(row.entry.id, { signal: AbortSignal.any([controller.signal, pointController.signal]) })
    if (version !== pointVersion || controller.signal.aborted) return
    if (String(result?.moduleId) !== row.entry.id || !Array.isArray(result?.points)) throw new Error('点位返回格式不正确')
    rawPoints.value = sortMonitoringPoints(result.points.map(point => ({ ...point, moduleId: row.entry.id })))
  } catch (error) { if (version === pointVersion && !controller.signal.aborted) pointError.value = error.message || '点位加载失败' }
  finally { if (version === pointVersion) detailLoading.value = false }
}
watch([selectedKey, detailOpen], () => { if (detailOpen.value) loadPoints() })
onMounted(() => { refresh(); timer = window.setInterval(refresh, 30000) })
onBeforeUnmount(() => { controller.abort(); pointVersion++; pointController?.abort(); window.clearInterval(timer) })
defineExpose({ refresh, loading })
</script>

<template>
  <section class="module-overview" :aria-busy="loading">
    <div class="module-counts"><div>模块总数<strong>{{ counts.total }}</strong></div><div class="count-online">在线<strong>{{ counts.online }}</strong></div><div class="count-offline">离线 / 停止<strong>{{ counts.offline }}</strong></div><div class="count-pending">待确认<strong>{{ counts.pending }}</strong></div></div>
    <div class="module-filters">
      <input v-model="search" aria-label="搜索模块" placeholder="模块 / IP / 编号" />
      <select v-model="machine" aria-label="筛选设备"><option v-for="value in ['全部','ZJ17','ZB25','YB55','其他']" :key="value" :value="value">{{ value === '全部' ? '全部设备' : value }}</option></select>
      <select v-model="kind" aria-label="筛选类型"><option v-for="value in ['全部','振动','温度','压力','控制','其他']" :key="value" :value="value">{{ value === '全部' ? '全部类型' : value }}</option></select>
      <select v-model="state" aria-label="筛选状态"><option v-for="value in ['全部','在线','离线','已停止','连接中','状态未知','状态待确认','未接入']" :key="value" :value="value">{{ value === '全部' ? '全部状态' : value }}</option></select>
      <button v-if="filtered" class="module-reset" @click="resetFilters">显示全部</button>
    </div>
    <div class="module-overview-meta"><span>显示 {{ visible.length }} / {{ counts.total }} 个模块 · 点击查看详情</span><span>{{ loading ? '正在刷新…' : refreshedAt ? `更新于 ${refreshedAt.toLocaleTimeString('zh-CN', { hour12: false })}` : '等待状态数据' }} · 每 30 秒刷新</span></div>
    <p v-if="errors.modules" class="module-error" role="alert">数值模块：{{ errors.modules }}</p>
    <div class="module-workspace">
      <div class="module-groups">
        <section v-for="group in groups" :key="group.id" class="panel module-group">
          <h2>{{ group.id }} <span>{{ group.rows.filter(row => row.online).length }} / {{ group.rows.length }} 在线</span></h2>
          <div class="module-grid"><button v-for="row in group.rows" :key="row.key" class="module-card" :class="{ active: detailOpen && selectedKey === row.key }" :aria-label="`${group.id} ${row.name} ${row.status}，查看详情`" @click="openDetail(row)">
            <div><strong :title="row.name">{{ row.name }}</strong><span class="module-state" :class="{ online: row.online, offline: ['离线', '已停止'].includes(row.status) }">{{ row.status }}</span></div>
            <div><span>{{ row.kind }} · {{ row.entry?.id || row.moduleIds[0] || '采集器' }}</span><span>{{ row.host || row.entry?.host || '—' }}</span></div>
          </button></div>
        </section>
        <div v-if="!groups.length" class="empty-state">无匹配模块 <button class="module-reset" @click="resetFilters">显示全部</button></div>
      </div>
    </div>
    <el-drawer v-model="detailOpen" title="模块通讯详情" size="min(780px, 92vw)" class="module-detail-drawer">
      <section v-if="selected" class="panel module-detail">
        <header><h2>{{ selected.name }}</h2><span class="module-state" :class="{ online: selected.online, offline: ['离线', '已停止'].includes(selected.status) }">{{ selected.status }}</span></header>
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
    </el-drawer>
  </section>
</template>

<style scoped>
.module-overview { color:var(--text-main); }
.module-counts { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:12px 0; }
.module-counts > div { display:flex; align-items:center; justify-content:space-between; padding:8px 16px; border:1px solid var(--glass-border); border-radius:8px; background:var(--glass-card); font-size:15px; }
.module-counts strong { font-size:28px; color:#50b9a8; }
.module-counts .count-offline strong { color:var(--gateway-offline); }.module-counts .count-pending strong { color:var(--gateway-pending); }
.module-overview { --gateway-offline:#ee867c; --gateway-pending:#d6a354; }
:global(.light-theme) .module-overview { --gateway-offline:#bc4038; --gateway-pending:#91621c; }
.module-filters { display:flex; flex-wrap:wrap; gap:10px; margin:12px 0; }
input,select,button { font:inherit; color:var(--text-main); } input,select,.module-point-heading button,.module-reset { padding:8px 12px; background:var(--page-bg); border:1px solid var(--glass-border); border-radius:5px; }
.module-filters { font-size:14px; }.module-filters input { width:240px; max-width:100%; }
.module-overview-meta { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:10px 0; color:var(--text-muted); font-size:12px; }
button { cursor:pointer; } button:focus-visible { outline:2px solid #368ce8; outline-offset:2px; }
.module-workspace { min-width:0; }
.module-groups { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; align-items:start; }.module-group { padding:12px; min-width:0; }.module-group h2 { margin:0 0 12px; display:flex; justify-content:space-between; gap:8px; font-size:17px; }.module-group h2 span { color:var(--text-muted); font-size:13px; font-weight:normal; }
.module-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
.module-card { min-width:0; padding:10px; border:1px solid var(--glass-border); border-radius:6px; background:var(--glass-card); text-align:left; }.module-card.active,.module-card:hover { border-color:#50b9a8; background:color-mix(in srgb,#50b9a8 10%,var(--page-bg)); }
.module-card > div { display:flex; justify-content:space-between; gap:6px; align-items:center; }.module-card > div + div { margin-top:8px; flex-direction:column; align-items:flex-start; gap:3px; font-size:12px; color:var(--text-soft); overflow-wrap:anywhere; }.module-card strong { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; }.module-state { white-space:nowrap; font-size:12px; color:var(--gateway-pending,#d6a354); }.module-state::before { content:''; display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:4px; background:currentColor; }.module-state.online { color:#50b9a8; }.module-state.offline { color:var(--gateway-offline,#ee867c); }
.module-detail { padding:18px; }.module-detail header { display:flex; align-items:center; justify-content:space-between; gap:10px; }.module-detail h2 { font-size:18px; margin:0; }.module-detail h3 { font-size:15px; margin:18px 0 10px; }
.module-group h2 { padding:0; min-height:0; height:auto; line-height:24px; background:none; border:0; }
.module-group h2::before,.module-group h2::after { display:none; }
.module-card { padding:8px; line-height:1.3; }
.module-card > div + div { margin-top:6px; gap:2px; }
.module-detail-drawer { --el-drawer-bg-color:var(--page-bg); }
.module-facts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px 12px; padding-bottom:16px; border-bottom:1px solid var(--glass-border); }.module-facts dt { font-size:14px; color:var(--text-muted); }.module-facts dd { margin:6px 0 0; font-size:15px; overflow-wrap:anywhere; }
.module-error { color:#dfa357; font-size:14px; margin:10px 0; }.module-point-heading { margin-top:12px; }.module-point-heading h3 { margin:0; }
@media(min-width:1700px) { .module-grid { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media(max-height:800px) { .module-counts { margin:8px 0; }.module-counts > div { padding:6px 14px; }.module-counts strong { font-size:24px; }.module-filters { margin:8px 0; }.module-overview-meta { margin:8px 0; } }
@media(max-width:750px) { .module-groups { grid-template-columns:1fr; }.module-counts,.module-grid { grid-template-columns:repeat(2,minmax(0,1fr)); }.module-facts { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
