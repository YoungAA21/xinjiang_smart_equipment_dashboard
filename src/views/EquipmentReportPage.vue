<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Activity, ArrowRight, FileText, Play, Save, Thermometer, Gauge } from 'lucide-vue-next'
import { reportMetricGroup, reportMetricGroups, reportRanges } from '../charts/reportAnalysis.js'
import { latestReportSelection, loadReportConfiguration, resolveReportSnapshot, saveReportConfiguration } from '../services/reportArchive.js'
import { loadReportCatalog } from '../services/reports.js'
import { auth } from '../services/auth.js'
import { presentPoint } from '../stores/pointConfiguration.js'
import '../styles/reports.css'

const router = useRouter()
const user = auth.getUser()
const owner = String(user?.id || user?.username || user?.name || 'default')
const configuration = ref({ moduleId: '', metrics: reportMetricGroups.map(group => group.id) })
const selection = ref(latestReportSelection())
const catalog = ref(null), loading = ref(false), catalogLoading = ref(false), error = ref(''), saved = ref(false), snapshot = ref(null)
const initialLoading = ref(true)
const progress = ref({ completed: 0, total: 0 })
const icons = { vibration: Activity, temperature: Thermometer, pressure: Gauge }
let controller, catalogController, version = 0
const selectedPoints = computed(() => (catalog.value?.points || []).filter(point => (!configuration.value.moduleId || String(point.moduleId) === configuration.value.moduleId) && configuration.value.metrics.includes(reportMetricGroup(point))))
const ranges = computed(() => { try { return reportRanges(selection.value) } catch { return null } })
const rangeText = range => range ? `${range.start.replace('T', ' ').slice(0, 16)} — ${range.end.replace('T', ' ').slice(0, 16)}` : '请选择已结束的周期'
function cancel() { version++; controller?.abort(); loading.value = false }
watch(configuration, () => { cancel(); saved.value = false; snapshot.value = null; error.value = '' }, { deep: true })
watch(selection, () => { cancel(); snapshot.value = null; error.value = '' }, { deep: true })
function setMode(mode) { selection.value = latestReportSelection(mode) }
function save() {
  try { saveReportConfiguration(owner, configuration.value); saved.value = true; error.value = ''; return true }
  catch (err) { error.value = err.message; return false }
}
async function generate() {
  cancel()
  if (!save()) return
  controller = new AbortController()
  const request = controller, generation = version
  const appliedSelection = { ...selection.value }, appliedConfiguration = { ...configuration.value, metrics: [...configuration.value.metrics] }
  loading.value = true; error.value = ''; snapshot.value = null; progress.value = { completed: 0, total: 0 }
  try {
    const result = await resolveReportSnapshot({ owner, selection: appliedSelection, configuration: appliedConfiguration, replace: true, signal: request.signal, presentPoint,
      onProgress: (completed, total) => { if (generation === version) progress.value = { completed, total } } })
    if (!request.signal.aborted && generation === version) snapshot.value = result
  } catch (err) { if (!request.signal.aborted && generation === version) error.value = err.message || '报告生成失败，请重试' }
  finally { if (generation === version) loading.value = false }
}
async function readCatalog() {
  catalogController?.abort(); catalogController = new AbortController()
  const request = catalogController
  catalogLoading.value = true
  try { const result = await loadReportCatalog({ signal: request.signal }); if (!request.signal.aborted) catalog.value = result }
  catch (err) { if (!request.signal.aborted) error.value = err.message || '采集目录读取失败，请重试' }
  finally { if (!request.signal.aborted) catalogLoading.value = false; initialLoading.value = false }
}
onMounted(() => {
  try { configuration.value = loadReportConfiguration(owner) }
  catch { error.value = '已保存的报告配置无法读取，请重新保存配置' }
  readCatalog()
})
onBeforeUnmount(() => { cancel(); catalogController?.abort() })
</script>

