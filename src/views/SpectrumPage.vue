<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { Activity, AudioLines, CircleStop, Headphones, RefreshCcw } from 'lucide-vue-next'
import { ElMessage } from 'element-plus'
import EChart from '../components/EChart.vue'
import AudioVisualizationPanel from '../components/AudioVisualizationPanel.vue'
import { api } from '../services/api'
import { auth } from '../services/auth'

const devices = ref([])
const selectedDeviceId = ref('')
const selectedChannelId = ref('')
const loadingDevices = ref(false)
const starting = ref(false)
const session = ref(null)
const signalStatus = ref('未连接')
const audioStatus = ref('未连接')
const latestFrame = ref(null)
const waterfallHistory = ref([])
const waveform = ref([])
const envelopeFrames = ref([])
const spectrum = ref([])
const lastFrameAt = ref(0)
const audioEnabled = ref(true)
const rawFrameLogCount = ref(0)

const stats = reactive({
  frames: 0,
  audioChunks: 0,
  audioBytes: 0,
  sampleRate: 22000,
})

const sockets = {
  signal: null,
  audio: null,
}

const audioState = {
  context: null,
  nextTime: 0,
}

const MAX_AUDIO_SCHEDULE_AHEAD = 0.35
const AUDIO_START_DELAY = 0.025

const selectedDevice = computed(() =>
  devices.value.find((device) => device.deviceId === selectedDeviceId.value) || devices.value[0] || null)

const channelOptions = computed(() => selectedDevice.value?.channels || [])
const selectedChannels = computed(() =>
  channelOptions.value.filter((channel) => channel.channelId === selectedChannelId.value))

const canStart = computed(() => selectedDevice.value && selectedChannelId.value && !session.value && !starting.value)
const frameLive = computed(() => Boolean(session.value) && lastFrameAt.value > 0 && Date.now() - lastFrameAt.value < 3000)
const rollingEnvelope = computed(() => {
  const source = envelopeFrames.value.flatMap((item) => item.values)
  if (source.length <= 1200) return source
  const result = []
  const size = source.length / 1200
  for (let index = 0; index < 1200; index += 1) {
    const bucket = source.slice(Math.floor(index * size), Math.max(Math.floor(index * size) + 1, Math.floor((index + 1) * size)))
    result.push([Math.min(...bucket.map((value) => Number(value[0]) || 0)), Math.max(...bucket.map((value) => Number(value[1]) || 0))])
  }
  return result
})

const bearerToken = () => auth.getToken().replace(/^Bearer\s+/i, '')

