<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDownToLine, ChevronLeft, FileText, Settings2 } from 'lucide-vue-next'
import { defaultReportSelection, reportRanges } from '../charts/reportAnalysis.js'
import { downloadReport, latestReportSelection, listReportSnapshots, previousReportSelection, reportSelectionId, resolveReportSnapshot } from '../services/reportArchive.js'
import { auth } from '../services/auth.js'
import { presentPoint } from '../stores/pointConfiguration.js'
import '../styles/reports.css'

const route = useRoute(), router = useRouter()
const user = auth.getUser(), owner = String(user?.id || user?.username || user?.name || 'default')
const isLightTheme = inject('isLightTheme', ref(false))
const selection = ref(latestReportSelection())
const snapshot = ref(null), snapshots = ref([]), loading = ref(false), error = ref(''), progress = ref({ completed: 0, total: 0 })
let controller, version = 0, ready = false
const latest = computed(() => {
  const initial = defaultReportSelection()
  return selection.value.mode === 'daily' ? selection.value.date === initial.yesterday : selection.value.date === initial.date && selection.value.shift === initial.shift
})
const archiveId = computed(() => snapshot.value?.id || '')
const validRange = computed(() => { try { return reportRanges(selection.value).current } catch { return null } })
const rangeLabel = computed(() => validRange.value ? `${validRange.value.start.replace('T', ' ').slice(0, 16)} — ${validRange.value.end.replace('T', ' ').slice(0, 16)}` : '请选择已结束的班次或日期')
function cancel() { version++; controller?.abort(); loading.value = false }
async function readReport() {
  cancel(); controller = new AbortController()
  const request = controller, generation = version, appliedSelection = { ...selection.value }
  snapshot.value = null; error.value = ''; loading.value = true; progress.value = { completed: 0, total: 0 }
  try {
    const result = await resolveReportSnapshot({ owner, selection: appliedSelection, signal: request.signal, presentPoint,
      onProgress: (completed, total) => { if (generation === version) progress.value = { completed, total } } })
    if (request.signal.aborted || generation !== version) return
    snapshot.value = result
    snapshots.value = listReportSnapshots(owner).sort((a, b) => b.ranges.current.start.localeCompare(a.ranges.current.start))
  } catch (err) { if (!request.signal.aborted && generation === version) error.value = err.message || '报告读取失败，请重试' }
  finally { if (generation === version) loading.value = false }
}
function setSelection(value) {
  if (reportSelectionId(value) === reportSelectionId(selection.value)) { readReport(); return }
  selection.value = value
}
function openArchived(id) {
  const item = snapshots.value.find(value => value.id === id)
  if (item) setSelection({ ...item.selection })
}
function openLinkedReport() {
  const item = snapshots.value.find(value => value.id === route.query.report)
  if (item) setSelection({ ...item.selection })
  else readReport()
}
watch(selection, () => {
  if (!ready) return
  router.replace({ path: '/reports/view', query: { report: reportSelectionId(selection.value) } })
  readReport()
}, { deep: true })
watch(() => route.query.report, value => {
  if (ready && value && value !== reportSelectionId(selection.value)) openLinkedReport()
})
onMounted(() => {
  try { snapshots.value = listReportSnapshots(owner).sort((a, b) => b.ranges.current.start.localeCompare(a.ranges.current.start)) }
  catch (err) { error.value = err.message; return }
  ready = true
  openLinkedReport()
})
onBeforeUnmount(cancel)
</script>

<template>
  <div class="equipment-report-page report-view-page analysis-workspace" aria-label="报告查看">
    <header class="report-page-heading">
      <div><h1>报告查看</h1></div>
      <div class="report-heading-actions"><button @click="router.push('/reports')"><Settings2 :size="16" />报告配置</button><button :disabled="!snapshot" @click="downloadReport(snapshot)"><ArrowDownToLine :size="16" />下载 HTML</button></div>
    </header>
    <section class="report-panel report-query" aria-label="切换报告">
      <div class="report-query-controls">
        <div class="report-mode" role="group" aria-label="报告类型"><button :class="{ selected: selection.mode === 'shift' }" :aria-pressed="selection.mode === 'shift'" @click="setSelection(latestReportSelection('shift'))">班报</button><button :class="{ selected: selection.mode === 'daily' }" :aria-pressed="selection.mode === 'daily'" @click="setSelection(latestReportSelection('daily'))">日报</button></div>
        <label>归属日期<input v-model="selection.date" type="date" aria-label="查看日期" /></label>
        <label v-if="selection.mode === 'shift'">班次<select v-model="selection.shift" aria-label="查看班次"><option value="day">早班</option><option value="night">晚班</option></select></label>
        <button :disabled="!validRange" @click="setSelection(previousReportSelection(selection))"><ChevronLeft :size="15" />{{ selection.mode === 'shift' ? '前一班' : '前一天' }}</button>
        <button :disabled="latest" @click="setSelection(latestReportSelection(selection.mode))">{{ selection.mode === 'shift' ? '回到上一班' : '回到昨日' }}</button>
        <label class="report-archive-select">已存报告<select :value="archiveId" aria-label="已存报告" @change="openArchived($event.target.value)"><option value="" disabled>选择已存报告</option><option v-for="item in snapshots" :key="item.id" :value="item.id">{{ item.title }}</option></select></label>
      </div>
      <div class="report-range-row"><span>{{ rangeLabel }}</span><span v-if="snapshot" class="report-snapshot-label">固定 HTML 快照 · {{ snapshot.scope }}</span></div>
    </section>
    <div v-if="error" class="report-notice report-warning" role="alert">{{ error }} <button @click="readReport">重试</button></div>
    <div v-if="loading" class="report-progress" role="status" aria-live="polite"><span>正在准备报告 {{ progress.completed }} / {{ progress.total || '…' }}</span><progress :value="progress.completed" :max="progress.total || 1"></progress><small>首次查看未存档周期时，按已保存配置汇总并保存；再次查看直接读取快照。</small></div>
    <iframe v-if="snapshot" class="report-document-frame" :srcdoc="snapshot.html" :title="snapshot.title" sandbox="" :style="{ colorScheme: isLightTheme ? 'light' : 'dark' }"></iframe>
    <section v-else-if="!loading && !error" class="report-panel report-empty"><FileText :size="30" /><p>选择已结束的班次或日期查看报告。</p></section>
  </div>
</template>
