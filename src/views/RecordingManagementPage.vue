<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { Database, Download, FileAudio, RefreshCcw, Search, SlidersHorizontal, Waves } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import EChart from '../components/EChart.vue'
import { api } from '../services/api'

const recordings = ref([])
const selected = ref(null)
const selectedDetail = ref(null)
const visualization = ref(null)
const monitorDevices = ref([])
const loading = ref(false)
const deviceLoading = ref(false)
const detailLoading = ref(false)
const visualLoading = ref(false)

const filters = reactive({
  page: 1,
  pageSize: 20,
  total: 0,
  deviceId: '',
  channelId: '',
  kind: '',
  fileName: '',
  startTime: '',
  endTime: '',
})

const visualParams = reactive({
  startMs: 0,
  endMs: '',
  waveformPoints: 1000,
  fftSize: 2048,
  frequencyBins: 128,
  waterfallRows: 80,
})

const selectedInfo = computed(() => selectedDetail.value || selected.value || {})
const selectedDevice = computed(() =>
  monitorDevices.value.find((device) => device.deviceId === filters.deviceId) || null)
const channelOptions = computed(() => selectedDevice.value?.channels || [])
const playbackUrl = computed(() => selectedInfo.value?.id ? api.getRecordingContentUrl(selectedInfo.value.id) : '')
const downloadUrl = computed(() => selectedInfo.value?.id ? api.getRecordingContentUrl(selectedInfo.value.id, { download: true }) : '')
const totalSize = computed(() => recordings.value.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0))
const totalDuration = computed(() => recordings.value.reduce((sum, item) => sum + Number(item.durationMs || 0), 0))

const axisColor = '#C3E2D9'
const gridColor = 'rgba(195, 226, 217, 0.12)'
const tooltip = { trigger: 'axis', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } }

const waveformOption = computed(() => {
  const data = Array.isArray(visualization.value?.waveform) ? visualization.value.waveform : []
  const envelope = Array.isArray(visualization.value?.waveformEnvelope) ? visualization.value.waveformEnvelope : []
  const sampleRate = Number(visualization.value?.sampleRate || selectedInfo.value?.sampleRate || 1)
  const startMs = Number(visualization.value?.startMs || 0)
  const durationMs = Number((visualization.value?.endMs ?? selectedInfo.value?.durationMs ?? 0) - startMs)
  const xData = data.map((_, index) => `${((startMs + (durationMs * index) / Math.max(data.length - 1, 1)) / 1000).toFixed(2)}s`)
  const minLine = envelope.map((item) => Array.isArray(item) ? Number(item[0]) : Number(item?.min ?? item?.low ?? 0))
  const maxLine = envelope.map((item) => Array.isArray(item) ? Number(item[1]) : Number(item?.max ?? item?.high ?? 0))
  return {
    tooltip,
    legend: { top: 0, textStyle: { color: axisColor }, data: ['采样折线', '包络上沿', '包络下沿'] },
    grid: { left: 46, right: 22, top: 34, bottom: 34 },
    xAxis: { type: 'category', data: xData, axisLabel: { color: axisColor }, axisLine: { lineStyle: { color: gridColor } } },
    yAxis: { type: 'value', min: -1, max: 1, axisLabel: { color: axisColor }, splitLine: { lineStyle: { color: gridColor } } },
    series: [
      { name: '采样折线', type: 'line', data, showSymbol: false, smooth: false, lineStyle: { color: '#2A86FF', width: 1.2 } },
      { name: '包络上沿', type: 'line', data: maxLine, showSymbol: false, smooth: true, lineStyle: { color: '#A8FF7D', width: 1 } },
      { name: '包络下沿', type: 'line', data: minLine, showSymbol: false, smooth: true, lineStyle: { color: '#FF8B1F', width: 1 } },
    ],
    dataZoom: [{ type: 'inside' }],
  }
})