const resolveWsUrl = (path) => {
  const url = new URL(path, api.getNewApiBaseUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', bearerToken())
  return url.toString()
}

const getSessionId = (value) => value?.sessionId || value?.id || value?.session_id || ''
const getSignalWsPath = (value) => value?.websocketPath || value?.signalWsPath || value?.wsPath || `/monitor/ws/${getSessionId(value)}`
const getAudioWsPath = (value) => value?.audioStreamUrl || value?.audioWsPath || value?.audioPath || `/monitor/audio/${getSessionId(value)}`

const numberArray = (value) => Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []
const firstArray = (...values) => values.find((value) => Array.isArray(value)) || []

const frameData = computed(() => {
  const frame = latestFrame.value || {}
  const data = frame.data && typeof frame.data === 'object' ? frame.data : frame
  return data
})

const waveformSamples = computed(() => {
  const data = frameData.value
  const raw = firstArray(data.waveform, data.samples, data.points, data.timeDomain, data.pcm, data.waveform?.samples)
  if (!Array.isArray(raw)) return []
  return raw.slice(-1600).map((item, index) => {
    if (Array.isArray(item)) return [Number(item[0] ?? index), Number(item[1] ?? 0)]
    if (item && typeof item === 'object') return [Number(item.time ?? item.timeMs ?? index), Number(item.value ?? item.y ?? item.sample ?? 0)]
    return [index, Number(item || 0)]
  }).filter((item) => Number.isFinite(item[0]) && Number.isFinite(item[1]))
})

const envelopeData = computed(() => {
  const data = frameData.value
  const raw = firstArray(data.waveformEnvelope, data.envelope, data.envelopes, data.minMax)
  if (!raw.length && waveformSamples.value.length) {
    const bucketSize = Math.max(1, Math.floor(waveformSamples.value.length / 240))
    const rows = []
    for (let index = 0; index < waveformSamples.value.length; index += bucketSize) {
      const bucket = waveformSamples.value.slice(index, index + bucketSize).map((item) => item[1])
      rows.push([index, Math.min(...bucket), Math.max(...bucket)])
    }
    return rows
  }
  return raw.map((item, index) => {
    if (Array.isArray(item)) return [index, Number(item[0] ?? 0), Number(item[1] ?? 0)]
    if (item && typeof item === 'object') return [Number(item.time ?? index), Number(item.min ?? 0), Number(item.max ?? 0)]
    return [index, 0, Number(item || 0)]
  }).filter((item) => item.every(Number.isFinite))
})

const spectrumData = computed(() => {
  const data = frameData.value
  const raw = firstArray(data.spectrum, data.fft, data.frequencyResponse, data.frequencyBins, data.bins)
  return raw.slice(0, 512).map((item, index) => {
    if (Array.isArray(item)) return [Number(item[0] ?? index), Number(item[1] ?? 0)]
    if (item && typeof item === 'object') return [Number(item.frequency ?? item.freq ?? index), Number(item.db ?? item.magnitude ?? item.value ?? item.power ?? 0)]
    return [index, Number(item || 0)]
  }).filter((item) => Number.isFinite(item[0]) && Number.isFinite(item[1]))
})

const spectrumLabels = computed(() => spectrumData.value.map((item) => item[0]))
const spectrumValues = computed(() => spectrumData.value.map((item) => item[1]))

const formatFrequencyLabel = (value, index) => {
  const frequency = Number(value)
  if (!Number.isFinite(frequency)) return ''
  const targets = [20, 100, 1000, 5000, 20000]
  const closest = targets.find((target) => Math.abs(frequency - target) <= Math.max(20, target * 0.12))
  if (!closest && index % Math.ceil(Math.max(spectrumLabels.value.length, 1) / 5) !== 0) return ''
  const shown = closest || frequency
  return shown >= 1000 ? `${Math.round(shown / 1000)}k` : String(Math.round(shown))
}

const waterfallRows = computed(() => {
  const data = frameData.value
  const raw = waterfallHistory.value.length
    ? waterfallHistory.value
    : firstArray(data.waterfall, data.waterfallRows, data.spectrogram, data.waterfallRow)
  return raw.length && Array.isArray(raw[0]) ? raw.slice(-80) : raw.length ? [raw] : []
})

const waterfallMatrix = computed(() => {
  return waterfallRows.value.flatMap((row, timeIndex) =>
    numberArray(row).slice(0, 160).map((value, frequencyIndex) => [timeIndex, frequencyIndex, value]))
})

const waterfallMax = computed(() => Math.max(...waterfallMatrix.value.map((item) => item[2]), 1))
const waterfallXLabels = computed(() => {
  return waterfallRows.value.map((_, index) => String(index + 1))
})
const waterfallYLabels = computed(() => {
  const firstRow = waterfallRows.value[0] || []
  return numberArray(firstRow).slice(0, 160).map((_, index) => String(index))
})

const waveformOption = computed(() => ({
  tooltip: { trigger: 'axis', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } },
  color: ['#1853CF', '#0AAE91'],
  grid: { left: 46, right: 18, top: 28, bottom: 34 },
  xAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.10)' } } },
  yAxis: { type: 'value', min: -1, max: 1, axisLabel: { color: '#C3E2D9', formatter: (value) => value > 0 ? `+${value}` : value }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)' } } },
  series: [{ name: '采样折线', type: 'line', symbol: 'none', data: waveformSamples.value, lineStyle: { width: 1.1 } }],
}))

