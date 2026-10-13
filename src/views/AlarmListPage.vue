<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { BarChart3, BellRing, CheckCircle2, CircleAlert, CircleHelp, FileAudio, RefreshCcw, RotateCcw, Search, Tags } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import LegacyAlarmPanel from '../components/LegacyAlarmPanel.vue'
import AnalysisAlarmPanel from '../components/AnalysisAlarmPanel.vue'
import '../styles/alarms.css'
import '../styles/analysis-alarms.css'
import { api } from '../services/api'
import { alarmTime, externalAlarmStatus } from '../charts/alarms.js'
import { useRoute } from 'vue-router'
const route = useRoute()

const activePane = ref('legacy')
const externalSnapshot = reactive({ updatedAt: null, error: '', queryLabel: '尚未获取声纹告警' })
const externalFilters = reactive({
  status: '',
  range: [],
  currentPage: 1,
  pageSize: 20,
})
const externalAlarms = reactive({
  loading: false,
  total: 0,
  rows: [],
  selected: null,
})
const externalAudio = reactive({
  loading: false,
  total: 0,
  rows: [],
  selected: null,
  sampleTypes: [],
})
const chartState = reactive({
  loading: false,
  day: '0',
  rows: [],
})

const pageRows = (data) => data?.row || data?.rows || data?.records || data?.list || []
const pageTotal = (data, rows) => Number(data?.total ?? data?.totalCount ?? rows.length ?? 0)
const rowId = (row) => row?.id || row?.alarmId || row?.eventId || row?.fileId || row?.file_id || ''
const normalizeDailyRows = (data) => {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    return Object.entries(data).map(([day, count]) => ({ day, count }))
  }
  return []
}
const cell = (row, keys, fallback = '-') => {
  const key = keys.find((item) => row?.[item] !== undefined && row?.[item] !== null && row?.[item] !== '')
  return key ? row[key] : fallback
}

const chartMax = computed(() => Math.max(...chartState.rows.map((item) => Number(item.count || item.value || 0)), 1))
const externalOpenCount = computed(() => externalAlarms.rows.filter((row) => externalAlarmStatus(cell(row, ['status'])) === '未处理').length)
const selectedAlarmId = computed(() => rowId(externalAlarms.selected) || '—')
const externalStatusTone = (row) => {
  const status = externalAlarmStatus(cell(row, ['status']))
  return status === '未处理' ? 'is-open' : status === '已处理' ? 'is-closed' : 'is-unknown'
}

const loadExternalAlarms = async () => {
  externalAlarms.loading = true
  externalSnapshot.error = ''
  try {
    const [beginTime, endTime] = externalFilters.range || []
    const { currentPage, pageSize, status } = externalFilters
    const data = await api.getExternalAlarmPage({
      currentPage,
      pageSize,
      status,
      beginTime,
      endTime,
    })
    const rows = pageRows(data)
    externalAlarms.rows = rows
    externalAlarms.total = pageTotal(data, rows)
    externalSnapshot.updatedAt = new Date().toISOString()
    externalSnapshot.queryLabel = `第 ${currentPage} 页 · 每页 ${pageSize} 条 · 状态 ${status || '全部'} · ${beginTime || '不限'} → ${endTime || '不限'}`
    externalAlarms.selected = rows[0] || null
    if (externalAlarms.selected) await loadExternalAudioFiles(externalAlarms.selected)
    else Object.assign(externalAudio, { total: 0, rows: [], selected: null, sampleTypes: [] })
  } catch (error) {
    externalSnapshot.error = error?.message || '声纹告警列表加载失败'
    ElMessage.error(error?.message || '声纹告警列表加载失败')
  } finally {
    externalAlarms.loading = false
  }
}

const loadExternalAudioFiles = async (alarm) => {
  const id = rowId(alarm)
  externalAlarms.selected = alarm
  externalAudio.total = 0
  externalAudio.rows = []
  externalAudio.selected = null
  externalAudio.sampleTypes = []
  if (!id) return

  externalAudio.loading = true
  try {
    const data = await api.getExternalAlarmAudioFiles({
      currentPage: 1,
      pageSize: 10,
      id,
    })
    const rows = pageRows(data)
    externalAudio.rows = rows
    externalAudio.total = pageTotal(data, rows)
    externalAudio.selected = rows[0] || null
    if (externalAudio.selected) await loadSampleTypes(externalAudio.selected)
  } catch (error) {
    ElMessage.error(error?.message || '告警录音加载失败')
  } finally {
    externalAudio.loading = false
  }
}

