<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { CalendarDays, FileAudio, Search } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import { useDashboardStore } from '../stores/dashboard'
import { api } from '../services/api'

const dashboard = useDashboardStore()
const activePane = ref('legacy')

const alarmModules = computed(() => dashboard.modules.filter((module) => module.channels?.length))
const alarmChannels = computed(() => {
  const module = dashboard.modules.find((item) => item.moduleId === dashboard.alarmModuleId)
  return module?.channels || []
})

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

const formatStatus = (value) => {
  if (value === true || value === '1' || value === 1 || value === 'active') return '未处理'
  if (value === false || value === '0' || value === 0 || value === 'closed') return '已处理'
  return value || '-'
}

const chartMax = computed(() => Math.max(...chartState.rows.map((item) => Number(item.count || item.value || 0)), 1))

const onModuleChange = (moduleId) => {
  const module = dashboard.modules.find((item) => item.moduleId === moduleId)
  dashboard.setAlarmFilter({
    moduleId,
    channelId: module?.channels?.[0]?.channelId || '',
  })
}

const onChannelChange = (channelId) => {
  dashboard.setAlarmFilter({ channelId })
}

const onStatusChange = (value) => {
  dashboard.setAlarmFilter({ isActive: value === 'true' })
}

const loadExternalAlarms = async () => {
  externalAlarms.loading = true
  try {
    const [beginTime, endTime] = externalFilters.range || []
    const data = await api.getExternalAlarmPage({
      currentPage: externalFilters.currentPage,
      pageSize: externalFilters.pageSize,
      status: externalFilters.status,
      beginTime,
      endTime,
    })
    const rows = pageRows(data)
    externalAlarms.rows = rows
    externalAlarms.total = pageTotal(data, rows)
    externalAlarms.selected = rows[0] || null
    if (externalAlarms.selected) await loadExternalAudioFiles(externalAlarms.selected)
  } catch (error) {
    ElMessage.error(error?.message || '外部告警列表加载失败')
  } finally {
    externalAlarms.loading = false
  }
}