const envelopeOption = computed(() => ({
  tooltip: { trigger: 'axis', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } },
  color: ['#46907C', '#A8FF7D'],
  grid: { left: 42, right: 16, top: 24, bottom: 30 },
  xAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)' } } },
  yAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)' } } },
  series: [
    { name: 'Min', type: 'line', symbol: 'none', data: envelopeData.value.map((item) => [item[0], item[1]]), lineStyle: { width: 1 } },
    { name: 'Max', type: 'line', symbol: 'none', data: envelopeData.value.map((item) => [item[0], item[2]]), lineStyle: { width: 1 }, areaStyle: { color: 'rgba(168,255,125,.08)' } },
  ],
}))

const spectrumOption = computed(() => ({
  tooltip: { trigger: 'axis', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } },
  color: ['#FF8B1F'],
  grid: { left: 46, right: 16, top: 24, bottom: 34 },
  xAxis: { type: 'value', name: 'Hz', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)' } } },
  yAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)' } } },
  series: [{ name: '频域响应', type: 'line', symbol: 'none', data: spectrumData.value, lineStyle: { width: 1.4 }, areaStyle: { color: 'rgba(255,139,31,.08)' } }],
}))

const trackOption = computed(() => ({
  tooltip: { trigger: 'axis', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } },
  color: ['#1853CF', '#0AAE91'],
  grid: { left: 46, right: 18, top: 28, bottom: 34 },
  xAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.10)' } } },
  yAxis: { type: 'value', min: -1, max: 1, axisLabel: { color: '#C3E2D9', formatter: (value) => value > 0 ? `+${value}` : value }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)' } } },
  series: envelopeData.value.length ? [
    { name: 'Min', type: 'line', stack: 'track', symbol: 'none', data: envelopeData.value.map((item) => [item[0], item[1]]), lineStyle: { color: '#1853CF', width: 1.2 } },
    {
      name: 'Envelope',
      type: 'line',
      stack: 'track',
      symbol: 'none',
      data: envelopeData.value.map((item) => [item[0], Math.max(0, item[2] - item[1])]),
      lineStyle: { color: '#0AAE91', width: 1.2 },
      areaStyle: {
        opacity: 0.74,
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 1,
          y2: 0,
          colorStops: [
            { offset: 0, color: 'rgba(24, 83, 207, 0.72)' },
            { offset: 1, color: 'rgba(10, 174, 145, 0.72)' },
          ],
        },
      },
    },
  ] : [{ name: 'Sample', type: 'line', symbol: 'none', data: waveformSamples.value, lineStyle: { width: 1.5, color: '#1853CF' }, areaStyle: { color: 'rgba(10, 174, 145, 0.16)' } }],
}))

const frequencyResponseOption = computed(() => ({
  tooltip: { trigger: 'axis', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } },
  grid: { left: 46, right: 18, top: 28, bottom: 38 },
  xAxis: {
    type: 'category',
    name: 'Hz',
    data: spectrumLabels.value,
    axisTick: { show: false },
    axisLabel: { color: '#C3E2D9', formatter: formatFrequencyLabel },
    splitLine: { show: false },
  },
  yAxis: {
    type: 'value',
    name: 'dB',
    axisLabel: { color: '#C3E2D9' },
    splitLine: { lineStyle: { color: 'rgba(195,226,217,.10)' } },
  },
  series: [{
    name: 'Frequency Response',
    type: 'bar',
    data: spectrumValues.value,
    barWidth: '62%',
    itemStyle: {
      borderRadius: [5, 5, 0, 0],
      color: {
        type: 'linear',
        x: 0,
        y: 1,
        x2: 0,
        y2: 0,
        colorStops: [
          { offset: 0, color: '#1853CF' },
          { offset: 0.55, color: '#057AD6' },
          { offset: 1, color: '#0AAE91' },
        ],
      },
    },
  }],
}))