<template>
  <div :aria-busy="initialLoading" class="equipment-report-page report-configuration-page analysis-workspace" aria-label="报告配置">
    <header class="report-page-heading">
      <div><h1>报告配置</h1></div>
      <button @click="router.push('/reports/view')"><FileText :size="16" />报告查看<ArrowRight :size="15" /></button>
    </header>
    <div v-if="error" class="report-notice report-warning" role="alert">{{ error }} <button v-if="!catalog" @click="readCatalog">重试读取目录</button></div>
    <section class="report-panel report-configuration-section">
      <div class="report-section-heading"><h2>关注指标</h2>
      </div>
      <div class="report-metric-choices">
        <label v-for="group in reportMetricGroups" :key="group.id" :class="{ selected: configuration.metrics.includes(group.id) }">
          <component :is="icons[group.id]" :size="24" /><span><strong>{{ group.label }}</strong><small>均值、极值、变化与异常</small></span><input v-model="configuration.metrics" type="checkbox" :value="group.id" :aria-label="group.label" />
        </label>
      </div>
      <div class="report-config-scope"><label>采集范围<select v-model="configuration.moduleId" aria-label="采集范围"><option value="">全部采集模块</option><option v-for="module in catalog?.modules || []" :key="module.moduleId" :value="String(module.moduleId)">{{ module.moduleName || module.moduleId }}</option><option v-if="configuration.moduleId && !catalog?.modules.some(module => String(module.moduleId) === configuration.moduleId)" :value="configuration.moduleId">{{ configuration.moduleId }}（目录未获取）</option></select></label><span class="report-muted"><DataLoading :loading="initialLoading" compact>{{ catalogLoading ? '正在读取测点目录…' : `当前范围 ${selectedPoints.length} 个重点测点` }}</DataLoading></span><button :disabled="loading" @click="save"><Save :size="15" />{{ saved ? '配置已保存' : '保存配置' }}</button></div>
      <p v-if="catalog?.errors.length" class="report-warning">部分模块目录读取失败：{{ catalog.errors.join('；') }} <button @click="readCatalog">重试</button></p>
    </section>
    <section class="report-panel report-configuration-section">
      <h2>生成报告</h2>
      <div class="report-query-controls report-config-period">
        <div class="report-mode" role="group" aria-label="报告类型"><button :class="{ selected: selection.mode === 'shift' }" :aria-pressed="selection.mode === 'shift'" @click="setMode('shift')">班报</button><button :class="{ selected: selection.mode === 'daily' }" :aria-pressed="selection.mode === 'daily'" @click="setMode('daily')">日报</button></div>
        <label>归属日期<input v-model="selection.date" type="date" aria-label="报告日期" /></label>
        <label v-if="selection.mode === 'shift'">班次<select v-model="selection.shift" aria-label="班次"><option value="day">早班 09:30–18:00</option><option value="night">晚班 18:00–次日 02:00</option></select></label>
      </div>
      <div class="report-period-summary"><p><span>报告周期</span>{{ rangeText(ranges?.current) }}</p><p><span>对比周期</span>{{ rangeText(ranges?.baseline) }}</p></div>
      <div class="report-generation-footer"><p class="report-muted">生成固定 HTML 报告；同周期重新生成会更新本机存档。</p><button v-if="loading" @click="cancel">取消生成</button><button v-else class="report-generate" :disabled="catalogLoading || !configuration.metrics.length || !ranges" @click="generate"><Play :size="15" />生成并保存报告</button></div>
    </section>
    <div v-if="loading" class="report-progress" role="status" aria-live="polite"><span>正在汇总关键指标 {{ progress.completed }} / {{ progress.total || '…' }}</span><progress :value="progress.completed" :max="progress.total || 1"></progress></div>
    <section v-if="snapshot" class="report-panel report-generation-result" role="status"><FileText :size="26" /><div><h2>{{ snapshot.title }}已保存</h2><p class="report-muted">到报告查看页面阅读完整报告或下载 HTML 文件。</p></div><button @click="router.push({ path: '/reports/view', query: { report: snapshot.id } })">查看报告<ArrowRight :size="15" /></button></section>
    <p class="report-storage-note report-muted">配置与最近 60 份报告保存在当前浏览器，按登录用户区分。尚未接入服务端定时生成与共享存档。</p>
  </div>
</template>
