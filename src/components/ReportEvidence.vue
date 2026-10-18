<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChartNoAxesCombined, Expand, Focus, TrendingUp } from 'lucide-vue-next'
import EChart from './EChart.vue'
import { evidenceRange, reportEvidenceOption, reportValue } from '../charts/reportAnalysis.js'
import { analysisApi } from '../services/analysis.js'
import { dailyLimitTrendOption } from '../charts/analysis.js'
import { localInputTime } from '../charts/telemetry.js'

const props = defineProps({ report: { type: Object, required: true }, selectedId: [String, Number], eventFocus: Object })
const emit = defineEmits(['select', 'segment'])
const filter = ref('ema'), kind = ref('peak'), selection = ref(null), draftStart = ref(''), draftEnd = ref(''), error = ref('')
const background = ref(null), backgroundError = ref(''), backgroundLoading = ref(false)
let controller
const row = computed(() => props.report.rows.find(item => String(item.point.pointId) === String(props.selectedId)) || props.report.rows[0])
const option = computed(() => row.value?.clean && selection.value ? reportEvidenceOption(row.value, props.report.ranges, selection.value, filter.value) : null)
const segmentSamples = computed(() => row.value?.clean?.valid.filter(item => selection.value && item.time >= Date.parse(selection.value.start) && item.time < Date.parse(selection.value.end) && (row.value.kind !== 'digital' || [0, 1].includes(item.value))) || [])
const segmentMax = computed(() => segmentSamples.value.reduce((max, item) => max === null || item.value > max ? item.value : max, null))
function applyRange(range) {
  selection.value = range
  draftStart.value = range.start.slice(0, 16); draftEnd.value = range.end.slice(0, 16)
  error.value = ''
  emit('segment', `${row.value?.point.name || ''}；${range.start} — ${range.end}；处理：${row.value?.kind === 'digital' ? `IO 原始电平，统计去抖${props.report.debounceMs || 0}毫秒` : filter.value}`)
}
function choose(value) {
  kind.value = value
  if (row.value?.current) applyRange(evidenceRange(row.value.current, props.report.ranges.current, value))
}
function applyCustom() {
  const start = Date.parse(draftStart.value), end = Date.parse(draftEnd.value)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || start < Date.parse(props.report.ranges.current.start) || end > Date.parse(props.report.ranges.current.end)) { error.value = '选段须位于本期内，且结束晚于开始'; return }
  kind.value = 'custom'
  applyRange({ start: localInputTime(start), end: localInputTime(end) })
}
watch(row, () => {
  controller?.abort(); background.value = null; backgroundError.value = ''; backgroundLoading.value = false
  selection.value = null
  choose('peak')
}, { immediate: true })
watch(filter, () => { if (selection.value) applyRange(selection.value) })
watch(() => props.eventFocus, event => {
  if (!event || !row.value?.current) return
  const time = Date.parse(event.startedAt || event.createdAt)
  if (!Number.isFinite(time)) return
  kind.value = 'event'
  applyRange({ start: localInputTime(Math.max(Date.parse(props.report.ranges.current.start), time - 900000)), end: localInputTime(Math.min(Date.parse(props.report.ranges.current.end), time + 900000)) })
}, { flush: 'post' })
async function loadBackground() {
  controller?.abort(); controller = new AbortController()
  const request = controller, point = row.value.point
  backgroundLoading.value = true; backgroundError.value = ''; background.value = null
  // Completed calendar dates only. Overnight shift's partial following date is excluded.
  const end = new Date(`${props.report.ranges.current.end.slice(0, 10)}T00:00:00`)
  const start = new Date(end); start.setDate(start.getDate() - 7)
  try {
    const result = await analysisApi.getDailyLimitTrends({ pointId: point.pointId, start: localInputTime(start), end: localInputTime(end), bucketMinutes: 60, limit: 366 }, { signal: request.signal })
    if (request.signal.aborted) return
    if (!Array.isArray(result?.days) || (result.pointId != null && String(result.pointId) !== String(point.pointId))) throw new Error('每日趋势数据身份或格式不正确')
    background.value = { days: result.days.filter(day => String(day.date).slice(0, 10) >= localInputTime(start).slice(0, 10) && String(day.date).slice(0, 10) < localInputTime(end).slice(0, 10)), range: `${localInputTime(start).slice(0, 10)} 至 ${localInputTime(end).slice(0, 10)}（不含）` }
  } catch (err) { if (!request.signal.aborted) backgroundError.value = err.message }
  finally { if (!request.signal.aborted) backgroundLoading.value = false }
}
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <section class="report-evidence-grid" aria-label="曲线证据">
    <div class="report-panel report-evidence-main">
      <div class="report-section-heading">
        <h2><ChartNoAxesCombined :size="19" />重点片段回放</h2>
        <select aria-label="回放参数" :value="row?.point.pointId" @change="emit('select', $event.target.value)">
          <option v-for="item in report.rows" :key="item.point.pointId" :value="item.point.pointId">{{ item.point.name }} · {{ item.point.moduleId }}</option>
        </select>
        <select v-if="row?.kind !== 'digital'" v-model="filter" aria-label="滤波方式">
          <option value="ema">中值 + EMA</option><option value="median">5 分钟中值</option><option value="raw">分钟中位值</option>
        </select>
      </div>
      <p class="report-muted">{{ selection?.start.replace('T', ' ') }} — {{ selection?.end.replace('T', ' ') }}</p>
      <p v-if="row?.kind === 'analog'" class="report-muted">当前配置下限 {{ reportValue(row.point.minimumValue) }} / 上限 {{ reportValue(row.point.maximumValue) }} {{ row.point.unit }} · 仅作本次重算参考，不代表历史阈值。</p>
      <EChart v-if="option" :option="option" class="report-evidence-chart" />
      <div v-else class="report-empty">本期历史未成功获取，请重试生成报告。</div>
      <p class="report-footnote">{{ row?.kind === 'digital' ? 'IO 用阶梯线展示原始 0/1 电平，超过60秒或无效值断开，不使用模拟量滤波。' : '灰线保留原始有效值；滤波不参与峰值和越限计算，缺数断线。' }}金色对比线按周期开始后的等经过时长对齐。拖动缩放条可查看细节，导出记录右侧明确选择的时间段。</p>
    </div>
    <aside class="report-panel report-segment-panel">
      <h2><Focus :size="19" />自动选段</h2>
      <button :class="{ selected: kind === 'peak' }" :disabled="!row?.current?.peak" @click="choose('peak')"><TrendingUp :size="18" /><span><strong>{{ row?.kind === 'digital' ? '首段高电平附近' : '偏离均值最大附近' }}</strong><small>保留原始采样前后 15 分钟</small></span></button>
      <button :class="{ selected: kind === 'change' }" :disabled="!row?.current?.strongest" @click="choose('change')"><ChartNoAxesCombined :size="18" /><span><strong>{{ row?.kind === 'digital' ? '电平切换附近' : '最大变化附近' }}</strong><small>{{ row?.kind === 'digital' ? '定位去抖后首次确认的电平切换' : '定位滤波分钟值变化片段' }}</small></span></button>
      <button :class="{ selected: kind === 'full' }" :disabled="!row?.current" @click="choose('full')"><Expand :size="18" /><span><strong>查看完整周期</strong><small>回看全程，检查波动与缺数</small></span></button>
      <div class="report-custom-range">
        <label>自定义选段 · 开始<input v-model="draftStart" type="datetime-local" aria-label="选段开始" /></label>
        <label>结束<input v-model="draftEnd" type="datetime-local" aria-label="选段结束" /></label>
        <button :disabled="!row?.current" @click="applyCustom">应用选段</button>
      </div>
      <p v-if="error" class="report-warning" role="alert">{{ error }}</p>
      <p class="report-muted">本段 {{ segmentSamples.length.toLocaleString() }} 个有效样本<br />本段最大值 {{ reportValue(segmentMax) }} {{ row?.point.unit }}</p>
    </aside>
  </section>
  <section v-if="row?.kind !== 'digital'" class="report-panel report-history-background">
    <div class="report-section-heading"><h2>7 日历史背景</h2><span class="report-muted">{{ row?.point.name }} · 后端自然日聚合</span><button :disabled="backgroundLoading || !row" @click="loadBackground">{{ backgroundLoading ? '正在读取…' : '读取历史背景' }}</button></div>
    <p v-if="backgroundError" class="report-warning" role="alert">{{ backgroundError }}</p>
    <template v-if="background"><p class="report-muted">{{ background.range }} · 自然日趋势用于背景参考，不替代班次统计。</p><EChart v-if="background.days.length" :option="dailyLimitTrendOption(background.days, row.point)" class="report-background-chart" /><p v-else class="report-muted">该范围没有返回每日聚合记录。</p></template>
    <p v-else class="report-muted">按需读取已结束自然日的均值、极值及限值，判断本期变化是否已经持续多日。</p>
  </section>
</template>
