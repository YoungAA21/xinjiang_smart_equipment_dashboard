<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Eye, RefreshCcw, RotateCcw, Search } from 'lucide-vue-next'
import { useAlarmStore } from '../stores/alarms.js'
import { telemetryApi } from '../services/telemetry.js'
import { alarmTime, alarmValue, legacyAlarmStatus } from '../charts/alarms.js'
import { useDigitalAlarmStore } from '../stores/digitalAlarms.js'
import { filterDigitalAlarms } from '../charts/digitalAlarms.js'

const props = defineProps({ initialModuleId: { type: String, default: '' }, initialPointCode: { type: String, default: '' }, rowColor: { type: Function, default: () => 'var(--alarm-color-yellow, #f3c45c)' } })
const alarms = useAlarmStore()
const digitalAlarms = useDigitalAlarmStore()
const filters = reactive({ moduleId: props.initialModuleId, pointId: '', isActive: 'all', start: '', end: '', limit: 200 })
const modules = ref([])
const points = ref([])
const metadataError = ref('')
const pointsLoading = ref(false)
const page = ref(1)
const pageSize = 20
const mergedRows = computed(() => {
  const pointCode = points.value.find(point => String(point.pointId) === String(filters.pointId))?.pointCode
  const local = filterDigitalAlarms(digitalAlarms.events, { ...filters, pointCode })
  return [...(alarms.rows || []), ...local].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0))
})
const pageCount = computed(() => Math.max(1, Math.ceil(mergedRows.value.length / pageSize)))
const rows = computed(() => mergedRows.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const controller = new AbortController()
let queryController, pointController
let pointVersion = 0
const queryLabel = computed(() => alarms.requested ? `pointId ${alarms.requested.pointId ?? '全部'} · ${alarms.requested.isActive === undefined ? '全部状态' : alarms.requested.isActive ? '当前告警' : '已恢复'} · ${alarmTime(alarms.requested.start)} → ${alarmTime(alarms.requested.end)} · 上限 ${alarms.requested.limit}` : '尚未获取报警事件')

async function loadModules() {
  metadataError.value = ''
  try {
    const data = await telemetryApi.getModules({ signal: controller.signal })
    if (controller.signal.aborted) return
    if (!Array.isArray(data?.modules)) throw new Error('模块响应格式不正确')
    modules.value = data.modules
    if (!filters.moduleId || !modules.value.some((module) => module.moduleId === filters.moduleId)) {
      filters.moduleId = modules.value[0]?.moduleId || ''
    }
    if (filters.moduleId) await changeModule()
  } catch (error) { if (!controller.signal.aborted) metadataError.value = error.message }
}
async function changeModule() {
  pointController?.abort()
  const version = ++pointVersion
  filters.pointId = ''
  points.value = []
  metadataError.value = ''
  pointsLoading.value = false
  if (!filters.moduleId) return
  pointController = new AbortController()
  pointsLoading.value = true
  try {
    const data = await telemetryApi.getModulePoints(filters.moduleId, { signal: AbortSignal.any([controller.signal, pointController.signal]) })
    if (controller.signal.aborted || version !== pointVersion) return
    if (!Array.isArray(data?.points)) throw new Error('点位响应格式不正确')
    points.value = data.points
    filters.pointId = (filters.moduleId === props.initialModuleId ? points.value.find(point => point.pointCode === props.initialPointCode)?.pointId : undefined) ?? points.value[0]?.pointId ?? ''
  } catch (error) { if (!controller.signal.aborted && version === pointVersion && error.name !== 'AbortError') metadataError.value = error.message }
  finally { if (version === pointVersion) pointsLoading.value = false }
}
function query() {
  if (filters.moduleId && !filters.pointId) return
  queryController?.abort()
  queryController = new AbortController()
  const { pointId, start, end, limit } = filters
  const isActive = filters.isActive === 'all' ? '' : filters.isActive
  return alarms.load({ pointId, isActive, start, end, limit }, { signal: AbortSignal.any([controller.signal, queryController.signal]) })
}
async function handleModuleChange() {
  await changeModule()
  await query()
}
async function resetFilters() {
  Object.assign(filters, { moduleId: modules.value[0]?.moduleId || '', pointId: '', isActive: 'all', start: '', end: '', limit: 200 })
  if (filters.moduleId) await changeModule()
  await query()
}
watch(mergedRows, () => { page.value = Math.min(page.value, pageCount.value) })
watch(() => [props.initialModuleId, props.initialPointCode], async () => {
  filters.moduleId = props.initialModuleId
  await loadModules()
  await query()
})
onMounted(async () => { await loadModules(); await query(); alarms.loadStatus({ signal: controller.signal }) })
onBeforeUnmount(() => { controller.abort(); queryController?.abort(); pointController?.abort(); pointVersion++; alarms.clear() })
</script>

<template>
  <section class="legacy-alarm-panel">
    <header><h2>采集报警</h2></header>
    <form class="legacy-alarm-filters" @submit.prevent="query">
      <label><span>模块</span><el-select v-model="filters.moduleId" filterable aria-label="采集报警模块" placeholder="选择模块" :loading="!modules.length && !metadataError" @change="handleModuleChange"><el-option v-for="module in modules" :key="module.moduleId" :label="`${module.moduleId} / ${module.moduleName}`" :value="module.moduleId" /></el-select></label>
      <label><span>点位</span><el-select v-model="filters.pointId" filterable aria-label="采集报警点位" placeholder="选择点位" :loading="pointsLoading" :disabled="!filters.moduleId"><el-option v-for="point in points" :key="point.pointId" :label="`#${point.pointId} / ${point.channelId} / ${point.pointCode} / ${point.name}`" :value="point.pointId" /></el-select></label>
      <label><span>恢复状态</span><el-select v-model="filters.isActive" aria-label="采集报警状态"><el-option label="全部状态" value="all" /><el-option label="当前告警" value="true" /><el-option label="已恢复" value="false" /></el-select></label>
      <label><span>开始时间</span><el-date-picker v-model="filters.start" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" aria-label="采集报警开始时间" placeholder="选择开始时间" /></label>
      <label><span>结束时间</span><el-date-picker v-model="filters.end" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" aria-label="采集报警结束时间" placeholder="选择结束时间" /></label>
      <label><span>最大条数</span><el-input-number v-model="filters.limit" :min="1" :max="1000" :step="1" controls-position="right" aria-label="采集报警最大条数" /></label>
      <div class="legacy-filter-actions"><el-button :icon="RotateCcw" @click="resetFilters">重置</el-button><el-button native-type="submit" type="primary" :icon="Search" :loading="alarms.loading" :disabled="pointsLoading || (!!filters.moduleId && !filters.pointId)">查询</el-button></div>
    </form>
    <p class="alarm-muted">不填时间查全部时段，最多返回指定条数；模块用于选择点位，查询只发送 pointId。</p>
    <p v-if="metadataError" class="alarm-error" role="alert">模块/点位加载失败：{{ metadataError }} <el-button size="small" :icon="RefreshCcw" @click="filters.moduleId ? changeModule() : loadModules()">重试</el-button></p>
    <p v-if="alarms.error" class="alarm-error" role="alert">{{ alarms.error }}。{{ alarms.rows ? '以下保留上次成功查询的数据。' : '服务端报警事件暂不可用。' }} 本地 DI 告警仍会显示。</p>
    <p v-if="digitalAlarms.error || digitalAlarms.cacheError" class="alarm-error" role="alert">{{ digitalAlarms.error || digitalAlarms.cacheError }}；已缓存的 DI 告警保留。</p>
    <p class="alarm-muted">上次成功查询：{{ queryLabel }} · 更新 {{ alarmTime(alarms.updatedAt) }}</p>
    <p v-if="alarms.rows && alarms.rows.length >= alarms.requested.limit" class="alarm-error">结果达到 {{ alarms.requested.limit }} 条上限，可能并非全部报警。请缩小时间范围或选择点位。</p>
    <div v-if="alarms.loading" role="status" class="alarm-muted">正在读取报警事件…</div>
    <div class="alarm-table-scroll">
      <table class="alarm-data-table"><thead><tr><th>开始时间</th><th>模块 / 点位</th><th>状态</th><th>报警值</th><th>原因</th><th>详情</th></tr></thead><tbody>
        <tr v-for="(row, index) in rows" :key="String(row.alarmId ?? index)" :class="{ 'selected-alarm': alarms.selected === row }" :style="{ '--row-alarm-color': props.rowColor(row) }" data-colored-alarm><td>{{ alarmTime(row.startedAt) }}</td><td>{{ row.moduleId }}<small>{{ row.channelId }} / {{ row.pointCode }}</small><small v-if="row.source === 'digital-local'">{{ row.name }} · 本地 DI 告警</small></td><td>{{ legacyAlarmStatus(row.status) }}</td><td>{{ alarmValue(row.alarmValue, row.unit) }}</td><td class="alarm-reason">{{ row.reason || '—' }}</td><td><el-button text :icon="Eye" @click="alarms.selected = row">查看</el-button></td></tr>
        <tr v-if="!rows.length"><td colspan="6" class="alarm-empty">{{ alarms.loading ? '正在加载…' : alarms.rows === null ? '报警事件暂不可用，请重试查询' : '本次查询没有匹配的报警事件' }}</td></tr>
      </tbody></table>
    </div>
    <footer class="alarm-pagination"><span>已获取 {{ mergedRows.length }} 条 · 每页 {{ pageSize }} 条</span><el-button :disabled="page <= 1" @click="page--">上一页</el-button><span>{{ page }} / {{ pageCount }}</span><el-button :disabled="page >= pageCount" @click="page++">下一页</el-button></footer>
    <section v-if="alarms.selected" class="alarm-detail-card">
      <h3>报警详情 · {{ alarms.selected.alarmId }}</h3>
      <dl><div><dt>状态（原始值）</dt><dd>{{ alarms.selected.status ?? '—' }}</dd></div><div><dt>报警值 / 恢复值</dt><dd>{{ alarmValue(alarms.selected.alarmValue, alarms.selected.unit) }} / {{ alarmValue(alarms.selected.recoveryValue, alarms.selected.unit) }}</dd></div><div><dt>阈值下限 / 上限</dt><dd>{{ alarmValue(alarms.selected.thresholdMin, alarms.selected.unit) }} / {{ alarmValue(alarms.selected.thresholdMax, alarms.selected.unit) }}</dd></div><div><dt>恢复时间</dt><dd>{{ alarmTime(alarms.selected.endedAt) }}</dd></div><div><dt>持续秒数 / 质量</dt><dd>{{ alarms.selected.durationSeconds ?? '—' }} / {{ alarms.selected.quality ?? '—' }}</dd></div><div><dt>指标类型</dt><dd>{{ alarms.selected.metricType ?? '—' }}</dd></div><div><dt>创建 / 更新时间</dt><dd>{{ alarmTime(alarms.selected.createdAt) }} / {{ alarmTime(alarms.selected.updatedAt) }}</dd></div></dl>
      <p>{{ alarms.selected.reason || '—' }}</p><p class="alarm-muted">当前接口仅提供查询能力，不提供确认、消警或处理操作。</p>
    </section>
    <details class="alarm-worker"><summary>分析 Worker 状态（独立于报警事件查询）</summary><el-button :icon="RefreshCcw" :loading="alarms.statusLoading" @click="alarms.loadStatus({ signal: controller.signal })">刷新分析状态</el-button><p v-if="alarms.statusError" class="alarm-error">{{ alarms.statusError }}</p><template v-if="alarms.status"><p>更新时间 {{ alarmTime(alarms.status.generatedAt) }} · 队列 {{ alarms.status.analysisPending ?? '—' }} · 累计分析 {{ alarms.status.runtimeStatus.totalAnalyzedCount ?? '—' }} · 累计报警 {{ alarms.status.runtimeStatus.totalAlarmCount ?? '—' }} · 累计恢复 {{ alarms.status.runtimeStatus.totalRecoveryCount ?? '—' }}</p><p v-for="item in alarms.status.runtimeStatus.activeAlarms || []" :key="[item.moduleId,item.channelId,item.pointCode].join('/')">{{ item.moduleId }} / {{ item.pointCode }} · {{ alarmValue(item.value, item.unit) }} · {{ item.reason }}</p></template></details>
  </section>
</template>

