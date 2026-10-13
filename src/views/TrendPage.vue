<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Activity, CalendarRange, Gauge, RefreshCcw, TrendingUp } from 'lucide-vue-next'
import EChart from '../components/EChart.vue'
import { telemetryApi } from '../services/telemetry.js'
import { analysisApi } from '../services/analysis.js'
import { dailyLimitTrendOption, percent, riskLabel, riskTone, valueText } from '../charts/analysis.js'
import '../styles/analysis.css'

const props = defineProps({
  embedded: Boolean,
  moduleId: { type: String, default: '' },
  point: { type: Object, default: null },
})
const modules = ref([])
const points = ref([])
const selectedModuleId = ref('')
const selectedPointId = ref(null)
const dateRange = ref([])
const bucketMinutes = 5
const days = ref([])
const insight = ref(null)
const metadataLoading = ref(false)
const analysisLoading = ref(false)
const metadataError = ref('')
const analysisError = ref('')
const pageController = new AbortController()
let pointController
let analysisController
let analysisVersion = 0

const localTime = (value) => {
  const date = new Date(value)
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
const resetRange = () => {
  const end = Date.now()
  dateRange.value = [localTime(end - 30 * 24 * 60 * 60 * 1000), localTime(end)]
}
resetRange()

const selectedPoint = computed(() => points.value.find((point) => Number(point.pointId) === Number(selectedPointId.value)) || null)
const chartOption = computed(() => dailyLimitTrendOption(days.value, selectedPoint.value || {}))
const exceededDays = computed(() => days.value.filter((day) => Number(day.belowLimitBucketCount || 0) + Number(day.aboveLimitBucketCount || 0) > 0).length)
const exceededMinutes = computed(() => days.value.reduce((sum, day) => sum + Number(day.belowLimitMinutes || 0) + Number(day.aboveLimitMinutes || 0), 0))
const totalSamples = computed(() => days.value.reduce((sum, day) => sum + Number(day.sampleCount || 0), 0))

async function loadModules() {
  metadataLoading.value = true
  metadataError.value = ''
  try {
    const result = await telemetryApi.getModules({ signal: pageController.signal })
    if (!Array.isArray(result?.modules)) throw new Error('模块接口返回格式不正确')
    modules.value = result.modules.filter((module) => String(module.protocol || '').toLowerCase().includes('modbus'))
    selectedModuleId.value = modules.value[0]?.moduleId || ''
    if (selectedModuleId.value) await loadPoints()
  } catch (error) {
    if (!pageController.signal.aborted) metadataError.value = error.message || '模块加载失败'
  } finally {
    metadataLoading.value = false
  }
}

async function loadPoints() {
  pointController?.abort()
  analysisController?.abort()
  points.value = []
  selectedPointId.value = null
  days.value = []
  insight.value = null
  if (!selectedModuleId.value) return
  pointController = new AbortController()
  metadataLoading.value = true
  metadataError.value = ''
  try {
    const result = await telemetryApi.getModulePoints(selectedModuleId.value, { signal: AbortSignal.any([pageController.signal, pointController.signal]) })
    if (!Array.isArray(result?.points)) throw new Error('点位接口返回格式不正确')
    points.value = result.points
    selectedPointId.value = points.value[0]?.pointId ?? null
    if (selectedPointId.value) await loadAnalysis()
  } catch (error) {
    if (!pageController.signal.aborted && error.name !== 'AbortError') metadataError.value = error.message || '点位加载失败'
  } finally {
    metadataLoading.value = false
  }
}

async function changePoint() {
  await loadAnalysis()
}

async function loadAnalysis() {
  if (!selectedPoint.value || dateRange.value?.length !== 2) return
  analysisController?.abort()
  const controller = new AbortController()
  analysisController = controller
  const version = ++analysisVersion
  analysisLoading.value = true
  analysisError.value = ''
  days.value = []
  insight.value = null
  const query = { pointId: selectedPoint.value.pointId, start: dateRange.value[0], end: dateRange.value[1], bucketMinutes }
  try {
    const [dailyResult, insightResult] = await Promise.allSettled([
      analysisApi.getDailyLimitTrends({ ...query, limit: 366 }, { signal: controller.signal }),
      analysisApi.getTrendInsights({ ...query, limit: 100000 }, { signal: controller.signal }),
    ])
    if (pageController.signal.aborted || controller.signal.aborted || version !== analysisVersion) return
    if (dailyResult.status === 'fulfilled') {
      if (!Array.isArray(dailyResult.value?.days)) throw new Error('每日限值趋势返回格式不正确')
      days.value = dailyResult.value.days
    }
    if (insightResult.status === 'fulfilled') insight.value = insightResult.value?.insight || null
    const errors = [dailyResult, insightResult].filter((result) => result.status === 'rejected').map((result) => result.reason?.message || '分析请求失败')
    if (errors.length) analysisError.value = errors.join('；')
  } catch (error) {
    if (!pageController.signal.aborted && version === analysisVersion) analysisError.value = error.message || '趋势分析失败'
  } finally {
    if (version === analysisVersion) analysisLoading.value = false
  }
}
function syncSelection() {
  analysisController?.abort()
  analysisVersion += 1
  analysisLoading.value = false
  days.value = []
  insight.value = null
  analysisError.value = ''
  points.value = props.point ? [props.point] : []
  selectedModuleId.value = props.moduleId
  selectedPointId.value = props.point?.pointId ?? null
  if (props.point) loadAnalysis()
}
watch(() => [props.moduleId, props.point?.pointId], () => { if (props.embedded) syncSelection() })
onMounted(() => props.embedded ? syncSelection() : loadModules())
onBeforeUnmount(() => {
  pageController.abort()
  pointController?.abort()
  analysisController?.abort()
  analysisVersion += 1
})
</script>

<template>
  <section class="page trend-analysis-page" :class="{ 'embedded-analysis': embedded }">
    <header v-if="!embedded" class="trend-toolbar content-page-header">
      <div><h1 class="content-page-title">趋势分析</h1></div>
      <el-button :icon="RefreshCcw" :loading="metadataLoading || analysisLoading" @click="loadModules">刷新数据</el-button>
    </header>

    <section class="trend-filter-panel" :class="{ 'embedded-trend-filter': embedded }">
      <label v-if="!embedded"><span>采集模块</span><el-select v-model="selectedModuleId" filterable placeholder="选择模块" @change="loadPoints"><el-option v-for="module in modules" :key="module.moduleId" :label="`${module.moduleId} / ${module.moduleName}`" :value="module.moduleId" /></el-select></label>
      <label v-if="!embedded"><span>分析点位</span><el-select v-model="selectedPointId" filterable placeholder="选择点位" :loading="metadataLoading" @change="changePoint"><el-option v-for="point in points" :key="point.pointId" :label="`#${point.pointId} / ${point.channelId} / ${point.pointCode} / ${point.name}`" :value="point.pointId" /></el-select></label>
      <label class="trend-range-field"><span>分析时段</span><el-date-picker v-model="dateRange" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss" start-placeholder="开始时间" end-placeholder="结束时间" /></label>
      <el-button type="primary" :icon="TrendingUp" :loading="analysisLoading" :disabled="!selectedPointId" @click="loadAnalysis">开始分析</el-button>
    </section>

    <p v-if="metadataError" class="trend-error" role="alert">{{ metadataError }}</p>
    <p v-if="analysisError" class="trend-error" role="alert">{{ analysisError }}</p>

    <section class="trend-kpis">
      <article><span><CalendarRange :size="15" />统计天数</span><strong>{{ days.length }}</strong></article>
      <article :class="{ warning: exceededDays > 0 }"><span><Activity :size="15" />超限天数</span><strong>{{ exceededDays }}</strong><small>累计 {{ exceededMinutes }} 分钟</small></article>
      <article><span><Gauge :size="15" />样本总数</span><strong>{{ totalSamples.toLocaleString() }}</strong></article>
      <article :class="['risk', riskTone(insight?.riskLevel)]"><span><TrendingUp :size="15" />趋势风险</span><strong>{{ riskLabel(insight?.riskLevel) }}</strong><small>{{ selectedPoint?.pointCode || '尚未选择点位' }}</small></article>
    </section>

    <section class="trend-workspace">
      <article class="trend-chart-panel">
        <header><div><TrendingUp :size="16" /><h2>每日限值趋势</h2></div><span>{{ selectedPoint ? `${selectedPoint.name} · ${selectedPoint.unit || '无单位'}` : '等待点位' }}</span></header>
        <div v-if="analysisLoading && !days.length" class="trend-empty">正在计算趋势…</div>
        <div v-else-if="!days.length" class="trend-empty">当前时段暂无聚合趋势数据</div>
        <EChart v-else class="trend-chart" :option="chartOption" />
      </article>

      <aside class="trend-side">
        <section class="trend-insight-card">
          <header><div><Activity :size="15" /><h2>趋势洞察</h2></div><span :class="['risk-badge', riskTone(insight?.riskLevel)]">{{ riskLabel(insight?.riskLevel) }}</span></header>
          <div v-if="!insight" class="trend-empty compact">暂无趋势洞察</div>
          <template v-else>
            <dl class="insight-metrics">
              <div><dt>近期均值</dt><dd>{{ valueText(insight.recentAverageValue, insight.unit) }}</dd></div>
              <div><dt>基线均值</dt><dd>{{ valueText(insight.baselineAverageValue, insight.unit) }}</dd></div>
              <div><dt>变化率</dt><dd>{{ percent(insight.changeRate) }}</dd></div>
              <div><dt>每日斜率</dt><dd>{{ valueText(insight.trendSlopePerDay, `${insight.unit || ''}/天`) }}</dd></div>
              <div><dt>P95 / P99</dt><dd>{{ valueText(insight.p95Value) }} / {{ valueText(insight.p99Value) }}</dd></div>
              <div><dt>标准差</dt><dd>{{ valueText(insight.standardDeviation) }}</dd></div>
            </dl>
          </template>
        </section>
      </aside>
    </section>

    <section class="trend-table-panel">
      <header><div><CalendarRange :size="15" /><h2>每日分析明细</h2></div><span>{{ days.length }} 天</span></header>
      <el-table :data="days" :height="360" scrollbar-always-on class="dark-table trend-table" empty-text="暂无每日分析数据">
        <el-table-column label="日期" min-width="115"><template #default="{ row }">{{ String(row.date || '').slice(0, 10) }}</template></el-table-column>
        <el-table-column label="最小值" min-width="105"><template #default="{ row }">{{ valueText(row.minValue, row.unit) }}</template></el-table-column>
        <el-table-column label="平均值" min-width="105"><template #default="{ row }">{{ valueText(row.averageValue, row.unit) }}</template></el-table-column>
        <el-table-column label="最大值" min-width="105"><template #default="{ row }">{{ valueText(row.maxValue, row.unit) }}</template></el-table-column>
        <el-table-column label="下限 / 上限" min-width="150"><template #default="{ row }">{{ valueText(row.minimumValue) }} / {{ valueText(row.maximumValue) }}</template></el-table-column>
        <el-table-column prop="sampleCount" label="样本数" min-width="100" />
        <el-table-column label="超限分钟" min-width="110"><template #default="{ row }">{{ Number(row.belowLimitMinutes || 0) + Number(row.aboveLimitMinutes || 0) }}</template></el-table-column>
        <el-table-column label="状态" min-width="90"><template #default="{ row }"><span :class="['risk-badge', row.limitStatus === 'Normal' ? 'normal' : 'warning']">{{ row.limitStatus === 'Normal' ? '正常' : row.limitStatus || '未知' }}</span></template></el-table-column>
      </el-table>
    </section>
  </section>
</template>

<style scoped>
.embedded-analysis { height: auto; padding: 0; overflow: visible; background: transparent; }
.embedded-trend-filter { grid-template-columns: minmax(0, 1fr) auto; }
.embedded-trend-filter .trend-range-field { grid-column: auto; }
.embedded-analysis .trend-workspace { grid-template-columns: minmax(0, 1fr); }
.embedded-analysis .trend-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.embedded-analysis .insight-metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (min-width: 1700px) { .embedded-analysis .trend-workspace { grid-template-columns: minmax(0, 1.8fr) minmax(280px, .8fr); } .embedded-analysis .insight-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
