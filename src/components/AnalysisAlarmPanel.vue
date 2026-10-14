<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { CircleAlert, RefreshCcw, RotateCcw, Search, TrendingUp, X } from 'lucide-vue-next'
import EChart from './EChart.vue'
import { telemetryApi } from '../services/telemetry.js'
import { analysisApi } from '../services/analysis.js'
import { alarmTime } from '../charts/alarms.js'
import { percent, riskLabel, riskTone, trendAlarmChangeOption, valueText } from '../charts/analysis.js'
const props = defineProps({ rowColor: { type: Function, default: () => 'var(--alarm-color-yellow, #f3c45c)' } })
const emit = defineEmits(['color-events'])

const modules = ref([])
const points = ref([])
const rows = ref(null)
watch(rows, value => emit('color-events', value || []))
const selected = ref(null)
const loading = ref(false)
const metadataLoading = ref(false)
const error = ref('')
const updatedAt = ref(null)
const filters = reactive({ moduleId: '', pointId: '', isActive: '', range: [], limit: 200 })
const page = ref(1)
const pageSize = ref(20)
const pageController = new AbortController()
let pointController
let queryController
let version = 0

const rowId = (row, index = 0) => row?.trendAlarmId || row?.eventId || `${row?.moduleId || 'event'}-${row?.pointCode || index}-${index}`
const activeCount = computed(() => (rows.value || []).filter((row) => row.status === 'Active').length)
const warningCount = computed(() => (rows.value || []).filter((row) => row.riskLevel === 'Warning').length)
const totalRows = computed(() => rows.value?.length || 0)
const pagedRows = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return (rows.value || []).slice(start, start + pageSize.value)
})
const chartOption = computed(() => trendAlarmChangeOption(rows.value || []))
const selectedId = computed(() => selected.value ? rowId(selected.value) : '')

async function loadModules() {
  metadataLoading.value = true
  try {
    const result = await telemetryApi.getModules({ signal: pageController.signal })
    if (!Array.isArray(result?.modules)) throw new Error('模块接口返回格式不正确')
    modules.value = result.modules
    if (!filters.moduleId || !modules.value.some((module) => module.moduleId === filters.moduleId)) {
      filters.moduleId = modules.value[0]?.moduleId || ''
    }
    if (filters.moduleId) await changeModule()
  } catch (reason) {
    if (!pageController.signal.aborted) error.value = reason.message || '模块加载失败'
  } finally { metadataLoading.value = false }
}

async function changeModule() {
  pointController?.abort()
  points.value = []
  filters.pointId = ''
  if (!filters.moduleId) return
  pointController = new AbortController()
  metadataLoading.value = true
  try {
    const result = await telemetryApi.getModulePoints(filters.moduleId, { signal: AbortSignal.any([pageController.signal, pointController.signal]) })
    if (!Array.isArray(result?.points)) throw new Error('点位接口返回格式不正确')
    points.value = result.points
    filters.pointId = points.value[0]?.pointId ?? ''
  } catch (reason) {
    if (!pageController.signal.aborted && reason.name !== 'AbortError') error.value = reason.message || '点位加载失败'
  } finally { metadataLoading.value = false }
}

async function query() {
  queryController?.abort()
  const controller = new AbortController()
  queryController = controller
  const currentVersion = ++version
  loading.value = true
  error.value = ''
  const [start, end] = filters.range || []
  const params = { pointId: filters.pointId, start, end, limit: filters.limit, isActive: filters.isActive }
  try {
    const result = await analysisApi.getTrendAlarms(params, { signal: controller.signal })
    if (pageController.signal.aborted || controller.signal.aborted || currentVersion !== version) return
    if (!Array.isArray(result?.events)) throw new Error('分析事件返回格式不正确')
    rows.value = result.events
    selected.value = null
    page.value = 1
    updatedAt.value = result.generatedAt || new Date().toISOString()
  } catch (reason) {
    if (!pageController.signal.aborted && currentVersion === version && reason.name !== 'AbortError') error.value = reason.message || '分析事件查询失败'
  } finally {
    if (currentVersion === version) loading.value = false
  }
}

async function handleModuleChange() {
  await changeModule()
  await query()
}

async function resetFilters() {
  Object.assign(filters, { moduleId: modules.value[0]?.moduleId || '', pointId: '', isActive: '', range: [], limit: 200 })
  points.value = []
  selected.value = null
  page.value = 1
  if (filters.moduleId) await changeModule()
  await query()
}

function showRowDetail(row) {
  selected.value = selectedId.value === rowId(row) ? null : row
}

function rowClassName({ row }) {
  return selectedId.value === rowId(row) ? 'analysis-row-selected' : ''
}

