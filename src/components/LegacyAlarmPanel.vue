<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import { Eye, RefreshCcw, RotateCcw, Search } from 'lucide-vue-next'
import AlarmPointFilters from './AlarmPointFilters.vue'
import { usePointAlarmQuery } from '../composables/usePointAlarmQuery.js'
import { alarmApi } from '../services/alarms.js'
import { alarmTime, alarmValue, legacyAlarmStatus } from '../charts/alarms.js'

const props = defineProps({ initialModuleId: { type: String, default: '' }, initialPointCode: { type: String, default: '' }, initialScope: { type: Object, default: () => ({}) }, rowColor: { type: Function, default: () => 'var(--alarm-color-yellow, #f3c45c)' } })
const emit = defineEmits(['color-events'])
const alarms = usePointAlarmQuery(alarmApi.getAlarms, () => ({ ...props.initialScope, moduleId: props.initialModuleId, pointCode: props.initialPointCode }))
const { scope, filters, options, metadataError, metadataLoading, requested, updatedAt, error, loading, query, reset: resetFilters, changeScope } = alarms
const detailOpen = ref(false)
const selectedAlarm = ref(null)
function showDetail(row) { selectedAlarm.value = row; detailOpen.value = true }
const page = ref(1)
const pageSize = 20
const mergedRows = alarms.rows
const pageCount = computed(() => Math.max(1, Math.ceil((mergedRows.value?.length || 0) / pageSize)))
const rows = computed(() => (mergedRows.value || []).slice((page.value - 1) * pageSize, page.value * pageSize))
watch(mergedRows, value => { page.value = 1; detailOpen.value = false; selectedAlarm.value = null; emit('color-events', value || []) })
watch(() => [props.initialModuleId, props.initialPointCode, props.initialScope], async () => { alarms.applyInitial(); await changeScope() }, { deep: true })
onMounted(alarms.initialize)
</script>