const waterfallOption = computed(() => ({
  tooltip: { position: 'top', backgroundColor: '#111312', borderColor: '#46907C', textStyle: { color: '#FFFFFF' } },
  grid: { left: 46, right: 18, top: 24, bottom: 34 },
  xAxis: { type: 'category', name: 'Frame', data: waterfallXLabels.value, axisLabel: { color: '#C3E2D9' }, splitLine: { show: false } },
  yAxis: { type: 'category', name: 'Bin', data: waterfallYLabels.value, axisLabel: { color: '#C3E2D9' }, splitLine: { show: false } },
  visualMap: { show: false, min: 0, max: waterfallMax.value, inRange: { color: ['#111312', '#46907C', '#A8FF7D', '#FF8B1F'] } },
  series: [{ name: '频谱瀑布', type: 'heatmap', data: waterfallMatrix.value, progressive: 0 }],
}))

const loadDevices = async () => {
  loadingDevices.value = true
  try {
    const result = await api.getMonitorDevices()
    devices.value = Array.isArray(result) ? result : []
    if (!devices.value.some((device) => device.deviceId === selectedDeviceId.value)) {
      selectedDeviceId.value = devices.value[0]?.deviceId || ''
    }
    if (!channelOptions.value.some((channel) => channel.channelId === selectedChannelId.value)) {
      selectedChannelId.value = (selectedDevice.value?.channels || []).find((channel) => channel.online)?.channelId || selectedDevice.value?.channels?.[0]?.channelId || ''
    }
  } catch (error) {
    ElMessage.error(error?.message || '可监听设备加载失败')
  } finally {
    loadingDevices.value = false
  }
}

const closeSockets = () => {
  Object.values(sockets).forEach((socket) => socket?.close())
  sockets.signal = null
  sockets.audio = null
  signalStatus.value = '未连接'
  audioStatus.value = '未连接'
}

const ensureAudioContext = async () => {
  if (!audioEnabled.value) return null
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) return null
  if (!audioState.context) audioState.context = new AudioContextCtor()
  if (audioState.context.state === 'suspended') await audioState.context.resume()
  return audioState.context
}

const playPcmChunk = async (buffer) => {
  const context = await ensureAudioContext()
  if (!context || !buffer?.byteLength) return
  const pcm = new Int16Array(buffer)
  const audioBuffer = context.createBuffer(1, pcm.length, stats.sampleRate || 22000)
  const output = audioBuffer.getChannelData(0)
  for (let index = 0; index < pcm.length; index += 1) output[index] = Math.max(-1, Math.min(1, pcm[index] / 32768))
  const source = context.createBufferSource()
  source.buffer = audioBuffer
  source.connect(context.destination)
  const liveStart = context.currentTime + AUDIO_START_DELAY
  if (!audioState.nextTime || audioState.nextTime < context.currentTime || audioState.nextTime - context.currentTime > MAX_AUDIO_SCHEDULE_AHEAD) {
    audioState.nextTime = liveStart
  }
  const startAt = Math.max(liveStart, audioState.nextTime)
  source.start(startAt)
  audioState.nextTime = startAt + audioBuffer.duration
}

