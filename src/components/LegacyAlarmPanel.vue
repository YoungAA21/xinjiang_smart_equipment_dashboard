<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAlarmStore } from '../stores/alarms.js'
import { telemetryApi } from '../services/telemetry.js'
import { alarmTime, alarmValue, legacyAlarmStatus } from '../charts/alarms.js'

const alarms = useAlarmStore()
const filters = reactive({ moduleId: '', pointId: '', isActive: '', start: '', end: '', limit: 200 })
const modules = ref([])
const points = ref([])
const metadataError = ref('')
const pointsLoading = ref(false)
const page = ref(1)
const pageSize = 20
const pageCount = computed(() => Math.max(1, Math.ceil((alarms.rows?.length || 0) / pageSize)))
const rows = computed(() => [...(alarms.rows || [])].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0)).slice((page.value - 1) * pageSize, page.value * pageSize))
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
    filters.pointId = points.value[0]?.pointId ?? ''
  } catch (error) { if (!controller.signal.aborted && version === pointVersion && error.name !== 'AbortError') metadataError.value = error.message }
  finally { if (version === pointVersion) pointsLoading.value = false }
}
function query() {
  if (filters.moduleId && !filters.pointId) return
  queryController?.abort()
  queryController = new AbortController()
  const { pointId, isActive, start, end, limit } = filters
  return alarms.load({ pointId, isActive, start, end, limit }, { signal: AbortSignal.any([controller.signal, queryController.signal]) })
}
function resetFilters() {
  Object.assign(filters, { moduleId: '', pointId: '', isActive: '', start: '', end: '', limit: 200 })
  changeModule()
  query()
}
watch(() => alarms.rows, () => { page.value = 1 })
onMounted(() => { loadModules(); query(); alarms.loadStatus({ signal: controller.signal }) })
onBeforeUnmount(() => { controller.abort(); queryController?.abort(); pointController?.abort(); pointVersion++; alarms.clear() })
</script>