<template>
  <section class="legacy-alarm-panel">
    <header><h2>采集报警</h2></header>
    <form class="legacy-alarm-filters" @submit.prevent="query">
      <AlarmPointFilters :scope="scope" :options="options" :loading="metadataLoading" @change="changeScope" />
      <label><span>恢复状态</span><el-select v-model="filters.isActive" aria-label="采集报警状态" placeholder="全部状态"><el-option label="全部状态" value="" /><el-option label="当前告警" value="true" /><el-option label="已恢复" value="false" /></el-select></label>
      <label><span>事件时间</span><el-date-picker v-model="filters.range" type="datetimerange" value-format="YYYY-MM-DDTHH:mm:ss" aria-label="采集报警事件时间" start-placeholder="开始时间" end-placeholder="结束时间" /></label>
      <label><span>最大条数</span><el-input-number v-model="filters.limit" :min="1" :max="1000" :step="1" controls-position="right" aria-label="采集报警最大条数" /></label>
      <div class="legacy-filter-actions"><el-button :icon="RotateCcw" @click="resetFilters">重置</el-button><el-button native-type="submit" type="primary" :icon="Search" :loading="loading" :disabled="metadataLoading">查询</el-button></div>
    </form>
    <p class="alarm-muted">按当前参数配置归类，仅查询已配置的采集点位。</p>
    <p v-if="metadataError" class="alarm-error" role="alert">点位加载失败：{{ metadataError }} <el-button size="small" :icon="RefreshCcw" :loading="metadataLoading" @click="alarms.initialize">刷新点位</el-button></p>
    <p v-if="error" class="alarm-error" role="alert">{{ error }}{{ mergedRows ? '，以下保留上次成功查询结果。' : '' }}</p>
    <p v-if="requested" class="alarm-muted">已查询：{{ requested.label }} · {{ requested.pointCount }} 个参数 · {{ requested.isActive === '' ? '全部状态' : requested.isActive === 'true' ? '当前告警' : '已恢复' }} · {{ alarmTime(requested.start) }} → {{ alarmTime(requested.end) }} · 更新 {{ alarmTime(updatedAt) }}</p>
    <p v-if="requested?.truncated" class="alarm-error" role="status">结果达到查询上限，可能不完整，请缩小设备、点位或时间范围。</p>
    <p v-if="!metadataLoading && !alarms.points.value.length" class="alarm-muted">暂无已配置的采集参数，请先在参数配置中设置设备点位归属。</p>
    <div class="alarm-table-scroll">
      <table class="alarm-data-table"><thead><tr><th>开始时间</th><th>设备 / 点位 / 参数</th><th>状态</th><th>报警值</th><th>原因</th><th>详情</th></tr></thead><tbody>
        <tr v-for="(row, index) in rows" :key="String(row.alarmId ?? index)" :class="{ 'selected-alarm': selectedAlarm === row }" :style="{ '--row-alarm-color': props.rowColor(row) }" data-colored-alarm><td>{{ alarmTime(row.startedAt) }}</td><td>{{ row.machineName }} / {{ row.modelId }}<small>{{ row.locationName }} / {{ row.targetName }}</small><small>{{ row.name }}</small></td><td>{{ legacyAlarmStatus(row.status) }}</td><td>{{ alarmValue(row.alarmValue, row.unit) }}</td><td class="alarm-reason">{{ row.reason || '—' }}</td><td><el-button text :icon="Eye" @click="showDetail(row)">查看</el-button></td></tr>
        <tr v-if="!rows.length"><td colspan="6" class="alarm-empty">{{ loading || metadataLoading ? '正在加载…' : mergedRows === null ? '报警事件暂不可用，请重试查询' : '本次查询没有匹配的报警事件' }}</td></tr>
      </tbody></table>
    </div>
    <footer class="alarm-pagination"><span>已获取 {{ mergedRows?.length || 0 }} 条 · 每页 {{ pageSize }} 条</span><el-button :disabled="page <= 1" @click="page--">上一页</el-button><span>{{ page }} / {{ pageCount }}</span><el-button :disabled="page >= pageCount" @click="page++">下一页</el-button></footer>
    <ElDialog v-model="detailOpen" title="报警详情" width="min(840px, 94vw)" append-to=".dashboard-shell" class="alarm-detail-dialog" :close-on-click-modal="false" @closed="selectedAlarm = null">
      <dl v-if="selectedAlarm" class="alarm-detail-fields">
        <div><dt>报警 ID</dt><dd>{{ selectedAlarm.alarmId ?? '—' }}</dd></div>
        <div><dt>设备归属</dt><dd>{{ selectedAlarm.machineName }} / {{ selectedAlarm.modelId }} / {{ selectedAlarm.locationName }} / {{ selectedAlarm.targetName }}</dd></div>
        <div><dt>监测点位</dt><dd>{{ selectedAlarm.name || selectedAlarm.pointCode || '—' }}</dd></div>
        <div><dt>模块 / 通道 / 点位编码</dt><dd>{{ selectedAlarm.moduleId || '—' }} / {{ selectedAlarm.channelId || '—' }} / {{ selectedAlarm.pointCode || '—' }}</dd></div>
        <div><dt>开始时间</dt><dd>{{ alarmTime(selectedAlarm.startedAt) }}</dd></div>
        <div><dt>状态（原始值）</dt><dd>{{ selectedAlarm.status ?? '—' }}</dd></div>
        <div><dt>报警值 / 恢复值</dt><dd>{{ alarmValue(selectedAlarm.alarmValue, selectedAlarm.unit) }} / {{ alarmValue(selectedAlarm.recoveryValue, selectedAlarm.unit) }}</dd></div>
        <div><dt>阈值下限 / 上限</dt><dd>{{ alarmValue(selectedAlarm.thresholdMin, selectedAlarm.unit) }} / {{ alarmValue(selectedAlarm.thresholdMax, selectedAlarm.unit) }}</dd></div>
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