const connectSignalWs = () => {
  const sessionId = getSessionId(session.value)
  if (!sessionId) {
    signalStatus.value = '缺少会话ID'
    console.warn('[monitor/session missing id]', session.value)
    return
  }
  const wsUrl = resolveWsUrl(getSignalWsPath(session.value))
  console.log('[monitor/ws connect]', wsUrl)
  sockets.signal = new WebSocket(wsUrl)
  signalStatus.value = '连接中'
  sockets.signal.onopen = () => { signalStatus.value = '已连接' }
  sockets.signal.onclose = () => { signalStatus.value = session.value ? '已断开' : '未连接' }
  sockets.signal.onerror = () => { signalStatus.value = '异常' }
  sockets.signal.onmessage = (event) => {
    try {
      const frame = JSON.parse(event.data)
      if (rawFrameLogCount.value < 5) {
        console.log('[monitor/ws frame]', frame)
        rawFrameLogCount.value += 1
      }
      latestFrame.value = frame
      stats.frames += 1
      const data = frame.data && typeof frame.data === 'object' ? frame.data : frame
      waveform.value = Array.isArray(data.waveform) ? data.waveform : []
      const frameAt = Date.parse(data.timestamp) || Date.now()
      envelopeFrames.value = [...envelopeFrames.value, { at: frameAt, values: Array.isArray(data.waveformEnvelope) ? data.waveformEnvelope : [] }]
        .filter((item) => item.at >= frameAt - 10000)
      spectrum.value = Array.isArray(data.spectrum) ? data.spectrum : []
      if (Array.isArray(data.waterfallRow)) {
        waterfallHistory.value = [...waterfallHistory.value.slice(-219), data.waterfallRow]
      }
      const sampleRate = Number(data.sampleRate || data.sample_rate || data.audioSampleRate)
      if (Number.isFinite(sampleRate) && sampleRate > 0) stats.sampleRate = sampleRate
      lastFrameAt.value = Date.now()
    } catch (error) {
      console.warn('[monitor/ws parse failed]', event.data, error)
    }
  }
}

const connectAudioWs = () => {
  const sessionId = getSessionId(session.value)
  if (!audioEnabled.value || !sessionId) {
    audioStatus.value = audioEnabled.value ? '无音频地址' : '已关闭'
    return
  }
  const wsUrl = resolveWsUrl(getAudioWsPath(session.value))
  console.log('[monitor/audio connect]', wsUrl)
  sockets.audio = new WebSocket(wsUrl)
  sockets.audio.binaryType = 'arraybuffer'
  audioStatus.value = '连接中'
  sockets.audio.onopen = () => { audioStatus.value = '已连接' }
  sockets.audio.onclose = () => { audioStatus.value = session.value ? '已断开' : '未连接' }
  sockets.audio.onerror = () => { audioStatus.value = '异常' }
  sockets.audio.onmessage = (event) => {
    stats.audioChunks += 1
    stats.audioBytes += event.data?.byteLength || 0
    playPcmChunk(event.data)
  }
}

const startSession = async () => {
  if (!canStart.value) return
  starting.value = true
  rawFrameLogCount.value = 0
  latestFrame.value = null
  waterfallHistory.value = []
  waveform.value = []
  envelopeFrames.value = []
  spectrum.value = []
  lastFrameAt.value = 0
  stats.frames = 0
  stats.audioChunks = 0
  stats.audioBytes = 0
  audioState.nextTime = 0
  try {
    await ensureAudioContext()
    const result = await api.createMonitorSession({
      deviceId: selectedDevice.value.deviceId,
      channelIds: [selectedChannelId.value],
      visualizationRate: 10,
      audioCodec: 'pcm_s16le',
    })
    session.value = result
    console.log('[monitor/session created]', result)
    connectSignalWs()
    connectAudioWs()
  } catch (error) {
    ElMessage.error(error?.message || '监听会话创建失败')
  } finally {
    starting.value = false
  }
}

const stopSession = async () => {
  if (!session.value) return
  const sessionId = session.value.sessionId
  closeSockets()
  session.value = null
  waveform.value = []
  envelopeFrames.value = []
  spectrum.value = []
  waterfallHistory.value = []
  lastFrameAt.value = 0
  if (audioState.context) {
    await audioState.context.close().catch(() => {})
    audioState.context = null
  }
  audioState.nextTime = 0
  await api.closeMonitorSession(sessionId).catch((error) => {
    ElMessage.warning(error?.message || '服务端会话关闭失败')
  })
}

