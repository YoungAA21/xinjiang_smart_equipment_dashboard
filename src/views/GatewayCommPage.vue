<script setup>
import { computed, reactive, ref } from 'vue'
import GatewayModuleOverview from '../components/GatewayModuleOverview.vue'
import { Activity, Clock3, Cpu, Database, History, ListFilter, RefreshCcw, Server, Wifi } from 'lucide-vue-next'
import { reportInformation } from '../services/information.js'
import { api } from '../services/api'
import { acousticCollectorDisplayName } from '../charts/machineGroups.js'

const view = ref('modules')
const overview = ref(null)
function changeView(value) { view.value = value; if (value === 'acoustic') loadAll() }
const statuses = ref([])
const historyRows = ref([])
const eventRows = ref([])
const singleStatus = ref(null)
let detailVersion = 0
const selectedId = ref('')
const loading = ref(false)
const initialAcousticLoading = ref(true)
const detailLoading = ref(false)
const historyLoading = ref(false)
const eventsLoading = ref(false)

const historyFilter = reactive({
  hours: 168,
  limitPerCollector: 200,
  page: 1,
  pageSize: 10,
})

const eventFilter = reactive({
  hours: 168,
  collectorId: '',
  state: '',
  eventType: '',
  connected: '',
  keyword: '',
  page: 1,
  pageSize: 50,
  total: 0,
})

const stateOptions = [
  { label: '在线', value: 'online' },
  { label: '连接中', value: 'connecting' },
  { label: '启动中', value: 'starting' },
  { label: '重连中', value: 'reconnecting' },
  { label: '已停止', value: 'stopped' },
  { label: '离线', value: 'offline' },
  { label: '未启用', value: 'disabled' },
]

const eventTypeOptions = [
  { label: '状态切换', value: 'transition' },
  { label: '恢复', value: 'recovery' },
  { label: '手动恢复', value: 'manual_recovery' },
  { label: '配置变更', value: 'device_configuration' },
  { label: '设备创建', value: 'device_created' },
]

const selectedRow = computed(() =>
  statuses.value.find((item) => String(item.collectorId) === String(selectedId.value)) || statuses.value[0] || null)
const selectedRuntime = computed(() => singleStatus.value || selectedRow.value?.runtime || selectedRow.value || {})
const collectorName = row => {
  const id = row?.collectorId ?? row?.runtime?.collectorId
  const known = statuses.value.find(item => String(item.collectorId) === String(id))
  return acousticCollectorDisplayName(row?.ip || row?.runtime?.ip || row?.runtime?.host || row?.host || known?.ip || known?.runtime?.ip, row?.name || row?.runtime?.name || row?.collectorId)
}
const onlineCount = computed(() => statuses.value.filter((item) => normalizeRuntime(item).connected === true).length)
const stoppedCount = computed(() =>
  statuses.value.filter((item) => ['stopped', 'offline', 'disabled'].includes(normalizeRuntime(item).state)).length)
const recordingSavedTotal = computed(() =>
  statuses.value.reduce((sum, item) => sum + Number(normalizeRuntime(item).recordingsSaved || 0), 0))
const bytesTotal = computed(() =>
  statuses.value.reduce((sum, item) => sum + Number(normalizeRuntime(item).bytesReceived || 0), 0))
const pagedHistoryRows = computed(() => {
  const start = (historyFilter.page - 1) * historyFilter.pageSize
  return historyRows.value.slice(start, start + historyFilter.pageSize)
})

const primaryMetrics = computed(() => {
  const runtime = selectedRuntime.value
  return [
    ['累计接收', bytes(runtime.bytesReceived)],
    ['累计样本', number(runtime.samplesReceived)],
    ['有效采样率', runtime.effectiveSampleRate ? `${runtime.effectiveSampleRate} Hz` : '-'],
    ['录音队列', number(runtime.recordingQueueDepth)],
    ['保存录音', number(runtime.recordingsSaved)],
    ['缓存样本', number(runtime.bufferedSamples)],
  ]
})