const spectrumOption = computed(() => {
  const data = normalizeSeries(visualization.value?.spectrum)
  const sampleRate = Number(visualization.value?.sampleRate || selectedInfo.value?.sampleRate || 0)
  const maxFreq = sampleRate ? sampleRate / 2 : data.length
  const xData = data.map((_, index) => `${Math.round((maxFreq * index) / Math.max(data.length - 1, 1))}`)
  return {
    tooltip,
    grid: { left: 48, right: 24, top: 20, bottom: 34 },
    xAxis: { type: 'category', data: xData, axisLabel: { color: axisColor }, axisLine: { lineStyle: { color: gridColor } } },
    yAxis: { type: 'value', name: 'dB', nameTextStyle: { color: axisColor }, axisLabel: { color: axisColor }, splitLine: { lineStyle: { color: gridColor } } },
    series: [{
      type: 'bar',
      data,
      barMaxWidth: 12,
      itemStyle: { color: { type: 'linear', x: 0, y: 1, x2: 0, y2: 0, colorStops: [{ offset: 0, color: '#1D4ED8' }, { offset: 1, color: '#27D6AA' }] } },
    }],
  }
})

const waterfallOption = computed(() => {
  const rows = Array.isArray(visualization.value?.waterfall) ? visualization.value.waterfall : []
  const colCount = rows[0]?.length || 0
  const sampleRate = Number(visualization.value?.sampleRate || selectedInfo.value?.sampleRate || 0)
  const maxFreq = sampleRate ? sampleRate / 2 : colCount
  const xData = Array.from({ length: colCount }, (_, index) => `${Math.round((maxFreq * index) / Math.max(colCount - 1, 1))}`)
  const yData = rows.map((_, index) => `${index + 1}`)
  const heatData = []
  rows.forEach((row, y) => row.forEach((value, x) => heatData.push([x, y, Number(value)])))
  return {
    tooltip: { position: 'top', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } },
    grid: { left: 52, right: 22, top: 18, bottom: 34 },
    xAxis: { type: 'category', data: xData, axisLabel: { color: axisColor }, axisLine: { lineStyle: { color: gridColor } } },
    yAxis: { type: 'category', data: yData, axisLabel: { color: axisColor }, axisLine: { lineStyle: { color: gridColor } } },
    visualMap: { min: -90, max: 0, show: false, inRange: { color: ['#0B1020', '#1D4ED8', '#00A6A6', '#A8FF7D', '#FF8B1F'] } },
    series: [{ type: 'heatmap', data: heatData, progressive: 0 }],
  }
})

function normalizeSeries(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => Array.isArray(item) ? Number(item[1] ?? item[0]) : Number(item?.value ?? item?.db ?? item ?? 0))
}

function pageRows(data) {
  return data?.row || data?.rows || data?.records || data?.list || []
}

function formatBytes(value = 0) {
  const size = Number(value || 0)
  if (size < 1024) return `${size} B`
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
  return `${(size / 1024 ** 3).toFixed(1)} GB`
}

