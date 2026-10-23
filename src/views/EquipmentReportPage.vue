<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDownToLine, ChevronLeft, FileText, Search, Save } from 'lucide-vue-next'
import { defaultReportSelection, reportRanges, reportMetricGroup, reportMetricGroups } from '../charts/reportAnalysis.js'
import { downloadReport, latestReportSelection, listReportSnapshots, loadReportConfiguration, previousReportSelection, queryReport, saveReportSnapshot, saveReportConfiguration, normalizeReportConfiguration } from '../services/reportArchive.js'
import { auth } from '../services/auth.js'
import { presentPoint } from '../stores/pointConfiguration.js'
import ReportResults from '../components/ReportResults.vue'
import { loadReportCatalog } from '../services/reports.js'
import '../styles/reports.css'

const route = useRoute(), router = useRouter()
const user = auth.getUser(), owner = String(user?.id || user?.username || user?.name || 'default')
const isLightTheme = inject('isLightTheme', ref(false))
const configuration = ref(normalizeReportConfiguration())
const catalog = ref(null), catalogError = ref(''), initialLoading = ref(true), catalogLoading = ref(false), remembered = ref(false)
let catalogController
const selectedPoints = computed(() => (catalog.value?.points || []).map(presentPoint).filter(point => (!configuration.value.moduleId || String(point.moduleId) === configuration.value.moduleId) && configuration.value.metrics.includes(reportMetricGroup(point))))
const appliedConfiguration = () => ({ ...configuration.value, metrics: [...configuration.value.metrics], comparison: selection.value.comparison })
const scopeKey = value => JSON.stringify([String(value?.moduleId || ''), reportMetricGroups.filter(group => value?.metrics?.includes(group.id)).map(group => group.id)])
const selection = ref({ ...latestReportSelection(), comparison: 'adjacent' })
const snapshot = ref(null), preview = ref(null), snapshots = ref([]), saved = ref(false)
const loading = ref(false), error = ref(''), progress = ref({ completed: 0, total: 0 }), queryStage = ref('catalog')
let controller, version = 0
const latest = computed(() => {
  const initial = defaultReportSelection()
  return selection.value.mode === 'daily' ? selection.value.date === initial.yesterday : selection.value.date === initial.date && selection.value.shift === initial.shift
})
const archiveId = computed(() => saved.value && !changed.value ? snapshot.value?.id || '' : '')
const ranges = computed(() => { try { return reportRanges(selection.value) } catch { return null } })
const rangeText = range => range ? `${range.start.replace('T', ' ').slice(0, 16)} — ${range.end.replace('T', ' ').slice(0, 16)}` : '请选择已结束的班次或日期'
const selectionKey = value => JSON.stringify([value.mode, value.date, value.mode === 'daily' ? '' : value.shift, value.mode === 'daily' ? '' : value.comparison || 'adjacent'])
const changed = computed(() => snapshot.value && (scopeKey(configuration.value) !== scopeKey(snapshot.value.configuration || configuration.value) || selectionKey(selection.value) !== selectionKey(snapshot.value.selection)))
function cancel() { version++; controller?.abort(); loading.value = false }
function rememberFilters() {
  try { saveReportConfiguration(owner, appliedConfiguration()); remembered.value = true; error.value = '' }
  catch (err) { error.value = err.message || '筛选条件保存失败' }
}
async function readCatalog() {
  catalogController?.abort(); catalogController = new AbortController()
  const request = catalogController
  catalogLoading.value = true; catalogError.value = ''
  try { const result = await loadReportCatalog({ signal: request.signal }); if (!request.signal.aborted) catalog.value = result }
  catch (err) { if (!request.signal.aborted) catalogError.value = err.message || '采集目录读取失败' }
  finally { if (!request.signal.aborted) { catalogLoading.value = false; initialLoading.value = false } }
}
function setSelection(value) { selection.value = { ...value, comparison: selection.value.comparison } }
function refreshArchives() { snapshots.value = listReportSnapshots(owner).sort((a, b) => b.ranges.current.start.localeCompare(a.ranges.current.start)) }
async function readReport() {
  if (loading.value || catalogLoading.value) return
  if (!configuration.value.metrics.length) { error.value = '请至少选择一类指标'; return }
  cancel(); controller = new AbortController()
  const request = controller, generation = version, appliedSelection = { ...selection.value }, filters = appliedConfiguration()
  error.value = ''; loading.value = true; queryStage.value = 'catalog'; progress.value = { completed: 0, total: 0 }
  try {
    const result = await queryReport({ owner, selection: appliedSelection, configuration: filters, catalog: catalogError.value ? undefined : catalog.value, signal: request.signal, presentPoint,
      onStage: stage => { if (generation === version) queryStage.value = stage },
      onProgress: (completed, total) => { if (generation === version) progress.value = { completed, total } } })
    if (request.signal.aborted || generation !== version) return
    snapshot.value = result.snapshot; preview.value = result.report; saved.value = false
    if (route.query.report) router.replace({ path: '/reports', query: {} })
  } catch (err) { if (!request.signal.aborted && generation === version) error.value = err.name === 'TimeoutError' ? `${queryStage.value === 'catalog' ? '测点目录读取' : '报告数据查询'}超时，请检查采集服务或缩小采集范围后重试` : err.message || '报告查询失败，请重试' }
  finally { if (generation === version) loading.value = false }
}
function save() {
  if (!snapshot.value || changed.value || loading.value) return
  try {
    saveReportSnapshot(owner, snapshot.value, { replace: true })
    saved.value = true; error.value = ''; refreshArchives()
  } catch (err) { error.value = err.message || '报告保存失败' }
}
function openArchived(id) {
  cancel()
  const item = snapshots.value.find(value => value.id === id)
  if (!item) { error.value = '未找到该报告存档，请选择其他报告或重新查询'; return }
  if (item.configuration) configuration.value = normalizeReportConfiguration(item.configuration)
  selection.value = { ...item.selection, comparison: item.selection.comparison || item.configuration?.comparison || 'adjacent' }
  snapshot.value = item; preview.value = null; saved.value = true; error.value = ''
  if (route.query.report !== id) router.replace({ path: '/reports', query: { report: id } })
}
// Changing a control only cancels pending work; it never queries or saves a report.
watch([selection, configuration], () => { cancel(); remembered.value = false; error.value = '' }, { deep: true, flush: 'sync' })
watch(() => route.query.report, value => {
  if (value && !(saved.value && snapshot.value?.id === value)) openArchived(value)
})
onMounted(() => {
  try {
    configuration.value = loadReportConfiguration(owner)
    selection.value.comparison = configuration.value.comparison
    refreshArchives()
    if (route.query.report) openArchived(route.query.report)
  } catch (err) { error.value = err.message || '报告条件或存档读取失败' }
  readCatalog()
})
onBeforeUnmount(() => { cancel(); catalogController?.abort() })
</script>

