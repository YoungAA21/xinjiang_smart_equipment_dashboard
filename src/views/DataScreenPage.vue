<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElDialog } from 'element-plus'
import EChart from '../components/EChart.vue'
import { useDataScreenStore, collectionRows } from '../stores/dataScreen.js'
import { pointKey, telemetryLine } from '../charts/telemetry.js'
import { dailyLimitTrendOption, riskLabel, valueText, percent } from '../charts/analysis.js'
import { alarmTime, legacyAlarmStatus } from '../charts/alarms.js'
import { configuredMonitoringPoints, presentMonitoringPoint } from '../charts/equipmentCatalog.js'
import '../styles/data-screen.css'

const screen = useDataScreenStore()
const paused = ref(false)
const refreshing = ref(false)
const pointId = ref('')
const search = ref('')
const alarmTab = ref('alarms')
const detailTitle = ref('')
const detailData = ref(null)
const clock = ref(new Date())
const controller = new AbortController()
let selectionController
let fastTimer
let slowTimer
let clockTimer
const data = computed(() => screen.data)
const modules = computed(() => data.value.modules || [])
const points = computed(() => modules.value.flatMap((module) => configuredMonitoringPoints(data.value[`points:${module.moduleId}`] || [], data.value.latest || [], module.moduleId)))
const selected = computed(() => points.value.find((point) => String(point.pointId) === pointId.value))
const health = computed(() => data.value.health || {})
const states = computed(() => collectionRows(health.value.runtimeModules?.statuses || [], modules.value))
const checks = computed(() => (health.value.checks || []).filter((check) => !/acoustic|sound|voice/i.test(check.name || '')))
const tables = computed(() => collectionRows([...(health.value.moduleTables || []), ...(health.value.aggregationTables || [])], modules.value))
const cache = computed(() => health.value.offlineCache || {})
const maintenance = computed(() => data.value.maintenance?.runtimeStatus || health.value.tableMaintenance || {})
const liveRows = computed(() => {
  const latest = new Map((data.value.latest || []).map((sample) => [pointKey(sample), sample]))
  return points.value.map((point) => ({ ...point, sample: latest.get(pointKey(point)) })).filter((point) => `${point.moduleId} ${point.name} ${point.pointCode}`.toLowerCase().includes(search.value.toLowerCase()))
})
const liveOption = computed(() => {
  const option = telemetryLine(selected.value ? screen.buffers[pointKey(selected.value)] || [] : [], selected.value)
  option.grid = { left: 52, right: 12, top: 24, bottom: 26 }
  option.dataZoom = [{ type: 'inside' }]
  return option
})
const trendOption = computed(() => dailyLimitTrendOption(data.value.days || [], selected.value || {}))
const events = computed(() => [...(data.value[alarmTab.value] || []).map(presentMonitoringPoint)].sort((a, b) => Date.parse(b.startedAt || b.createdAt) - Date.parse(a.startedAt || a.createdAt)))
const history = computed(() => [...(data.value.history || [])].sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt)))
const online = computed(() => states.value.filter((module) => module.isOnline === true).length)
const metrics = computed(() => [
  ['采集模块', screen.times.modules ? modules.value.length : '—', `${online.value} 在线 / ${states.value.filter((m) => m.isOnline === false).length} 离线`],
  ['监测点位', screen.times.modules ? points.value.length : '—', `${data.value.latest?.length ?? '—'} 条实时采样`],
  ['健康检查', checks.value.length ? `${checks.value.filter((c) => c.status === 'Healthy').length}/${checks.value.length}` : '—', data.value.heartbeat?.status || '等待服务'],
  ['硬限值报警', screen.times.alarms ? (data.value.alarms || []).filter((e) => e.status === 'Active').length : '—', '已获取事件中的活动报警'],
  ['趋势报警', screen.times.trendAlarms ? (data.value.trendAlarms || []).filter((e) => e.status === 'Active').length : '—', '已获取事件中的活动报警'],
  ['待分析队列', data.value.worker?.analysisPending ?? '—', `累计分析 ${data.value.worker?.runtimeStatus?.totalAnalyzedCount ?? '—'}`],
])
const time = (value) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '未更新'
const showDetail = (title, value) => { detailTitle.value = title; detailData.value = value }
const stale = (sample) => !sample?.collectedAt || Date.now() - Date.parse(sample.collectedAt) > 15000
const bytes = (value) => value == null ? '—' : `${(value / 1048576).toFixed(2)} MB`
const sourceKeys = computed(() => [...new Set([...Object.keys(screen.times), ...Object.keys(screen.errors)])])
const sourceName = (key) => ({ modules: '模块目录', heartbeat: '心跳', health: '健康诊断', maintenance: '分区维护', worker: '分析引擎', alarms: '硬限值报警', trendAlarms: '趋势报警', latest: '实时采样', history: '历史数据', days: '每日趋势', insight: '趋势洞察' }[key] || `点位 ${key.replace('points:', '')}`)
async function loadSelected() {
  selectionController?.abort()
  selectionController = new AbortController()
  await screen.loadPoint(selected.value, AbortSignal.any([controller.signal, selectionController.signal]))
}
watch(pointId, loadSelected)
watch(points, (rows) => {
  if (!rows.some((row) => String(row.pointId) === pointId.value)) pointId.value = rows[0] ? String(rows[0].pointId) : ''
})
async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await screen.refreshOverview(controller.signal)
    await screen.refreshLatest(controller.signal)
    if (!controller.signal.aborted) await loadSelected()
  } finally { refreshing.value = false }
}
onMounted(() => {
  refresh()
  fastTimer = setInterval(() => { if (!paused.value && !refreshing.value) screen.refreshLatest(controller.signal) }, 2000)
  slowTimer = setInterval(() => { if (!paused.value) refresh() }, 60000)
  clockTimer = setInterval(() => { clock.value = new Date() }, 1000)
})
onBeforeUnmount(() => {
  controller.abort()
  selectionController?.abort()
  clearInterval(fastTimer)
  clearInterval(slowTimer)
  clearInterval(clockTimer)
  screen.clear()
})
</script>