watch(pageSize, () => { page.value = 1 })
watch(page, () => { selected.value = null })
onMounted(async () => { await loadModules(); await query() })
onBeforeUnmount(() => { pageController.abort(); pointController?.abort(); queryController?.abort(); version += 1 })
</script>

<template>
  <section class="analysis-alarm-panel">
    <header class="analysis-alarm-toolbar">
      <div><h2>趋势报警</h2></div>
      <el-button type="primary" plain :icon="RefreshCcw" :loading="loading" @click="query">刷新</el-button>
    </header>

    <section class="analysis-alarm-summary">
      <article><span>查询结果</span><strong>{{ rows?.length ?? '—' }}</strong><small>{{ alarmTime(updatedAt) }}</small></article>
      <article><span>当前活动</span><strong>{{ activeCount }}</strong></article>
      <article class="warning"><span>预警级别</span><strong>{{ warningCount }}</strong></article>
    </section>

    <section class="analysis-alarm-filters">
      <label><span>模块</span><el-select v-model="filters.moduleId" filterable placeholder="选择模块" @change="handleModuleChange"><el-option v-for="module in modules" :key="module.moduleId" :label="`${module.moduleId} / ${module.moduleName}`" :value="module.moduleId" /></el-select></label>
      <label><span>点位</span><el-select v-model="filters.pointId" filterable placeholder="选择点位" :loading="metadataLoading" :disabled="!filters.moduleId"><el-option v-for="point in points" :key="point.pointId" :label="`#${point.pointId} / ${point.pointCode} / ${point.name}`" :value="point.pointId" /></el-select></label>
      <label><span>恢复状态</span><el-select v-model="filters.isActive" clearable placeholder="全部状态"><el-option label="当前报警" value="true" /><el-option label="已恢复" value="false" /></el-select></label>
      <label class="analysis-event-range"><span>事件时间</span><el-date-picker v-model="filters.range" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss" start-placeholder="开始时间" end-placeholder="结束时间" /></label>
      <label><span>最大条数</span><el-input-number v-model="filters.limit" :min="1" :max="1000" :controls="false" /></label>
      <div class="analysis-filter-actions"><el-button :icon="RotateCcw" @click="resetFilters">重置</el-button><el-button type="primary" :icon="Search" :loading="loading" @click="query">查询</el-button></div>
    </section>

    <p v-if="error" class="alarm-error" role="alert">{{ error }}{{ rows ? '，当前保留上次成功结果。' : '' }}</p>

    <article class="analysis-trend-card">
      <header><div><TrendingUp :size="15" /><h3>趋势变化</h3></div><span>{{ totalRows }} 条事件</span></header>
      <div v-if="!rows?.length && !loading" class="empty-state">当前条件下暂无趋势报警</div>
      <EChart v-else class="analysis-trend-chart" :option="chartOption" />
    </article>

    <section class="analysis-event-layout">
      <article class="analysis-event-table-panel">
        <header><div><TrendingUp :size="15" /><h3>趋势报警列表</h3></div><el-button text :icon="RefreshCcw" :loading="loading" title="刷新列表" @click="query" /></header>
        <el-table v-loading="loading" :data="pagedRows" :row-style="({ row }) => ({ '--row-alarm-color': props.rowColor(row) })" class="dark-table analysis-event-table" empty-text="当前条件下暂无趋势报警" :row-class-name="rowClassName" @row-click="showRowDetail">
          <el-table-column label="开始时间" min-width="165"><template #default="{ row }">{{ alarmTime(row.startedAt) }}</template></el-table-column>
          <el-table-column label="模块 / 点位" min-width="180"><template #default="{ row }"><strong>{{ row.moduleId }}</strong><small>{{ row.channelId }} / {{ row.pointCode }}</small></template></el-table-column>
          <el-table-column label="状态" width="95"><template #default="{ row }"><span :class="['risk-badge', row.status === 'Active' ? 'warning' : 'normal']">{{ row.status === 'Active' ? '当前报警' : row.status === 'Recovered' ? '已恢复' : row.status }}</span></template></el-table-column>
          <el-table-column label="风险" width="85"><template #default="{ row }"><span :class="['risk-badge', riskTone(row.riskLevel)]">{{ riskLabel(row.riskLevel) }}</span></template></el-table-column>
          <el-table-column label="报警值" min-width="105"><template #default="{ row }">{{ valueText(row.alarmValue, row.unit) }}</template></el-table-column>
          <el-table-column label="变化率" min-width="90"><template #default="{ row }">{{ percent(row.changeRate) }}</template></el-table-column>
          <el-table-column label="原因" min-width="240" show-overflow-tooltip prop="reason" />
        </el-table>
        <aside v-if="selected" class="analysis-floating-detail">
          <header>
            <div><CircleAlert :size="15" /><strong>事件详情</strong></div>
            <button type="button" title="关闭详情" @click="selected = null"><X :size="14" /></button>
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