const loadSampleTypes = async (file) => {
  const id = rowId(file)
  externalAudio.selected = file
  externalAudio.sampleTypes = []
  if (!id) return

  try {
    const data = await api.getExternalAlarmAudioFileSampleTypes(id)
    externalAudio.sampleTypes = Array.isArray(data) ? data : []
  } catch (error) {
    ElMessage.error(error?.message || '录音样本类别加载失败')
  }
}

const loadDailyChart = async () => {
  chartState.loading = true
  try {
    const data = await api.getExternalAlarmChartByDay(0)
    chartState.rows = normalizeDailyRows(data)
  } catch (error) {
    ElMessage.error(error?.message || '每日告警统计加载失败')
  } finally {
    chartState.loading = false
  }
}

const queryExternalAlarms = () => {
  externalFilters.currentPage = 1
  loadExternalAlarms()
}

const resetExternalFilters = () => {
  Object.assign(externalFilters, { status: '', range: [], currentPage: 1, pageSize: 20 })
  loadExternalAlarms()
}

const refreshExternalWorkspace = () => Promise.all([loadExternalAlarms(), loadDailyChart()])

onMounted(() => {
  loadExternalAlarms()
  loadDailyChart()
})
</script>

<template>
  <section class="page single-page alarm-page">
    <header class="alarm-page-heading content-page-header"><h1 class="content-page-title">告警管理</h1></header>
    <el-tabs v-model="activePane" class="alarm-tabs">
      <el-tab-pane label="采集报警" name="legacy">
        <LegacyAlarmPanel :initial-module-id="String(route.query.moduleId || '')" :initial-point-code="String(route.query.pointCode || '')" />
      </el-tab-pane>
      <el-tab-pane label="趋势报警" name="analysis">
        <AnalysisAlarmPanel />
      </el-tab-pane>
      <el-tab-pane label="声纹告警" name="external">
        <article class="external-alarm-panel">
          <header class="external-alarm-toolbar">
            <div><h2>声纹告警</h2></div>
            <div class="external-toolbar-status">
              <span>{{ externalSnapshot.updatedAt ? `更新 ${alarmTime(externalSnapshot.updatedAt)}` : '等待首次查询' }}</span>
              <el-button :icon="RefreshCcw" :loading="externalAlarms.loading || chartState.loading" @click="refreshExternalWorkspace">刷新数据</el-button>
            </div>
          </header>

          <p v-if="externalSnapshot.error" class="alarm-error" role="alert">{{ externalSnapshot.error }}。采集报警仍可单独查询。</p>

          <section class="external-alarm-summary" aria-label="声纹告警摘要">
            <article><span><BellRing :size="15" />当前页告警</span><strong>{{ externalAlarms.rows.length }}</strong></article>
            <article><span><BarChart3 :size="15" />告警总数</span><strong>{{ externalSnapshot.updatedAt ? externalAlarms.total : '—' }}</strong></article>
            <article class="warning"><span><CircleAlert :size="15" />未处理</span><strong>{{ externalSnapshot.updatedAt ? externalOpenCount : '—' }}</strong><small>仅统计当前页</small></article>
            <article class="success"><span><FileAudio :size="15" />关联录音</span><strong>{{ externalAlarms.selected ? externalAudio.total : '—' }}</strong><small>告警 {{ selectedAlarmId }}</small></article>
          </section>

          <section class="external-filter-panel">
            <div class="external-filter-heading">
              <div><Search :size="16" /><h3>告警筛选</h3></div>
              <span>{{ externalSnapshot.queryLabel }}</span>
            </div>
            <div class="external-filter-grid">
              <label><span>处理状态</span><el-select v-model="externalFilters.status" clearable placeholder="全部状态"><el-option label="未处理" value="1" /><el-option label="已处理" value="0" /></el-select></label>
              <label><span>告警时间</span><el-date-picker v-model="externalFilters.range" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss" start-placeholder="开始时间" end-placeholder="结束时间" /></label>
              <div class="external-filter-actions"><el-button :icon="RotateCcw" @click="resetExternalFilters">重置</el-button><el-button type="primary" :icon="Search" :loading="externalAlarms.loading" @click="queryExternalAlarms">查询</el-button></div>
            </div>
          </section>

          <section class="external-alarm-layout">
            <section class="external-alarm-main">
              <header class="external-section-heading"><div><BellRing :size="15" /><h3>设备告警列表</h3></div><span>共 {{ externalAlarms.total }} 条</span></header>
              <el-table
                v-loading="externalAlarms.loading"
                :data="externalAlarms.rows"
                :row-key="rowId"
                :current-row-key="rowId(externalAlarms.selected)"
                empty-text="当前筛选条件下暂无设备告警"
                class="dark-table external-alarm-table"
                highlight-current-row
                @row-click="loadExternalAudioFiles"
              >
                <el-table-column label="告警ID" min-width="190"><template #default="{ row }"><code class="external-alarm-id">{{ rowId(row) || '—' }}</code></template></el-table-column>
                <el-table-column label="状态" width="110"><template #default="{ row }"><span class="external-status-badge" :class="externalStatusTone(row)"><CircleAlert v-if="externalStatusTone(row) === 'is-open'" :size="12" /><CheckCircle2 v-else-if="externalStatusTone(row) === 'is-closed'" :size="12" /><CircleHelp v-else :size="12" />{{ externalAlarmStatus(cell(row, ['status'])) }}</span></template></el-table-column>
                <el-table-column label="设备/通道" min-width="180"><template #default="{ row }"><div class="external-device-cell"><strong>{{ cell(row, ['deviceName', 'deviceId', 'moduleId']) }}</strong><span>{{ cell(row, ['channelName', 'channelId'], '—') }}</span></div></template></el-table-column>
                <el-table-column label="告警类型" min-width="140"><template #default="{ row }">{{ cell(row, ['type', 'alarmType', 'metricType', 'pointCode']) }}</template></el-table-column>
                <el-table-column label="时间" min-width="170"><template #default="{ row }">{{ alarmTime(cell(row, ['alarmAt', 'startedAt', 'createdAt', 'time'], '')) }}</template></el-table-column>
              </el-table>
              <footer class="pager external-alarm-pager">
                <span>第 {{ externalFilters.currentPage }} 页 · 每页 {{ externalFilters.pageSize }} 条</span>
                <el-pagination v-model:current-page="externalFilters.currentPage" v-model:page-size="externalFilters.pageSize" small layout="prev, pager, next, sizes" :total="externalAlarms.total" @change="loadExternalAlarms" />
              </footer>
            </section>

            <aside class="external-alarm-side">
              <section class="external-side-card">
                <header class="external-section-heading"><div><FileAudio :size="15" /><h3>告警录音</h3></div><span>{{ externalAudio.total }} 个文件</span></header>
                <div v-if="!externalAlarms.selected" class="empty-state">请选择一条设备告警</div>
                <div v-else-if="externalAudio.loading" class="empty-state">正在读取关联录音…</div>
                <div v-else-if="!externalAudio.rows.length" class="empty-state">当前告警暂无录音</div>
                <div v-else class="external-audio-list">
                  <button v-for="file in externalAudio.rows" :key="rowId(file)" type="button" :class="{ active: rowId(file) === rowId(externalAudio.selected) }" @click="loadSampleTypes(file)">
                    <FileAudio :size="15" /><div><strong>{{ file.fileName || '未命名录音' }}</strong><span>文件ID：{{ rowId(file) || '—' }}</span></div>
                  </button>
                </div>
              </section>

              <section class="external-side-card">
                <header class="external-section-heading"><div><Tags :size="15" /><h3>样本类别</h3></div><span>{{ externalAudio.sampleTypes.length }} 项</span></header>
                <div v-if="!externalAudio.selected" class="empty-state">请选择录音文件</div>
                <div v-else-if="!externalAudio.sampleTypes.length" class="empty-state">暂无样本类别</div>
                <div v-else class="sample-type-list"><el-tag v-for="item in externalAudio.sampleTypes" :key="String(item)" effect="dark">{{ typeof item === 'object' ? JSON.stringify(item) : item }}</el-tag></div>
              </section>

              <section class="external-side-card daily-chart-card">
                <header class="external-section-heading"><div><BarChart3 :size="15" /><h3>每日告警统计</h3></div><el-button text :icon="RefreshCcw" :loading="chartState.loading" title="刷新每日告警统计" @click="loadDailyChart" /></header>
                <div v-if="chartState.loading && !chartState.rows.length" class="empty-state">正在读取统计数据…</div>
                <div v-else-if="!chartState.rows.length" class="empty-state">暂无统计数据</div>
                <div v-else class="daily-chart"><div v-for="item in chartState.rows" :key="item.day || item.date" class="daily-bar"><span>{{ item.day || item.date }}</span><i :style="{ width: `${(Number(item.count || item.value || 0) / chartMax) * 100}%` }"></i><b>{{ item.count || item.value || 0 }}</b></div></div>
              </section>
            </aside>
          </section>
        </article>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>
