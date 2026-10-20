<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { Eye, RefreshCcw, RotateCcw, Search } from 'lucide-vue-next'
import AlarmPointFilters from './AlarmPointFilters.vue'
import { usePointAlarmQuery } from '../composables/usePointAlarmQuery.js'
import { alarmApi } from '../services/alarms.js'
import { alarmTime, alarmValue, legacyAlarmStatus } from '../charts/alarms.js'
import { isGradedAlarm, collectionAlarmType, alarmLevelText, alarmDirectionText, alarmTriggerValue, alarmThresholdText, filterCollectionAlarms } from '../charts/gradedAlarms.js'

const props = defineProps({ active: { type: Boolean, default: true }, initialModuleId: { type: String, default: '' }, initialPointCode: { type: String, default: '' }, initialScope: { type: Object, default: () => ({}) }, rowColor: { type: Function, default: () => 'var(--alarm-color-yellow, #f3c45c)' } })
const emit = defineEmits(['color-events'])
const alarms = usePointAlarmQuery(alarmApi.getAlarms, () => ({ ...props.initialScope, moduleId: props.initialModuleId, pointCode: props.initialPointCode }))
const { scope, filters, options, metadataError, metadataLoading, requested, error, loading, query, reset: resetFilters, changeScope } = alarms
filters.isActive = 'true'
const displayFilters = reactive({ severity: '' })
const detailOpen = ref(false)
const selectedAlarm = ref(null)
function showDetail(row) { selectedAlarm.value = row; detailOpen.value = true }
const page = ref(1)
const pageSize = 20
const mergedRows = alarms.rows
const queryStatusLabel = computed(() => {
  if (!requested.value) return ''
  const status = requested.value.isActive
  return status === true || status === 'true' ? '当前告警' : status === false || status === 'false' ? '已恢复' : '全部状态'
})
const initialLoading = ref(true)
const filteredRows = computed(() => filterCollectionAlarms(mergedRows.value, displayFilters))
const severityCards = computed(() => [
  { value: '', label: '全部报警', tone: 'all' },
  { value: '1', label: '损坏', tone: 'red' },
  { value: '2', label: '告警', tone: 'orange' },
  { value: '3', label: '提示', tone: 'yellow' },
  { value: 'limit', label: '上下限告警', tone: 'ungraded' },
  { value: 'other', label: '其他告警', tone: 'ungraded' },
].map(card => ({ ...card, count: mergedRows.value === null ? null : filterCollectionAlarms(mergedRows.value, { severity: card.value }).length }))
  .filter(card => card.value !== 'other' || card.count > 0))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / pageSize)))
