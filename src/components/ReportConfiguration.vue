<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Activity, Save, Thermometer, Gauge } from 'lucide-vue-next'
import { reportMetricGroup, reportMetricGroups } from '../charts/reportAnalysis.js'
import { loadReportConfiguration, saveReportConfiguration } from '../services/reportArchive.js'
import { loadReportCatalog } from '../services/reports.js'
import { auth } from '../services/auth.js'
import { presentPoint } from '../stores/pointConfiguration.js'
import '../styles/reports.css'

const emit = defineEmits(['saved', 'dirty'])
const user = auth.getUser()
const owner = String(user?.id || user?.username || user?.name || 'default')
const configuration = ref({ moduleId: '', metrics: reportMetricGroups.map(group => group.id), comparison: 'adjacent' })
const catalog = ref(null), catalogLoading = ref(false), error = ref(''), saved = ref(false)
const initialLoading = ref(true)
const icons = { vibration: Activity, temperature: Thermometer, pressure: Gauge }
let catalogController, ready = false
const selectedPoints = computed(() => (catalog.value?.points || []).map(presentPoint).filter(point => (!configuration.value.moduleId || String(point.moduleId) === configuration.value.moduleId) && configuration.value.metrics.includes(reportMetricGroup(point))))
watch(configuration, () => { saved.value = false; error.value = ''; if (ready) emit('dirty') }, { deep: true, flush: 'sync' })
function save() {
  try { saveReportConfiguration(owner, configuration.value); saved.value = true; error.value = ''; emit('saved', { ...configuration.value, metrics: [...configuration.value.metrics] }); return true }
  catch (err) { error.value = err.message; return false }
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
  ready = true
  readCatalog()
})
onBeforeUnmount(() => catalogController?.abort())
</script>

<template>
  <div :aria-busy="initialLoading" class="report-configuration-content" aria-label="报告配置">
    <div v-if="error" class="report-notice report-warning" role="alert">{{ error }} <button v-if="!catalog" @click="readCatalog">重试读取目录</button></div>
    <section class="report-panel report-configuration-section">
      <div class="report-section-heading"><h2>关注指标</h2>
      </div>
      <div class="report-metric-choices">
        <label v-for="group in reportMetricGroups" :key="group.id" :class="{ selected: configuration.metrics.includes(group.id) }">
          <component :is="icons[group.id]" :size="24" /><span><strong>{{ group.label }}</strong></span><input v-model="configuration.metrics" type="checkbox" :value="group.id" :aria-label="group.label" />
        </label>
      </div>
      <div class="report-config-scope"><label>采集范围<select v-model="configuration.moduleId" aria-label="采集范围"><option value="">全部采集模块</option><option v-for="module in catalog?.modules || []" :key="module.moduleId" :value="String(module.moduleId)">{{ module.moduleName || module.moduleId }}</option><option v-if="configuration.moduleId && !catalog?.modules.some(module => String(module.moduleId) === configuration.moduleId)" :value="configuration.moduleId">{{ configuration.moduleId }}（目录未获取）</option></select></label><span class="report-muted"><DataLoading :loading="initialLoading" compact>{{ catalogLoading ? '正在读取测点目录…' : `当前范围 ${selectedPoints.length} 个重点测点` }}</DataLoading></span></div>
      <p v-if="catalog?.errors.length" class="report-warning">部分模块目录读取失败：{{ catalog.errors.join('；') }} <button @click="readCatalog">重试</button></p>
    </section>
    <section class="report-panel report-configuration-section">
      <h2>统计规则</h2>
      <div class="report-rule-cards">
        <article><span>白班</span><strong>09:30–18:00</strong><span>102 个时间桶</span></article>
        <article><span>夜班</span><strong>18:00–次日 02:00</strong><span>96 个时间桶 · 归属开始日期</span></article>
        <article><span>日报</span><strong>00:00–次日 00:00</strong><span>288 个时间桶 · 5 分钟粒度</span></article>
      </div>
      <label class="report-default-comparison">班报默认对比<select v-model="configuration.comparison" aria-label="班报默认对比"><option value="adjacent">上一班次</option><option value="same">前一日同班次</option></select></label>
    </section>
    <div class="report-configuration-actions"><span v-if="saved" class="report-save-success" role="status">报告配置已保存</span><button class="report-generate" :disabled="!configuration.metrics.length" @click="save"><Save :size="15" />保存配置</button></div>
    <p class="report-storage-note report-muted">配置保存在当前浏览器，按登录用户区分。</p>
  </div>
</template>