const detailItems = computed(() => {
  const runtime = selectedRuntime.value
  return [
    ['网关ID', runtime.collectorId || selectedId.value || '-'],
    ['采样格式', runtime.sampleFormat || '-'],
    ['配置采样率', runtime.configuredSampleRate ? `${runtime.configuredSampleRate} Hz` : '-'],
    ['通道数', runtime.channelCount ?? '-'],
    ['驱动', runtime.driver || '-'],
    ['传输模式', runtime.transportMode || '-'],
    ['启动时间', formatTime(runtime.startedAt)],
    ['连接时间', formatTime(runtime.connectedAt)],
    ['最后数据', formatTime(runtime.lastDataAt)],
    ['断开时间', formatTime(runtime.disconnectedAt)],
    ['停止时间', formatTime(runtime.stoppedAt)],
    ['更新时间', formatTime(runtime.updatedAt)],
  ]
})

function normalizeRuntime(row) {
  return row?.runtime || row || {}
}

function statusText(state = '') {
  return ({
    online: '在线',
    connecting: '连接中',
    starting: '启动中',
    reconnecting: '重连中',
    disabled: '未启用',
    stopped: '已停止',
    offline: '离线',
  })[state] || state || '未知'
}

function statusType(state = '') {
  if (state === 'online') return 'success'
  if (['reconnecting', 'connecting', 'starting'].includes(state)) return 'warning'
  if (['disabled', 'stopped'].includes(state)) return 'info'
  return state === 'offline' ? 'danger' : 'info'
}