const rows = computed(() => filteredRows.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch(mergedRows, value => { page.value = Math.min(page.value, pageCount.value); emit('color-events', value || []) })
watch(displayFilters, () => { page.value = 1 })
async function reset() { Object.assign(displayFilters, { severity: '' }); page.value = 1; await resetFilters() }
watch(() => [props.initialModuleId, props.initialPointCode, props.initialScope], async () => { alarms.applyInitial(); await changeScope() }, { deep: true })
let refreshTimer
onMounted(() => {
  alarms.initialize().finally(() => { initialLoading.value = false })
  refreshTimer = window.setInterval(() => {
    if (props.active && filters.isActive === 'true' && requested.value?.isActive === 'true'
      && !filters.range?.length && !loading.value && !metadataLoading.value && !detailOpen.value
      && globalThis.document?.visibilityState !== 'hidden') query()
  }, 3000)
})
onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <section :aria-busy="initialLoading" class="legacy-alarm-panel">
    <header><h2>采集报警</h2></header>
    <form class="legacy-alarm-filters" @submit.prevent="query">
      <AlarmPointFilters :scope="scope" :options="options" :loading="metadataLoading" @change="changeScope" />
      <label><span>恢复状态</span><el-select v-model="filters.isActive" aria-label="采集报警状态" placeholder="全部状态"><el-option label="全部状态" value="" /><el-option label="当前告警" value="true" /><el-option label="已恢复" value="false" /></el-select></label>
      <label><span>事件时间</span><el-date-picker v-model="filters.range" type="datetimerange" value-format="YYYY-MM-DDTHH:mm:ss" aria-label="采集报警事件时间" start-placeholder="开始时间" end-placeholder="结束时间" /></label>
      <label><span>最大条数</span><el-input-number v-model="filters.limit" :min="1" :max="1000" :step="1" controls-position="right" aria-label="采集报警最大条数" /></label>
      <div class="legacy-filter-actions"><el-button :icon="RotateCcw" @click="reset">重置</el-button><el-button native-type="submit" type="primary" :icon="Search" :loading="loading" :disabled="metadataLoading">查询</el-button></div>
    </form>
    <div v-if="requested" class="alarm-query-status" role="status" aria-live="polite">
      <strong class="alarm-query-badge">{{ queryStatusLabel }}</strong>
      <span v-if="queryStatusLabel === '全部状态'">当前告警 + 已恢复</span>
      <strong>本次返回 {{ mergedRows?.length || 0 }} 条</strong>
      <span v-if="requested.truncated" class="alarm-query-capped">已达 {{ requested.limit }} 条上限，非全部记录总数</span>
      <span v-else>查询上限 {{ requested.limit }} 条</span>
    </div>
    <div class="alarm-level-cards" role="group" aria-label="分级等级">
      <button v-for="card in severityCards" :key="card.value" type="button" class="alarm-level-card" :class="[card.tone, { 'is-selected': displayFilters.severity === card.value }]" :aria-pressed="displayFilters.severity === card.value" @click="displayFilters.severity = card.value">
        <span>{{ card.label }}</span><strong><DataLoading :loading="initialLoading" compact>{{ card.count ?? '—' }}</DataLoading></strong>
      </button>
    </div>
    <p v-if="metadataError" class="alarm-error" role="alert">点位加载失败：{{ metadataError }} <el-button size="small" :icon="RefreshCcw" :loading="metadataLoading" @click="alarms.initialize">刷新点位</el-button></p>
    <p v-if="error" class="alarm-error" role="alert">{{ error }}{{ mergedRows ? '，以下保留上次成功查询结果。' : '' }}</p>
    <div class="alarm-table-scroll"><DataLoading :loading="initialLoading">
      <table class="alarm-data-table"><thead><tr><th>开始时间</th><th>设备 / 点位 / 参数</th><th>类型 / 等级</th><th>状态</th><th>报警值</th><th>方向 / 触发阈值</th><th>恢复阈值</th><th>原因</th><th>详情</th></tr></thead><tbody>
        <tr v-for="(row, index) in rows" :key="String(row.alarmId ?? index)" :class="{ 'selected-alarm': selectedAlarm?.alarmId === row.alarmId && detailOpen }" :style="{ '--row-alarm-color': props.rowColor(row) }" data-colored-alarm><td>{{ alarmTime(row.startedAt) }}</td><td>{{ row.machineName }} / {{ row.modelId }}<small>{{ row.locationName }} / {{ row.targetName }}</small><small>{{ row.name }}</small></td><td>{{ collectionAlarmType(row) }}<small class="alarm-level-badge">{{ alarmLevelText(row) }}</small></td><td>{{ legacyAlarmStatus(row.status) }}</td><td>{{ alarmValue(row.alarmValue, row.unit) }}</td><td>{{ alarmDirectionText(row) }}<small>{{ alarmThresholdText(row) }}</small></td><td>{{ isGradedAlarm(row) ? alarmValue(row.recoveryThreshold, row.unit) : '—' }}</td><td class="alarm-reason">{{ row.reason || '—' }}</td><td><el-button text :icon="Eye" @click="showDetail(row)">查看</el-button></td></tr>
        <tr v-if="!rows.length"><td colspan="9" class="alarm-empty">{{ loading || metadataLoading ? '正在加载…' : mergedRows === null ? '报警事件暂不可用，请重试查询' : '本次查询没有匹配的报警事件' }}</td></tr>
      </tbody></table>
    </DataLoading></div>
    <footer class="alarm-pagination"><span>已获取 {{ mergedRows?.length || 0 }} 条 · 筛选 {{ filteredRows.length }} 条 · 每页 {{ pageSize }} 条 <strong v-if="requested?.truncated" class="alarm-result-limit" role="status">已达查询上限</strong></span><el-button :disabled="page <= 1" @click="page--">上一页</el-button><span>{{ page }} / {{ pageCount }}</span><el-button :disabled="page >= pageCount" @click="page++">下一页</el-button></footer>
    <ElDialog v-model="detailOpen" title="报警详情" width="min(840px, 94vw)" append-to=".dashboard-shell" class="alarm-detail-dialog" :close-on-click-modal="false" @closed="selectedAlarm = null">
      <dl v-if="selectedAlarm" class="alarm-detail-fields">
        <div><dt>报警 ID</dt><dd>{{ selectedAlarm.alarmId ?? '—' }}</dd></div>
        <div><dt>报警类型 / 等级</dt><dd :style="{ color: props.rowColor(selectedAlarm) }">{{ collectionAlarmType(selectedAlarm) }} / {{ alarmLevelText(selectedAlarm) }}</dd></div>
        <template v-if="isGradedAlarm(selectedAlarm)">
          <div><dt>报警方向</dt><dd>{{ alarmDirectionText(selectedAlarm) }}</dd></div>
          <div><dt>触发阈值</dt><dd>{{ alarmValue(alarmTriggerValue(selectedAlarm), selectedAlarm.unit) }}</dd></div>
          <div><dt>恢复阈值</dt><dd>{{ alarmValue(selectedAlarm.recoveryThreshold, selectedAlarm.unit) }}</dd></div>
        </template>
        <div><dt>设备归属</dt><dd>{{ selectedAlarm.machineName }} / {{ selectedAlarm.modelId }} / {{ selectedAlarm.locationName }} / {{ selectedAlarm.targetName }}</dd></div>
        <div><dt>监测点位</dt><dd>{{ selectedAlarm.name || selectedAlarm.pointCode || '—' }}</dd></div>
        <div><dt>模块 / 通道 / 点位编码</dt><dd>{{ selectedAlarm.moduleId || '—' }} / {{ selectedAlarm.channelId || '—' }} / {{ selectedAlarm.pointCode || '—' }}</dd></div>
        <div><dt>开始时间</dt><dd>{{ alarmTime(selectedAlarm.startedAt) }}</dd></div>
        <div><dt>状态（原始值）</dt><dd>{{ selectedAlarm.status ?? '—' }}</dd></div>
        <div><dt>报警值 / 恢复值</dt><dd>{{ alarmValue(selectedAlarm.alarmValue, selectedAlarm.unit) }} / {{ alarmValue(selectedAlarm.recoveryValue, selectedAlarm.unit) }}</dd></div>
        <div v-if="!isGradedAlarm(selectedAlarm)"><dt>阈值下限 / 上限</dt><dd>{{ alarmValue(selectedAlarm.thresholdMin, selectedAlarm.unit) }} / {{ alarmValue(selectedAlarm.thresholdMax, selectedAlarm.unit) }}</dd></div>
        <div><dt>恢复时间</dt><dd>{{ alarmTime(selectedAlarm.endedAt) }}</dd></div>
        <div><dt>持续秒数 / 质量</dt><dd>{{ selectedAlarm.durationSeconds ?? '—' }} / {{ selectedAlarm.quality ?? '—' }}</dd></div>
        <div><dt>指标类型</dt><dd>{{ selectedAlarm.metricType ?? '—' }}</dd></div>
        <div><dt>创建 / 更新时间</dt><dd>{{ alarmTime(selectedAlarm.createdAt) }} / {{ alarmTime(selectedAlarm.updatedAt) }}</dd></div>
        <div class="alarm-detail-wide"><dt>原因</dt><dd>{{ selectedAlarm.reason || '—' }}</dd></div>
      </dl>
      <template #footer><el-button @click="detailOpen = false">关闭</el-button></template>
    </ElDialog>
  </section>
</template>