<template>
  <section class="legacy-alarm-panel">
    <header><h2>5158 采集报警</h2><p>按 pointId 查询报警事件 · 当前告警 / 已恢复仅描述恢复状态，不等同于人工处理状态</p></header>
    <form class="legacy-alarm-filters" @submit.prevent="query">
      <label>模块<select v-model="filters.moduleId" aria-label="5158 报警模块" @change="changeModule"><option value="">全部模块</option><option v-for="module in modules" :key="module.moduleId" :value="module.moduleId">{{ module.moduleId }} / {{ module.moduleName }}</option></select></label>
      <label>点位<select v-model="filters.pointId" aria-label="5158 报警点位" :disabled="!filters.moduleId || pointsLoading"><option value="">{{ pointsLoading ? '正在加载点位' : filters.moduleId ? '请选择点位' : '全部点位' }}</option><option v-for="point in points" :key="point.pointId" :value="point.pointId">#{{ point.pointId }} / {{ point.channelId }} / {{ point.pointCode }} / {{ point.name }}</option></select></label>
      <label>恢复状态<select v-model="filters.isActive" aria-label="5158 报警状态"><option value="">全部状态</option><option value="true">当前告警</option><option value="false">已恢复</option></select></label>
      <label>开始时间<input v-model="filters.start" type="datetime-local" step="1" aria-label="5158 报警开始时间" /></label>
      <label>结束时间<input v-model="filters.end" type="datetime-local" step="1" aria-label="5158 报警结束时间" /></label>
      <label>最大条数<input v-model.number="filters.limit" type="number" min="1" max="1000" aria-label="5158 报警最大条数" /></label>
      <button type="submit" :disabled="alarms.loading || pointsLoading || (!!filters.moduleId && !filters.pointId)">{{ alarms.loading ? '查询中…' : '查询 5158 报警' }}</button><button type="button" @click="resetFilters">重置查询</button>
    </form>
    <p class="alarm-muted">不填时间查全部时段，最多返回指定条数；模块用于选择点位，查询只发送 pointId。</p>
    <p v-if="metadataError" class="alarm-error" role="alert">模块/点位加载失败：{{ metadataError }} <button @click="filters.moduleId ? changeModule() : loadModules()">重试元数据</button></p>
    <p v-if="alarms.error" class="alarm-error" role="alert">{{ alarms.error }}。{{ alarms.rows ? '以下保留上次成功查询的数据。' : '尚未获取报警事件，不能据此判断没有告警。' }} 18080 告警不受此错误影响。</p>
    <p class="alarm-muted">上次成功查询：{{ queryLabel }} · 更新 {{ alarmTime(alarms.updatedAt) }}</p>
    <p v-if="alarms.rows && alarms.rows.length >= alarms.requested.limit" class="alarm-error">结果达到 {{ alarms.requested.limit }} 条上限，可能并非全部报警。请缩小时间范围或选择点位。</p>
    <div v-if="alarms.loading" role="status" class="alarm-muted">正在读取 5158 报警事件…</div>
    <div class="alarm-table-scroll">
      <table class="alarm-data-table"><thead><tr><th>开始时间</th><th>模块 / 点位</th><th>状态</th><th>报警值</th><th>原因</th><th>详情</th></tr></thead><tbody>
        <tr v-for="(row, index) in rows" :key="String(row.alarmId ?? index)" :class="{ 'selected-alarm': alarms.selected === row }"><td>{{ alarmTime(row.startedAt) }}</td><td>{{ row.moduleId }}<small>{{ row.channelId }} / {{ row.pointCode }}</small></td><td>{{ legacyAlarmStatus(row.status) }}</td><td>{{ alarmValue(row.alarmValue, row.unit) }}</td><td class="alarm-reason">{{ row.reason || '—' }}</td><td><button @click="alarms.selected = row">查看</button></td></tr>
        <tr v-if="!rows.length"><td colspan="6" class="alarm-empty">{{ alarms.loading ? '正在加载…' : alarms.rows === null ? '报警事件暂不可用，请重试查询' : '本次查询没有匹配的报警事件' }}</td></tr>
      </tbody></table>
    </div>
    <footer class="alarm-pagination"><span>已获取 {{ alarms.rows?.length ?? '—' }} 条 · 每页 {{ pageSize }} 条</span><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pageCount }}</span><button :disabled="page >= pageCount" @click="page++">下一页</button></footer>
    <section v-if="alarms.selected" class="alarm-detail-card">
      <h3>报警详情 · {{ alarms.selected.alarmId }}</h3>
      <dl><div><dt>状态（原始值）</dt><dd>{{ alarms.selected.status ?? '—' }}</dd></div><div><dt>报警值 / 恢复值</dt><dd>{{ alarmValue(alarms.selected.alarmValue, alarms.selected.unit) }} / {{ alarmValue(alarms.selected.recoveryValue, alarms.selected.unit) }}</dd></div><div><dt>阈值下限 / 上限</dt><dd>{{ alarmValue(alarms.selected.thresholdMin, alarms.selected.unit) }} / {{ alarmValue(alarms.selected.thresholdMax, alarms.selected.unit) }}</dd></div><div><dt>恢复时间</dt><dd>{{ alarmTime(alarms.selected.endedAt) }}</dd></div><div><dt>持续秒数 / 质量</dt><dd>{{ alarms.selected.durationSeconds ?? '—' }} / {{ alarms.selected.quality ?? '—' }}</dd></div><div><dt>指标类型</dt><dd>{{ alarms.selected.metricType ?? '—' }}</dd></div><div><dt>创建 / 更新时间</dt><dd>{{ alarmTime(alarms.selected.createdAt) }} / {{ alarmTime(alarms.selected.updatedAt) }}</dd></div></dl>
      <p>{{ alarms.selected.reason || '—' }}</p><p class="alarm-muted">5158 文档仅提供查询接口，不提供确认、消警或处理操作。</p>
    </section>
    <details class="alarm-worker"><summary>分析 Worker 状态（独立于报警事件查询）</summary><button :disabled="alarms.statusLoading" @click="alarms.loadStatus({ signal: controller.signal })">刷新分析状态</button><p v-if="alarms.statusError" class="alarm-error">{{ alarms.statusError }}</p><template v-if="alarms.status"><p>更新时间 {{ alarmTime(alarms.status.generatedAt) }} · 队列 {{ alarms.status.analysisPending ?? '—' }} · 累计分析 {{ alarms.status.runtimeStatus.totalAnalyzedCount ?? '—' }} · 累计报警 {{ alarms.status.runtimeStatus.totalAlarmCount ?? '—' }} · 累计恢复 {{ alarms.status.runtimeStatus.totalRecoveryCount ?? '—' }}</p><p class="alarm-muted">以下为分析内存状态，不作为报警事件列表的替代数据。</p><p v-for="item in alarms.status.runtimeStatus.activeAlarms || []" :key="[item.moduleId,item.channelId,item.pointCode].join('/')">{{ item.moduleId }} / {{ item.pointCode }} · {{ alarmValue(item.value, item.unit) }} · {{ item.reason }}</p></template></details>
  </section>
</template>