onMounted(loadDevices)
onBeforeUnmount(stopSession)
</script>

<template>
  <section class="page single-page spectrum-live-page">
    <header class="spectrum-page-header content-page-header"><h1 class="content-page-title">频谱分析</h1></header>
    <article class="panel spectrum-live-panel">
      <h2>实时频谱分析 / 监听会话</h2>

      <div class="spectrum-live-toolbar">
        <el-select v-model="selectedDeviceId" filterable placeholder="选择设备" :disabled="Boolean(session)">
          <el-option v-for="device in devices" :key="device.deviceId" :label="device.deviceName || device.deviceId" :value="device.deviceId" />
        </el-select>
        <el-select v-model="selectedChannelId" filterable placeholder="选择通道" :disabled="Boolean(session)">
          <el-option v-for="channel in channelOptions" :key="channel.channelId" :label="channel.name || channel.channelId" :value="channel.channelId" :disabled="!channel.online" />
        </el-select>
        <el-switch v-model="audioEnabled" active-text="音频" inactive-text="静音" :disabled="Boolean(session)" />
        <el-button :icon="RefreshCcw" :loading="loadingDevices" :disabled="Boolean(session)" @click="loadDevices">刷新设备</el-button>
        <el-button v-if="!session" type="primary" :icon="Headphones" :loading="starting" :disabled="!canStart" @click="startSession">开始监听</el-button>
        <el-button v-else type="danger" :icon="CircleStop" @click="stopSession">停止监听</el-button>
      </div>

      <div class="spectrum-session-strip">
        <span><Activity :size="15" />Session：<b>{{ session?.sessionId || '-' }}</b></span>
        <span>信号 WS：<b :class="signalStatus === '已连接' ? 'ok-text' : 'warn-text'">{{ signalStatus }}</b></span>
        <span><AudioLines :size="15" />音频 WS：<b :class="audioStatus === '已连接' ? 'ok-text' : 'warn-text'">{{ audioStatus }}</b></span>
        <span>采样率：<b>{{ stats.sampleRate }} Hz</b></span>
        <span>信号帧：<b>{{ stats.frames }}</b></span>
        <span>音频块：<b>{{ stats.audioChunks }}</b></span>
      </div>

      <section class="spectrum-live-grid">
        <AudioVisualizationPanel
          :active="frameLive"
          :waveform="waveform"
          :waveform-envelope="rollingEnvelope"
          :spectrum-data="spectrum"
          :waterfall-data="waterfallHistory"
          :sample-rate="stats.sampleRate || 22000"
          :window-seconds="10"
        />
        <section class="acoustic-chart">
          <header><strong>时域采样折线</strong><span>{{ waveformSamples.length }} points</span></header>
          <div v-if="!waveformSamples.length" class="empty-state">等待信号帧 waveform/samples</div>
          <EChart v-else :option="trackOption" />
        </section>
        <section class="acoustic-chart">
          <header><strong>时域包络</strong><span>{{ envelopeData.length }} frames</span></header>
          <div v-if="!envelopeData.length" class="empty-state">等待 envelope 或根据采样自动计算</div>
          <EChart v-else :option="envelopeOption" />
        </section>
        <section class="acoustic-chart">
          <header><strong>频域响应图</strong><span>{{ spectrumData.length }} bins</span></header>
          <div v-if="!spectrumData.length" class="empty-state">等待 spectrum: [{ frequency, db }]</div>
          <EChart v-else :option="frequencyResponseOption" />
        </section>
        <section class="acoustic-chart">
          <header><strong>频谱瀑布图</strong><span>{{ waterfallMatrix.length }} cells</span></header>
          <div v-if="!waterfallMatrix.length" class="empty-state">等待 waterfallRow</div>
          <EChart v-else :option="waterfallOption" />
        </section>
      </section>
    </article>
  </section>
</template>
