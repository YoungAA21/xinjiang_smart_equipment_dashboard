<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { CircleAlert, RefreshCcw, RotateCcw, Search, TrendingUp, X } from 'lucide-vue-next'
import EChart from './EChart.vue'
import AlarmPointFilters from './AlarmPointFilters.vue'
import { usePointAlarmQuery } from '../composables/usePointAlarmQuery.js'
import { analysisApi } from '../services/analysis.js'
import { alarmTime } from '../charts/alarms.js'
import { alarmChartGroups } from '../charts/alarmPoints.js'
import { percent, riskLabel, riskTone, trendAlarmChangeOption, valueText } from '../charts/analysis.js'
const props = defineProps({ initialScope: { type: Object, default: () => ({}) }, rowColor: { type: Function, default: () => 'var(--alarm-color-yellow, #f3c45c)' } })
const emit = defineEmits(['color-events'])
const alarms = usePointAlarmQuery(analysisApi.getTrendAlarms, () => props.initialScope)
const { scope, filters, options, metadataError, metadataLoading, rows, requested, updatedAt, error, loading, query, reset: resetFilters, changeScope } = alarms
const rawSelected = ref(null)
const selected = rawSelected
const page = ref(1)
const pageSize = ref(20)
const rowId = (row, index = 0) => row?.trendAlarmId || row?.eventId || `${row?.moduleId || 'event'}-${row?.pointCode || index}-${index}`
const activeCount = computed(() => (rows.value || []).filter(row => row.status === 'Active').length)
const warningCount = computed(() => (rows.value || []).filter(row => row.riskLevel === 'Warning').length)
const totalRows = computed(() => rows.value?.length || 0)
const pagedRows = computed(() => (rows.value || []).slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
const chartGroups = computed(() => alarmChartGroups(rows.value || []))
const chartPointKey = ref('')
const chartGroup = computed(() => chartGroups.value.find(group => group.id === chartPointKey.value) || chartGroups.value[0])
const chartOption = computed(() => trendAlarmChangeOption(chartGroup.value?.events || []))
const selectedId = computed(() => selected.value ? rowId(selected.value) : '')
function showRowDetail(row) { rawSelected.value = selectedId.value === rowId(row) ? null : row }
function rowClassName({ row }) { return selectedId.value === rowId(row) ? 'analysis-row-selected' : '' }
watch(rows, value => { page.value = 1; rawSelected.value = null; emit('color-events', value || []) })
watch(pageSize, () => { page.value = 1 })
watch(page, () => { rawSelected.value = null })
watch(() => props.initialScope, async () => { alarms.applyInitial(); await changeScope() }, { deep: true })
onMounted(alarms.initialize)
</script>

<template>
  <section class="analysis-alarm-panel">
    <header class="analysis-alarm-toolbar">
      <div><h2>趋势报警</h2></div>
      <el-button type="primary" plain :icon="RefreshCcw" :loading="loading" :disabled="metadataLoading" @click="query">刷新</el-button>
    </header>

    <section class="analysis-alarm-summary">
      <article><span>查询结果</span><strong>{{ rows?.length ?? '—' }}</strong><small>{{ alarmTime(updatedAt) }}</small></article>
      <article><span>当前活动</span><strong>{{ activeCount }}</strong></article>
      <article class="warning"><span>预警级别</span><strong>{{ warningCount }}</strong></article>
    </section>

    <section class="analysis-alarm-filters">
      <AlarmPointFilters :scope="scope" :options="options" :loading="metadataLoading" @change="changeScope" />
      <label><span>恢复状态</span><el-select v-model="filters.isActive" clearable placeholder="全部状态"><el-option label="当前报警" value="true" /><el-option label="已恢复" value="false" /></el-select></label>
      <label class="analysis-event-range"><span>事件时间</span><el-date-picker v-model="filters.range" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss" start-placeholder="开始时间" end-placeholder="结束时间" /></label>
      <label><span>最大条数</span><el-input-number v-model="filters.limit" :min="1" :max="1000" :controls="false" /></label>
      <div class="analysis-filter-actions"><el-button :icon="RotateCcw" @click="resetFilters">重置</el-button><el-button type="primary" :icon="Search" :loading="loading" :disabled="metadataLoading" @click="query">查询</el-button></div>
    </section>

    <p class="alarm-muted">按当前参数配置归类，仅查询已配置的采集点位。</p>
    <p v-if="metadataError" class="alarm-error" role="alert">点位加载失败：{{ metadataError }} <el-button size="small" :icon="RefreshCcw" :loading="metadataLoading" @click="alarms.initialize">刷新点位</el-button></p>
    <p v-if="requested" class="alarm-muted">已查询：{{ requested.label }} · {{ requested.pointCount }} 个参数 · {{ requested.isActive === '' ? '全部状态' : requested.isActive === 'true' ? '当前告警' : '已恢复' }} · {{ alarmTime(requested.start) }} → {{ alarmTime(requested.end) }}</p>
    <p v-if="requested?.truncated" class="alarm-error" role="status">结果达到查询上限，可能不完整，请缩小设备、点位或时间范围。</p>
    <p v-if="!metadataLoading && !alarms.points.value.length" class="alarm-muted">暂无已配置的采集参数，请先在参数配置中设置设备点位归属。</p>
    <p v-if="error" class="alarm-error" role="alert">{{ error }}{{ rows ? '，当前保留上次成功结果。' : '' }}</p>

    <article class="analysis-trend-card">
      <header><div><TrendingUp :size="15" /><h3>趋势变化</h3></div><el-select v-if="chartGroups.length" :model-value="chartGroup.id" class="alarm-chart-point" aria-label="趋势图参数" @update:model-value="chartPointKey = $event"><el-option v-for="group in chartGroups" :key="group.id" :label="group.name" :value="group.id" /></el-select><span>{{ chartGroup?.events.length || 0 }} 条事件</span></header>
      <div v-if="!rows?.length && !loading" class="empty-state">当前条件下暂无趋势报警</div>
      <EChart v-else class="analysis-trend-chart" :option="chartOption" />
    </article>

    <section class="analysis-event-layout">
      <article class="analysis-event-table-panel">
        <header><div><TrendingUp :size="15" /><h3>趋势报警列表</h3></div><el-button text :icon="RefreshCcw" :loading="loading" title="刷新列表" @click="query" /></header>
        <el-table v-loading="loading" :data="pagedRows" :row-style="({ row }) => ({ '--row-alarm-color': props.rowColor(row) })" class="dark-table analysis-event-table" empty-text="当前条件下暂无趋势报警" :row-class-name="rowClassName" @row-click="showRowDetail">
          <el-table-column label="开始时间" min-width="165"><template #default="{ row }">{{ alarmTime(row.startedAt) }}</template></el-table-column>
          <el-table-column label="设备 / 点位 / 参数" min-width="180"><template #default="{ row }"><strong>{{ row.machineName }} / {{ row.modelId }}</strong><small>{{ row.locationName }} / {{ row.targetName }}</small><small>{{ row.name }}</small></template></el-table-column>
          <el-table-column label="状态" width="95"><template #default="{ row }"><span :class="['risk-badge', row.status === 'Active' ? 'warning' : 'normal']">{{ row.status === 'Active' ? '当前报警' : row.status === 'Recovered' ? '已恢复' : row.status }}</span></template></el-table-column>
          <el-table-column label="风险" width="85"><template #default="{ row }"><span :class="['risk-badge', riskTone(row.riskLevel)]">{{ riskLabel(row.riskLevel) }}</span></template></el-table-column>
          <el-table-column label="报警值" min-width="105"><template #default="{ row }">{{ valueText(row.alarmValue, row.unit) }}</template></el-table-column>
          <el-table-column label="变化率" min-width="90"><template #default="{ row }">{{ percent(row.changeRate) }}</template></el-table-column>
          <el-table-column label="原因" min-width="240" show-overflow-tooltip prop="reason" />
        </el-table>
        <aside v-if="selected" class="analysis-floating-detail">
          <header>
            <div><CircleAlert :size="15" /><strong>事件详情</strong></div>
            <button type="button" title="关闭详情" @click="rawSelected = null"><X :size="14" /></button>
          </header>
          <span>{{ selectedId }}</span>
          <dl>
            <div v-for="(value, key) in selected" :key="key"><dt>{{ key }}</dt><dd>{{ value ?? '—' }}</dd></div>
          </dl>
        </aside>
        <footer class="analysis-table-pagination">
          <span>已获取 {{ totalRows }} 条</span>
          <el-pagination v-model:current-page="page" v-model:page-size="pageSize" small layout="prev, pager, next, sizes" :page-sizes="[10, 20, 50, 100]" :total="totalRows" />
        </footer>
      </article>
    </section>
  </section>
</template>