const loadExternalAudioFiles = async (alarm) => {
  const id = rowId(alarm)
  externalAlarms.selected = alarm
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

onMounted(() => {
  loadExternalAlarms()
  loadDailyChart()
})
</script>

<template>
  <section class="page single-page alarm-page">
    <el-tabs v-model="activePane" class="alarm-tabs">
      <el-tab-pane label="原系统告警" name="legacy">
        <article class="panel alarm-list">
          <h2>原系统告警 / 保留旧后端</h2>
          <div class="filter-grid">
            <el-select :model-value="dashboard.alarmModuleId" disabled placeholder="选择模块" @change="onModuleChange">
              <el-option v-for="module in alarmModules" :key="module.moduleId" :label="module.moduleName || module.moduleId" :value="module.moduleId" />
            </el-select>
            <el-select :model-value="dashboard.alarmChannelId" disabled placeholder="选择通道" @change="onChannelChange">
              <el-option v-for="channel in alarmChannels" :key="channel.channelId" :label="channel.name || channel.channelId" :value="channel.channelId" />
            </el-select>
            <el-select :model-value="String(dashboard.alarmIsActive)" disabled placeholder="告警状态" @change="onStatusChange">
              <el-option label="当前告警" value="true" />
              <el-option label="历史恢复" value="false" />
            </el-select>
            <el-button type="primary" disabled><Search :size="15" />原接口已停止</el-button>
          </div>
          <div v-if="!dashboard.alarmListRows.length" class="empty-state">暂无旧接口告警数据</div>
          <el-table :data="dashboard.alarmListRows" class="dark-table legacy-alarm-table">
            <el-table-column prop="time" label="告警时间" width="170" />
            <el-table-column prop="device" label="设备名称" min-width="170" />
            <el-table-column prop="type" label="告警类型" width="130" />
            <el-table-column prop="source" label="来源" width="90" />
            <el-table-column label="级别" width="80">
              <template #default="scope">
                <el-tag :type="scope?.row?.level === '重要' ? 'danger' : 'warning'" effect="dark">{{ scope?.row?.level || '-' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="85">
              <template #default="scope">
                <span class="state" :class="scope?.row?.status === '未处理' ? 'pending' : 'done'">{{ scope?.row?.status || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="声纹文件" width="300">
              <template #default="scope">
                <audio v-if="scope?.row?.audioUrl" controls preload="none" :src="scope.row.audioUrl" class="alarm-audio" />
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="90">
              <template #default="scope">
                <el-button v-if="scope?.row?.audioUrl" size="small" link type="primary" tag="a" :href="scope.row.audioUrl" target="_blank">下载</el-button>
                <span v-else>-</span>
              </template>
            </el-table-column>
          </el-table>
          <footer class="pager"><span>共 {{ dashboard.alarmListRows.length }} 条</span><el-pagination small layout="prev, pager, next, sizes" :total="dashboard.alarmListRows.length" :page-size="5" /></footer>
        </article>
      </el-tab-pane>

      <el-tab-pane label="外部接口告警" name="external">
        <article class="panel external-alarm-panel">
          <h2>外部接口告警 / 新后端</h2>
          <div class="external-filter-grid">
            <el-select v-model="externalFilters.status" clearable placeholder="状态">
              <el-option label="未处理/活动" value="1" />
              <el-option label="已处理/恢复" value="0" />
            </el-select>
            <el-date-picker v-model="externalFilters.range" type="datetimerange" value-format="YYYY-MM-DD HH:mm:ss" start-placeholder="开始时间" end-placeholder="结束时间" />
            <el-button type="primary" :loading="externalAlarms.loading" @click="loadExternalAlarms"><Search :size="15" />查询告警</el-button>
            <span class="day-zero-chip">day = 0</span>
            <el-button :icon="CalendarDays" :loading="chartState.loading" @click="loadDailyChart">刷新统计</el-button>
          </div>

          <section class="external-alarm-layout">
            <section class="external-alarm-main">
              <h3>分页告警</h3>
              <el-table :data="externalAlarms.rows" class="dark-table external-alarm-table" highlight-current-row @row-click="loadExternalAudioFiles">
                <el-table-column label="告警ID" min-width="190">
                  <template #default="{ row }">{{ rowId(row) || '-' }}</template>
                </el-table-column>
                <el-table-column label="状态" width="110">
                  <template #default="{ row }"><span :class="formatStatus(cell(row, ['status'])) === '未处理' ? 'warn-text' : 'ok-text'">{{ formatStatus(cell(row, ['status'])) }}</span></template>
                </el-table-column>
                <el-table-column label="设备/通道" min-width="180">
                  <template #default="{ row }">{{ cell(row, ['deviceName', 'deviceId', 'moduleId']) }} {{ cell(row, ['channelName', 'channelId'], '') }}</template>
                </el-table-column>
                <el-table-column label="告警类型" min-width="140">
                  <template #default="{ row }">{{ cell(row, ['type', 'alarmType', 'metricType', 'pointCode']) }}</template>
                </el-table-column>
                <el-table-column label="时间" min-width="170">
                  <template #default="{ row }">{{ cell(row, ['alarmAt', 'startedAt', 'createdAt', 'time']) }}</template>
                </el-table-column>
              </el-table>
              <footer class="pager">
                <span>共 {{ externalAlarms.total }} 条</span>
                <el-pagination
                  v-model:current-page="externalFilters.currentPage"
                  v-model:page-size="externalFilters.pageSize"
                  small
                  layout="prev, pager, next, sizes"
                  :total="externalAlarms.total"
                  @change="loadExternalAlarms"
                />
              </footer>
            </section>

            <aside class="external-alarm-side">
              <section class="external-side-card">
                <h3><FileAudio :size="15" />告警录音 <span>{{ externalAudio.total }} 个文件</span></h3>
                <div v-if="!externalAlarms.selected" class="empty-state">请选择一条外部告警</div>
                <div v-else-if="!externalAudio.rows.length" class="empty-state">当前告警暂无录音</div>
                <div v-else class="external-audio-list">
                  <button
                    v-for="file in externalAudio.rows"
                    :key="rowId(file)"
                    type="button"
                    :class="{ active: rowId(file) === rowId(externalAudio.selected) }"
                    @click="loadSampleTypes(file)"
                  >
                    <strong>{{ file.fileName || '-' }}</strong>
                    <span>文件ID：{{ file.id || '-' }}</span>
                  </button>
                </div>
              </section>

              <section class="external-side-card">
                <h3>样本类别</h3>
                <div v-if="!externalAudio.selected" class="empty-state">请选择录音文件</div>
                <div v-else-if="!externalAudio.sampleTypes.length" class="empty-state">暂无样本类别</div>
                <div v-else class="sample-type-list">
                  <el-tag v-for="item in externalAudio.sampleTypes" :key="String(item)" effect="dark">{{ typeof item === 'object' ? JSON.stringify(item) : item }}</el-tag>
                </div>
              </section>

              <section class="external-side-card daily-chart-card">
                <h3>每日告警统计</h3>
                <div v-if="!chartState.rows.length" class="empty-state">暂无统计数据</div>
                <div v-else class="daily-chart">
                  <div v-for="item in chartState.rows" :key="item.day || item.date" class="daily-bar">
                    <span>{{ item.day || item.date }}</span>
                    <i :style="{ width: `${(Number(item.count || item.value || 0) / chartMax) * 100}%` }"></i>
                    <b>{{ item.count || item.value || 0 }}</b>
                  </div>
                </div>
              </section>
            </aside>
          </section>
        </article>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>