function bytes(value = 0) {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024 ** 3).toFixed(1)} GB`
}

function number(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function percent(value) {
  const size = Number(value || 0)
  return `${size.toFixed(1)}%`
}

function formatTime(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function secondsText(value) {
  const total = Number(value || 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  return `${hours}h ${minutes}m`
}

async function loadStatuses() {
  loading.value = true
  try {
    const rows = await api.getCollectorStatuses()
    statuses.value = Array.isArray(rows) ? rows : []
    if (!statuses.value.some((item) => String(item.collectorId) === String(selectedId.value))) {
      selectedId.value = statuses.value[0]?.collectorId ? String(statuses.value[0].collectorId) : ''
    }
  } catch (error) {
    reportInformation('网关通讯', error?.message || '网关实时状态加载失败')
  } finally {
    loading.value = false
  }
}

async function loadSingleStatus() {
  const version = ++detailVersion
  singleStatus.value = null
  if (!selectedId.value) {
    singleStatus.value = null
    return
  }
  detailLoading.value = true
  try {
    const result = await api.getCollectorStatus(selectedId.value)
    if (version === detailVersion) singleStatus.value = result?.runtime || result
  } catch (error) {
    if (version !== detailVersion) return
    singleStatus.value = selectedRow.value?.runtime || null
    reportInformation('网关通讯', error?.message || '单网关状态加载失败')
  } finally {
    if (version === detailVersion) detailLoading.value = false
  }
}

async function loadHistory() {
  historyLoading.value = true
  try {
    const rows = await api.getCollectorStatusHistory({
      hours: historyFilter.hours,
      limitPerCollector: historyFilter.limitPerCollector,
    })
    historyRows.value = Array.isArray(rows) ? rows : []
    if ((historyFilter.page - 1) * historyFilter.pageSize >= historyRows.value.length) {
      historyFilter.page = 1
    }
  } catch (error) {
    reportInformation('网关通讯', error?.message || '在线历史加载失败')
  } finally {
    historyLoading.value = false
  }
}

async function loadEvents(resetPage = false) {
  if (resetPage) eventFilter.page = 1
  eventsLoading.value = true
  try {
    const data = await api.getCollectorStatusEvents({
      hours: eventFilter.hours,
      collectorId: eventFilter.collectorId,
      state: eventFilter.state,
      eventType: eventFilter.eventType,
      connected: eventFilter.connected,
      keyword: eventFilter.keyword,
      page: eventFilter.page,
      pageSize: eventFilter.pageSize,
    })
    eventRows.value = Array.isArray(data?.row) ? data.row : []
    eventFilter.total = Number(data?.total || 0)
    eventFilter.page = Number(data?.currentPage || eventFilter.page)
    eventFilter.pageSize = Number(data?.pageSize || eventFilter.pageSize)
  } catch (error) {
    reportInformation('网关通讯', error?.message || '事件日志加载失败')
  } finally {
    eventsLoading.value = false
  }
}

function handleHistoryPageChange(page) {
  historyFilter.page = page
}

function handleHistorySizeChange(size) {
  historyFilter.pageSize = size
  historyFilter.page = 1
}

function handleEventPageChange(page) {
  eventFilter.page = page
  loadEvents()
}

function handleEventSizeChange(size) {
  eventFilter.pageSize = size
  loadEvents(true)
}

async function loadAll() {
  try {
    await loadStatuses()
    await Promise.all([loadSingleStatus(), loadHistory(), loadEvents()])
  } finally { initialAcousticLoading.value = false }
}

function selectCollector(row) {
  selectedId.value = String(row.collectorId)
  eventFilter.collectorId = String(row.collectorId)
  loadSingleStatus()
  loadEvents(true)
}


</script>

<template>
  <section :aria-busy="view === 'acoustic' && initialAcousticLoading" class="page gateway-page configuration-workspace" aria-label="网关通讯">
    <div class="gateway-controls configuration-toolbar" aria-label="通讯视图与操作">
      <nav class="gateway-view-tabs" aria-label="通讯视图"><button :class="{active: view === 'modules'}" :aria-pressed="view === 'modules'" @click="changeView('modules')">模块总览</button><button :class="{active: view === 'acoustic'}" :aria-pressed="view === 'acoustic'" @click="changeView('acoustic')">声纹通讯</button></nav>
      <div class="monitor-actions gateway-filter-actions">
        <label v-if="view === 'acoustic'">历史范围 <el-input-number v-model="historyFilter.hours" :min="1" :max="720" /> 小时</label>
        <label v-if="view === 'acoustic'">每网关事件 <el-input-number v-model="historyFilter.limitPerCollector" :min="10" :max="1000" /></label>
        <el-button :icon="RefreshCcw" :loading="view === 'modules' ? overview?.loading : loading || detailLoading || historyLoading || eventsLoading" type="primary" aria-label="刷新状态" title="刷新状态" @click="view === 'modules' ? overview?.refresh() : loadAll()">刷新状态</el-button>
      </div>
    </div>
    <GatewayModuleOverview v-if="view === 'modules'" ref="overview" />
    <template v-else>
    <section class="panel gateway-device-section">
      <div class="gateway-section-heading">
        <h2><Server :size="16" />实时网关列表</h2>
        <span>{{ statuses.length }} 个网关</span>
      </div>
      <DataLoading v-if="initialAcousticLoading" label="正在加载网关列表" /><div v-else-if="!statuses.length" class="empty-state">暂无网关状态数据</div>
      <div v-else class="gateway-card-grid">
        <button
          v-for="row in statuses"
          :key="row.collectorId"
          type="button"
          class="gateway-device-card"
          :class="{ active: String(row.collectorId) === String(selectedId), offline: !normalizeRuntime(row).connected }"
          @click="selectCollector(row)"
        >
          <span class="gateway-device-icon" :class="statusType(normalizeRuntime(row).state)">
            <Cpu :size="20" />
            <i></i>
          </span>
          <span class="gateway-device-info">
            <strong>{{ collectorName(row) }}</strong>
            <em>{{ row.ip || normalizeRuntime(row).ip || '-' }}:{{ row.audioPort || normalizeRuntime(row).port || '-' }}</em>
          </span>
          <span class="gateway-card-signal">
            <i></i><i></i><i></i><i></i>
          </span>
          <el-tag :type="statusType(normalizeRuntime(row).state)" effect="plain">{{ statusText(normalizeRuntime(row).state) }}</el-tag>
        </button>
      </div>
    </section>

    <section class="gateway-hero">
      <article class="panel gateway-current-card">
        <div class="gateway-live-visual" :class="statusType(selectedRuntime.state)">
          <span class="gateway-live-ring"></span>
          <span class="gateway-live-ring delay"></span>
          <Wifi :size="34" />
        </div>
        <div class="gateway-current-main">
          <div class="gateway-heading">
            <div>
              <p>当前网关</p>
              <h2>{{ collectorName({ ...selectedRow, ...selectedRuntime, ip: selectedRuntime.ip || selectedRow?.ip || selectedRuntime.host || selectedRow?.host }) }}</h2>
              <span>{{ selectedRuntime.ip || selectedRow?.ip || '-' }} · {{ selectedRuntime.transportMode || '实时通讯状态' }}</span>
            </div>
            <el-tag :type="statusType(selectedRuntime.state)" effect="plain">{{ statusText(selectedRuntime.state) }}</el-tag>
          </div>
          <div class="gateway-primary-metrics"><DataLoading :loading="initialAcousticLoading">
            <article v-for="[label, value] in primaryMetrics" :key="label">
              <span>{{ label }}</span>
              <strong>{{ value }}</strong>
            </article>
          </DataLoading></div>
          <p class="gateway-last-error" :class="{ active: selectedRuntime.lastError }">
            {{ selectedRuntime.lastError || '当前无错误信息' }}
          </p>
        </div>
      </article>

      <section class="gateway-kpis">
        <article class="panel"><span><Wifi :size="15" />在线网关</span><strong><DataLoading :loading="initialAcousticLoading" compact>{{ onlineCount }}</DataLoading></strong></article>
        <article class="panel"><span><Activity :size="15" />离线/停止</span><strong><DataLoading :loading="initialAcousticLoading" compact>{{ stoppedCount }}</DataLoading></strong></article>
        <article class="panel"><span><Cpu :size="15" />网关总数</span><strong><DataLoading :loading="initialAcousticLoading" compact>{{ statuses.length }}</DataLoading></strong></article>
        <article class="panel"><span><Database :size="15" />累计接收</span><strong><DataLoading :loading="initialAcousticLoading" compact>{{ bytes(bytesTotal) }}</DataLoading></strong><small>录音 {{ recordingSavedTotal }} 条</small></article>
      </section>
    </section>

    <section class="panel gateway-status-card">
      <div class="gateway-section-heading">
        <h2><Activity :size="16" />单网关通讯详情</h2>
        <span>{{ detailLoading ? '加载中' : formatTime(selectedRuntime.updatedAt) }}</span>
      </div>
      <div class="gateway-detail-grid"><DataLoading :loading="initialAcousticLoading">
        <article v-for="[label, value] in detailItems" :key="label">
          <span>{{ label }}</span>
          <strong :title="String(value)">{{ value }}</strong>
        </article>
      </DataLoading></div>
    </section>

    <section class="panel gateway-history-card">
      <div class="gateway-section-heading">
        <h2><History :size="16" />在线历史与可用率</h2>
        <el-button :icon="RefreshCcw" :loading="historyLoading" @click="loadHistory">刷新历史</el-button>
      </div>
      <el-table class="gateway-table" :data="pagedHistoryRows" height="360">
        <el-table-column label="网关名称" min-width="220" show-overflow-tooltip><template #default="{row}">{{ collectorName(row) }}</template></el-table-column>
        <el-table-column label="当前状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.current?.state)" effect="plain">{{ statusText(row.current?.state) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="可用率" width="100">
          <template #default="{ row }">{{ percent(row.availabilityPercent) }}</template>
        </el-table-column>
        <el-table-column label="在线时长" width="110">
          <template #default="{ row }">{{ secondsText(row.onlineSeconds) }}</template>
        </el-table-column>
        <el-table-column label="事件数" width="90">
          <template #default="{ row }">{{ row.events?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="区间开始" width="180">
          <template #default="{ row }">{{ formatTime(row.periodStart) }}</template>
        </el-table-column>
        <el-table-column label="区间结束" width="180">
          <template #default="{ row }">{{ formatTime(row.periodEnd) }}</template>
        </el-table-column>
      <template #empty><DataLoading :loading="initialAcousticLoading">暂无数据</DataLoading></template></el-table>
      <el-pagination
        v-model:current-page="historyFilter.page"
        v-model:page-size="historyFilter.pageSize"
        :total="historyRows.length"
        :page-sizes="[5, 10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="handleHistoryPageChange"
        @size-change="handleHistorySizeChange"
      />
    </section>

    <section class="panel gateway-events-card">
      <div class="gateway-section-heading">
        <h2><ListFilter :size="16" />通讯事件日志</h2>
        <el-button :icon="RefreshCcw" :loading="eventsLoading" @click="loadEvents(true)">查询</el-button>
      </div>
      <div class="gateway-event-filters">
        <el-select v-model="eventFilter.collectorId" clearable placeholder="全部网关">
          <el-option v-for="row in statuses" :key="row.collectorId" :label="collectorName(row)" :value="String(row.collectorId)" />
        </el-select>
        <el-select v-model="eventFilter.state" clearable placeholder="状态">
          <el-option v-for="item in stateOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="eventFilter.eventType" clearable placeholder="事件类型">
          <el-option v-for="item in eventTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
        <el-select v-model="eventFilter.connected" clearable placeholder="连接">
          <el-option label="已连接" value="true" />
          <el-option label="未连接" value="false" />
        </el-select>
        <el-input v-model="eventFilter.keyword" clearable placeholder="日志内容" />
        <label><Clock3 :size="14" />最近 <el-input-number v-model="eventFilter.hours" :min="1" :max="720" /> 小时</label>
      </div>
      <el-table class="gateway-table" :data="eventRows" height="430">
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatTime(row.eventAt || row.createdAt || row.timestamp) }}</template>
        </el-table-column>
        <el-table-column prop="collectorId" label="网关ID" width="190" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.state)" effect="plain">{{ statusText(row.state) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="连接" width="90">
          <template #default="{ row }">{{ row.connected ? '已连接' : '未连接' }}</template>
        </el-table-column>
        <el-table-column prop="eventType" label="事件类型" width="130" show-overflow-tooltip />
        <el-table-column prop="message" label="日志内容" min-width="260" show-overflow-tooltip />
      <template #empty><DataLoading :loading="initialAcousticLoading">暂无数据</DataLoading></template></el-table>
      <el-pagination
        v-model:current-page="eventFilter.page"
        v-model:page-size="eventFilter.pageSize"
        :total="eventFilter.total"
        :page-sizes="[20, 50, 100, 200]"
        layout="total, sizes, prev, pager, next"
        background
        @current-change="handleEventPageChange"
        @size-change="handleEventSizeChange"
      />
    </section>
    </template>
  </section>
</template>

<style scoped>
.gateway-controls { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
.gateway-filter-actions { flex-wrap:wrap; }
.gateway-view-tabs { display:flex; gap:10px; margin:10px 0; }
.gateway-view-tabs button { padding:9px 22px; border:1px solid var(--glass-border); border-radius:6px; background:var(--glass-card); color:var(--text-main); font:inherit; cursor:pointer; }
.gateway-view-tabs button.active { color:#50b9a8; border-color:#50b9a8; }
@media(max-height:800px) {
  .gateway-view-tabs { margin:8px 0; }
  .gateway-view-tabs button { padding:6px 18px; font-size:16px; }
}
</style>