<template>
  <div :aria-busy="loading" class="equipment-report-page report-view-page analysis-workspace" aria-label="设备报告">
    <header class="report-page-heading">
      <div><h1>设备报告</h1></div>
      <div class="report-heading-actions"><button :disabled="!snapshot || loading || changed || saved" @click="save"><Save :size="16" />{{ saved ? '报告已保存' : '保存报告' }}</button><button :disabled="!snapshot || loading || changed" @click="downloadReport(snapshot)"><ArrowDownToLine :size="16" />下载 HTML</button></div>
    </header>
    <section class="report-panel report-query report-unified-query" aria-label="报告条件">
      <div class="report-filter-heading"><h2>报告条件</h2><span v-if="remembered" class="report-save-success" role="status">筛选条件已记住</span><button :disabled="!configuration.metrics.length" @click="rememberFilters">记住筛选</button></div>
      <div class="report-scope-controls">
        <div class="report-metric-filters" role="group" aria-label="关注指标"><label v-for="group in reportMetricGroups" :key="group.id" :class="{ selected: configuration.metrics.includes(group.id) }"><input v-model="configuration.metrics" type="checkbox" :value="group.id" :aria-label="group.label" /><span>{{ group.label }}</span></label></div>
        <label class="report-module-filter">采集范围<select v-model="configuration.moduleId" aria-label="采集范围"><option value="">全部采集模块</option><option v-for="module in catalog?.modules || []" :key="module.moduleId" :value="String(module.moduleId)">{{ module.moduleName || module.moduleId }}</option><option v-if="configuration.moduleId && !catalog?.modules.some(module => String(module.moduleId) === configuration.moduleId)" :value="configuration.moduleId">{{ configuration.moduleId }}（目录未获取）</option></select></label>
        <span class="report-muted report-scope-count"><DataLoading :loading="initialLoading" compact>{{ catalog ? `${selectedPoints.length} 个测点` : '目录未获取' }}</DataLoading></span>
      </div>
      <div v-if="catalogError || catalog?.errors.length" class="report-catalog-error report-warning" role="alert">{{ catalogError || `部分模块读取失败：${catalog.errors.join('；')}` }}<button :disabled="catalogLoading" @click="readCatalog">重新读取目录</button></div>
      <div class="report-query-controls">
        <div class="report-mode" role="group" aria-label="报告类型"><button :class="{ selected: selection.mode === 'shift' }" :aria-pressed="selection.mode === 'shift'" @click="setSelection(latestReportSelection('shift'))">班报</button><button :class="{ selected: selection.mode === 'daily' }" :aria-pressed="selection.mode === 'daily'" @click="setSelection(latestReportSelection('daily'))">日报</button></div>
        <label>归属日期<input v-model="selection.date" type="date" aria-label="查看日期" /></label>
        <label v-if="selection.mode === 'shift'">班次<select v-model="selection.shift" aria-label="查看班次"><option value="day">白班 09:30–18:00</option><option value="night">夜班 18:00–次日 02:00</option></select></label>
        <label v-if="selection.mode === 'shift'">对比方式<select v-model="selection.comparison" aria-label="对比方式"><option value="adjacent">上一班次</option><option value="same">前一日同班次</option></select></label>
        <button :disabled="!ranges" @click="setSelection(previousReportSelection(selection))"><ChevronLeft :size="15" />{{ selection.mode === 'shift' ? '前一班' : '前一天' }}</button>
        <button :disabled="latest" @click="setSelection(latestReportSelection(selection.mode))">{{ selection.mode === 'shift' ? '回到上一班' : '回到昨日' }}</button>
        <button v-if="loading" @click="cancel">取消查询</button><button v-else class="report-generate" :disabled="catalogLoading || !ranges || !configuration.metrics.length" @click="readReport"><Search :size="16" />查询报告</button>
      </div>
      <div class="report-range-row"><span><b>本期</b>{{ rangeText(ranges?.current) }}</span><span><b>对比期</b>{{ rangeText(ranges?.baseline) }}</span><span>5 分钟 / 桶 · 本期 {{ ranges ? Math.round(ranges.current.hours * 12) : '—' }} 桶 / 测点</span></div>
    </section>
    <section v-if="snapshots.length" class="report-panel report-archive-bar"><label>已存报告<select :value="archiveId" aria-label="已存报告" @change="openArchived($event.target.value)"><option value="" disabled>选择已存报告</option><option v-for="item in snapshots" :key="item.id" :value="item.id">{{ item.title }}</option></select></label><span class="report-muted">当前浏览器 · 最近 {{ snapshots.length }} 份</span></section>
    <div v-if="error" class="report-notice report-warning" role="alert">{{ error }}</div>
    <div v-if="loading" class="report-progress" role="status" aria-live="polite"><span>{{ queryStage === 'catalog' ? '正在读取测点目录' : `正在查询报告 ${progress.completed} / ${progress.total || '…'}` }}</span><progress :value="progress.completed" :max="progress.total || 1"></progress></div>
    <div v-if="snapshot" class="report-result-heading"><div><h2>{{ snapshot.title }}</h2><p class="report-muted">{{ snapshot.scope }} · {{ rangeText(snapshot.ranges.current) }}</p></div><span v-if="changed" class="report-warning" role="status">{{ loading ? '正在查询新条件，当前保留上次结果' : '条件已修改，请点击查询报告' }}</span><span v-else class="report-save-success" role="status">{{ saved ? '已保存到本机存档' : '查询完成 · 尚未保存' }}</span></div>
    <template v-if="preview">
      <ReportResults :report="preview" />
      <details class="report-panel report-document-details"><summary>完整报告</summary><iframe class="report-document-frame" :srcdoc="snapshot.html" :title="snapshot.title" sandbox="" :style="{ colorScheme: isLightTheme ? 'light' : 'dark' }"></iframe></details>
    </template>
    <iframe v-else-if="snapshot" class="report-document-frame" :srcdoc="snapshot.html" :title="snapshot.title" sandbox="" :style="{ colorScheme: isLightTheme ? 'light' : 'dark' }"></iframe>
    <section v-else-if="!loading" class="report-panel report-empty"><FileText :size="30" /><p>选择日期和班次，点击“查询报告”查看结果。</p></section>
  </div>
</template>