<template>
  <section class="data-screen">
    <header class="ds-toolbar">
      <div><span class="ds-indicator" :class="{ paused }"></span><strong>采集数据全景</strong><span class="ds-muted">{{ clock.toLocaleString('zh-CN', { hour12: false }) }}</span></div>
      <div><span class="ds-muted">实时 2 秒 · 总览 60 秒</span><button @click="paused = !paused">{{ paused ? '继续刷新' : '暂停刷新' }}</button><button :disabled="refreshing" @click="refresh">{{ refreshing ? '更新中…' : '刷新全部' }}</button></div>
    </header>
    <section class="ds-metrics"><article v-for="metric in metrics" :key="metric[0]"><span>{{ metric[0] }}</span><strong>{{ metric[1] }}</strong><small>{{ metric[2] }}</small></article></section>
    <div v-if="Object.keys(screen.errors).length" class="ds-error" role="alert">部分来源读取失败，保留上次数据：{{ Object.entries(screen.errors).map(([key, error]) => `${sourceName(key)}：${error}`).join('；') }}</div>
    <section class="ds-grid">
      <article class="ds-panel ds-modules">
        <header><h2>模块运行状态</h2><small>{{ time(screen.times.health) }}</small></header>
        <div class="ds-scroll ds-module-list">
          <button v-for="module in modules" :key="module.moduleId" @click="showDetail('模块与点位', { module, state: states.find((s) => s.moduleId === module.moduleId), points: data[`points:${module.moduleId}`] })">
            <span class="ds-dot" :class="states.find((s) => s.moduleId === module.moduleId)?.isOnline === true ? 'good' : 'warning'"></span><div><strong>{{ module.moduleName || module.moduleId }}</strong><small>{{ module.moduleId }} · {{ data[`points:${module.moduleId}`]?.length ?? '—' }} 点位</small></div><span>{{ states.find((s) => s.moduleId === module.moduleId)?.isOnline === true ? '在线' : states.find((s) => s.moduleId === module.moduleId)?.isOnline === false ? '离线' : '未知' }}</span>
          </button><p v-if="!modules.length" class="ds-empty">{{ screen.loading.modules ? '正在读取模块…' : '暂无采集模块' }}</p>
        </div>
      </article>
      <article class="ds-panel ds-live">
        <header><h2>实时点位曲线</h2><select v-model="pointId" aria-label="选择大屏点位"><option value="" disabled>选择点位</option><option v-for="point in points" :key="point.pointId" :value="String(point.pointId)">{{ point.moduleId }} / {{ point.name || point.pointCode }} / {{ point.unit }}</option></select></header>
        <div class="ds-chart"><EChart :option="liveOption" /></div><footer>{{ selected?.name || '尚未选择点位' }} · 仅展示本次访问的真实采样 · {{ time(screen.times.latest) }}</footer>
      </article>
      <article class="ds-panel ds-trend">
        <header><h2>每日限值趋势</h2><small>所选点位 · 最近 30 天</small></header>
        <div v-if="data.days?.length" class="ds-chart"><EChart :option="trendOption" /></div><p v-else class="ds-empty">{{ screen.errors.days ? '趋势读取失败' : '当前点位暂无每日趋势' }}</p>
        <footer><button @click="showDetail('每日趋势明细', data.days)">每日明细 {{ data.days?.length ?? '—' }}</button><span>{{ time(screen.times.days) }}</span></footer>
      </article>
      <article class="ds-panel ds-values">
        <header><h2>全部点位实时值</h2><input v-model="search" placeholder="搜索模块 / 点位" aria-label="搜索实时点位" /></header>
        <div class="ds-scroll"><table><thead><tr><th>模块 / 点位</th><th>采样值</th><th>采集时间</th><th>质量</th></tr></thead><tbody><tr v-for="point in liveRows" :key="point.pointId" :class="{ 'ds-selected': String(point.pointId) === pointId }"><td><button @click="pointId = String(point.pointId)">{{ point.name || point.pointCode }}</button><small>{{ point.moduleId }} / {{ point.channelId }}</small></td><td :class="{ 'ds-warning': stale(point.sample) }">{{ valueText(point.sample?.value, point.unit) }}<small v-if="stale(point.sample)">{{ point.sample ? '采样过期' : '无采样' }}</small></td><td>{{ time(point.sample?.collectedAt) }}</td><td>{{ point.sample?.quality ?? '—' }}</td></tr></tbody></table><p v-if="!liveRows.length" class="ds-empty">暂无匹配点位</p></div>
      </article>
      <article class="ds-panel ds-health">
        <header><h2>系统检查 / 数据管道</h2><small>{{ time(screen.times.health) }}</small></header>
        <div class="ds-scroll"><div v-for="check in checks" :key="check.name" class="ds-check" @click="showDetail('检查明细', check)"><span class="ds-dot" :class="check.status === 'Healthy' ? 'good' : 'warning'"></span><span :title="check.message">{{ check.name }}<small>{{ check.message }}</small></span><b>{{ check.status === 'Healthy' ? '正常' : check.status }}</b></div><p v-if="!checks.length" class="ds-empty">暂无检查结果</p></div>
        <footer><span>分析 / 报警 / 恢复</span><button @click="showDetail('分析引擎', data.worker)">{{ data.worker?.runtimeStatus?.totalAnalyzedCount ?? '—' }} / {{ data.worker?.runtimeStatus?.totalAlarmCount ?? '—' }} / {{ data.worker?.runtimeStatus?.totalRecoveryCount ?? '—' }}</button></footer>
      </article>
      <article class="ds-panel ds-storage">
        <header><h2>数据表 / 分区 / 缓存</h2><button @click="showDetail('缓存与维护', { cache, maintenance, options: data.maintenance?.options, configFiles: health.configFiles })">详情</button></header>
        <div class="ds-inline-metrics"><span>缓存文件 <b>{{ cache.fileCount ?? '—' }}</b></span><span>坏文件 <b>{{ cache.badFileCount ?? '—' }}</b></span><span>{{ bytes(cache.totalBytes) }}</span></div>
        <div class="ds-scroll"><table><thead><tr><th>数据表</th><th>分区数</th><th>缺失</th></tr></thead><tbody><tr v-for="table in tables" :key="table.tableName" @click="showDetail('数据表分区', table)"><td :title="table.tableName">{{ table.tableName }}<small>{{ table.exists === true ? '表存在' : table.exists === false ? '表缺失' : '表状态未知' }} · {{ table.hasPmax === true ? 'pmax 就绪' : table.hasPmax === false ? 'pmax 缺失' : 'pmax 未知' }}</small></td><td>{{ table.partitionCount ?? '—' }}</td><td :class="{ 'ds-warning': table.missingPartitions?.length }">{{ table.missingPartitions?.length ?? '—' }}</td></tr></tbody></table><p v-if="!tables.length" class="ds-empty">暂无数据表信息</p><div v-for="file in health.configFiles || []" :key="file.file" class="ds-check"><span>{{ file.file }}</span><b>{{ file.exists === true ? '存在' : file.exists === false ? '缺失' : '未知' }}</b></div></div>
        <footer><span>维护成功 {{ time(maintenance.lastSucceededAt) }}</span><button @click="showDetail('分区维护记录', maintenance)">{{ maintenance.lastResults?.length ?? '—' }} 条记录</button></footer>
      </article>
      <article class="ds-panel ds-alarms">
        <header><h2>报警事件</h2><div><button :class="{ active: alarmTab === 'alarms' }" @click="alarmTab = 'alarms'">硬限值 {{ data.alarms?.length ?? '—' }}</button><button :class="{ active: alarmTab === 'trendAlarms' }" @click="alarmTab = 'trendAlarms'">趋势 {{ data.trendAlarms?.length ?? '—' }}</button></div></header>
        <div class="ds-scroll"><table><thead><tr><th>开始时间</th><th>点位</th><th>状态 / 数值</th><th>原因</th></tr></thead><tbody><tr v-for="(event, i) in events" :key="event.alarmId ?? i" @click="showDetail('报警事件', event)"><td>{{ alarmTime(event.startedAt) }}</td><td>{{ event.moduleId }}<small>{{ event.pointCode }}</small></td><td :class="{ 'ds-warning': event.status === 'Active' }">{{ legacyAlarmStatus(event.status) }}<small>{{ valueText(event.alarmValue, event.unit) }}</small></td><td :title="event.reason">{{ event.reason || '—' }}</td></tr></tbody></table><p v-if="!events.length" class="ds-empty">{{ screen.times[alarmTab] ? '当前查询无报警事件' : '等待报警数据' }}</p></div><footer>每类最多获取 1000 条 · {{ events.length >= 1000 ? '已达上限，结果可能截断' : '点击事件查看阈值、恢复与完整明细' }} · {{ time(screen.times[alarmTab]) }}</footer>
      </article>
      <article class="ds-panel ds-history">
        <header><h2>原始历史数据</h2><small>所选点位 · 最近 10 分钟</small></header>
        <div class="ds-scroll"><table><thead><tr><th>采集时间</th><th>原始数值</th><th>质量</th></tr></thead><tbody><tr v-for="(sample, i) in history" :key="i"><td>{{ alarmTime(sample.collectedAt) }}</td><td>{{ sample.value ?? '—' }} {{ selected?.unit }}</td><td>{{ sample.quality ?? '—' }}</td></tr></tbody></table><p v-if="!history.length" class="ds-empty">{{ screen.errors.history ? '历史查询失败' : '当前点位暂无历史记录' }}</p></div><footer>{{ history.length }} 条 / 上限 5000 {{ history.length >= 5000 ? '· 结果可能截断' : '' }} · {{ time(screen.times.history) }}</footer>
      </article>
      <article class="ds-panel ds-insight">
        <header><h2>趋势洞察</h2><strong>{{ riskLabel(data.insight?.riskLevel) }}</strong></header>
        <div class="ds-scroll"><dl class="ds-insight-metrics"><div v-for="[label, value] in [['近期均值', valueText(data.insight?.recentAverageValue, selected?.unit)], ['基线均值', valueText(data.insight?.baselineAverageValue, selected?.unit)], ['变化率', percent(data.insight?.changeRate)], ['每日斜率', valueText(data.insight?.trendSlopePerDay)], ['P95 / P99', `${valueText(data.insight?.p95Value)} / ${valueText(data.insight?.p99Value)}`], ['标准差', valueText(data.insight?.standardDeviation)]]" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div></dl><p class="ds-muted">{{ data.insight?.message || '洞察来自所选点位最近 30 天的后端分析结果' }}</p></div><footer><button @click="showDetail('趋势洞察', data.insight)">完整分析明细</button><span>{{ time(screen.times.insight) }}</span></footer>
      </article>
    </section>
    <footer class="ds-sources"><span v-for="key in sourceKeys" :key="key" :class="{ 'ds-warning': screen.errors[key] }" :title="screen.errors[key] || screen.times[key]">{{ sourceName(key) }} {{ screen.errors[key] ? '读取失败 / 旧数据' : time(screen.times[key]) }}</span></footer>
    <el-dialog :model-value="Boolean(detailTitle)" :title="detailTitle" width="min(850px, 90vw)" @close="detailTitle = ''"><pre class="ds-detail">{{ detailData == null ? '暂无数据' : JSON.stringify(detailData, null, 2) }}</pre></el-dialog>
  </section>
</template>