function formatDuration(value = 0) {
  const seconds = Math.round(Number(value || 0) / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function formatTime(value) {
  if (!value) return '-'
  const date = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

async function loadMonitorDevices() {
  deviceLoading.value = true
  try {
    const devices = await api.getMonitorDevices()
    monitorDevices.value = Array.isArray(devices) ? devices : []
    if (filters.deviceId && !monitorDevices.value.some((device) => device.deviceId === filters.deviceId)) {
      filters.deviceId = ''
      filters.channelId = ''
    }
  } catch (error) {
    ElMessage.error(error?.message || '设备列表加载失败')
  } finally {
    deviceLoading.value = false
  }
}

function handleDeviceChange() {
  if (!channelOptions.value.some((channel) => channel.channelId === filters.channelId)) {
    filters.channelId = ''
  }
}

async function loadRecordings(resetPage = false) {
  if (resetPage) filters.page = 1
  loading.value = true
  try {
    const data = await api.getRecordings({
      page: filters.page,
      pageSize: filters.pageSize,
      deviceId: filters.deviceId,
      channelId: filters.channelId,
      kind: filters.kind,
      fileName: filters.fileName,
      startTime: filters.startTime,
      endTime: filters.endTime,
    })
    const rows = pageRows(data)
    recordings.value = Array.isArray(rows) ? rows : []
    filters.total = Number(data?.total || recordings.value.length)
    filters.page = Number(data?.currentPage || filters.page)
    filters.pageSize = Number(data?.pageSize || filters.pageSize)
    if (!recordings.value.some((item) => item.id === selected.value?.id)) {
      await selectRecording(recordings.value[0] || null)
    }
  } catch (error) {
    ElMessage.error(error?.message || '录音列表加载失败')
  } finally {
    loading.value = false
  }
}

async function selectRecording(row) {
  selected.value = row
  selectedDetail.value = row
  visualization.value = null
  if (!row?.id) return
  detailLoading.value = true
  try {
    selectedDetail.value = await api.getRecording(row.id)
    await loadVisualization()
  } catch (error) {
    ElMessage.error(error?.message || '录音详情加载失败')
  } finally {
    detailLoading.value = false
  }
}

async function loadVisualization() {
  if (!selectedInfo.value?.id) return
  visualLoading.value = true
  try {
    visualization.value = await api.getRecordingVisualization(selectedInfo.value.id, {
      startMs: visualParams.startMs,
      endMs: visualParams.endMs,
      waveformPoints: visualParams.waveformPoints,
      fftSize: visualParams.fftSize,
      frequencyBins: visualParams.frequencyBins,
      waterfallRows: visualParams.waterfallRows,
    })
  } catch (error) {
    visualization.value = null
    ElMessage.error(error?.message || '录音可视化加载失败')
  } finally {
    visualLoading.value = false
  }
}

function handlePageChange(page) {
  filters.page = page
  loadRecordings()
}

function handleSizeChange(size) {
  filters.pageSize = size
  loadRecordings(true)
}

onMounted(() => {
  loadMonitorDevices()
  loadRecordings()
})
</script>

<template>
  <section class="page recording-page">
    <header class="monitor-toolbar recording-toolbar content-page-header">
      <div>
        <h1 class="content-page-title">录音管理</h1>
      </div>
      <div class="monitor-actions recording-actions">
        <el-button :icon="Search" type="primary" :loading="loading" @click="loadRecordings(true)">查询</el-button>
        <el-button :icon="RefreshCcw" :loading="loading || visualLoading" @click="loadRecordings()">刷新</el-button>
      </div>
    </header>

    <section class="panel recording-filter-panel">
      <h2><SlidersHorizontal :size="16" />检索条件</h2>
      <div class="recording-filters">
        <el-select
          v-model="filters.deviceId"
          clearable
          filterable
          :loading="deviceLoading"
          placeholder="选择设备"
          @change="handleDeviceChange"
          @clear="handleDeviceChange"
        >
          <el-option
            v-for="device in monitorDevices"
            :key="device.deviceId"
            :label="device.deviceName || device.deviceId"
            :value="device.deviceId"
          />
        </el-select>
        <el-select
          v-model="filters.channelId"
          clearable
          filterable
          :disabled="!filters.deviceId"
          placeholder="选择通道"
        >
          <el-option
            v-for="channel in channelOptions"
            :key="channel.channelId"
            :label="channel.name || channel.channelId"
            :value="channel.channelId"
          />
        </el-select>
        <el-select v-model="filters.kind" clearable placeholder="录音类型">
          <el-option label="普通录音" value="normal" />
          <el-option label="告警录音" value="alarm" />
        </el-select>
        <el-input v-model="filters.fileName" clearable placeholder="文件名" />
        <el-input v-model="filters.startTime" clearable placeholder="开始时间 2026-08-14 00:00:00" />
        <el-input v-model="filters.endTime" clearable placeholder="结束时间 2026-08-14 23:59:59" />
      </div>
    </section>

    <section class="recording-summary">
      <article class="panel"><span><FileAudio :size="15" />当前页录音</span><strong>{{ recordings.length }}</strong></article>
      <article class="panel"><span><Database :size="15" />总记录数</span><strong>{{ filters.total }}</strong></article>
      <article class="panel"><span><Waves :size="15" />当前页时长</span><strong>{{ formatDuration(totalDuration) }}</strong></article>
      <article class="panel"><span><Download :size="15" />当前页大小</span><strong>{{ formatBytes(totalSize) }}</strong></article>
    </section>

    <section class="recording-layout">
      <section class="panel recording-list-panel">
        <div class="recording-section-heading">
          <h2><FileAudio :size="16" />本地 FLAC 录音</h2>
          <span>分段播放 / 下载</span>
        </div>
        <el-table class="recording-table" :data="recordings" height="520" highlight-current-row @row-click="selectRecording">
          <el-table-column prop="fileName" label="文件名" min-width="330" show-overflow-tooltip />
          <el-table-column prop="kind" label="类型" width="90" />
          <el-table-column label="开始时间" width="170">
            <template #default="{ row }">{{ formatTime(row.startedAt) }}</template>
          </el-table-column>
          <el-table-column label="时长" width="90">
            <template #default="{ row }">{{ formatDuration(row.durationMs) }}</template>
          </el-table-column>
          <el-table-column label="采样率" width="100">
            <template #default="{ row }">{{ row.sampleRate }} Hz</template>
          </el-table-column>
          <el-table-column label="大小" width="100">
            <template #default="{ row }">{{ formatBytes(row.sizeBytes) }}</template>
          </el-table-column>
          <el-table-column prop="analysisStatus" label="分析状态" width="130" show-overflow-tooltip />
        </el-table>
        <el-pagination
          v-model:current-page="filters.page"
          v-model:page-size="filters.pageSize"
          :total="filters.total"
          :page-sizes="[10, 20, 50, 100, 200]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="handlePageChange"
          @size-change="handleSizeChange"
        />
      </section>

      <aside class="panel recording-detail-panel">
        <div class="recording-section-heading">
          <h2><Waves :size="16" />播放与详情</h2>
          <el-tag effect="plain">{{ selectedInfo.codec || 'FLAC' }}</el-tag>
        </div>
        <div v-if="!selectedInfo.id" class="empty-state">请选择一条录音</div>
        <template v-else>
          <strong class="recording-file-name">{{ selectedInfo.fileName }}</strong>
          <audio class="recording-audio" controls preload="metadata" :src="playbackUrl"></audio>
          <a class="recording-download" :href="downloadUrl" target="_blank">
            <Download :size="15" />下载录音
          </a>
          <dl class="recording-meta">
            <dt>录音ID</dt><dd>{{ selectedInfo.id }}</dd>
            <dt>设备ID</dt><dd>{{ selectedInfo.deviceId }}</dd>
            <dt>网关ID</dt><dd>{{ selectedInfo.gatherDeviceId }}</dd>
            <dt>通道ID</dt><dd>{{ selectedInfo.channelId }}</dd>
            <dt>开始时间</dt><dd>{{ formatTime(selectedInfo.startedAt) }}</dd>
            <dt>结束时间</dt><dd>{{ formatTime(selectedInfo.endedAt) }}</dd>
            <dt>采样信息</dt><dd>{{ selectedInfo.sampleRate }} Hz / {{ selectedInfo.bitDepth }} bit / {{ selectedInfo.channels }} ch</dd>
            <dt>校验值</dt><dd>{{ selectedInfo.checksum }}</dd>
          </dl>
        </template>
      </aside>
    </section>

    <section class="panel recording-visual-control">
      <div class="recording-section-heading">
        <h2><SlidersHorizontal :size="16" />可视化参数</h2>
        <el-button :icon="RefreshCcw" type="primary" plain :loading="visualLoading" :disabled="!selectedInfo.id" @click="loadVisualization">重新分析</el-button>
      </div>
      <div class="recording-visual-filters">
        <label>起点(ms)<el-input-number v-model="visualParams.startMs" :min="0" /></label>
        <label>终点(ms)<el-input v-model="visualParams.endMs" clearable placeholder="默认窗口" /></label>
        <label>波形点数<el-input-number v-model="visualParams.waveformPoints" :min="64" :max="5000" /></label>
        <label>FFT<el-input-number v-model="visualParams.fftSize" :min="256" :max="8192" /></label>
        <label>频率桶<el-input-number v-model="visualParams.frequencyBins" :min="16" :max="512" /></label>
        <label>瀑布行<el-input-number v-model="visualParams.waterfallRows" :min="8" :max="200" /></label>
      </div>
    </section>

    <section class="recording-chart-stack">
      <article class="panel recording-chart-card">
        <h2>时域波形 / 包络</h2>
        <EChart :option="waveformOption" />
      </article>
      <article class="panel recording-chart-card">
        <h2>频域响应</h2>
        <EChart :option="spectrumOption" />
      </article>
      <article class="panel recording-chart-card waterfall">
        <h2>频谱瀑布图</h2>
        <EChart :option="waterfallOption" />
      </article>
    </section>
  </section>
</template>
