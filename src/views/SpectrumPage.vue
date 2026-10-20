<script setup>
import { computed, inject, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Activity, AudioLines, CircleStop, Headphones, RefreshCcw } from 'lucide-vue-next'
import EChart from '../components/EChart.vue'
import AudioVisualizationPanel from '../components/AudioVisualizationPanel.vue'
import { api } from '../services/api'
import { auth } from '../services/auth'
import { acousticChannelDisplayName, presentAcousticChannels } from '../charts/machineGroups.js'

const props = defineProps({
  embedded: Boolean,
  compact: Boolean,
  showAddress: Boolean,
  accentColor: { type: String, default: '#39a9ff' },
  device: { type: Object, default: null },
  channelId: { type: String, default: '' },
  displayMode: { type: String, default: 'spectrum' },
})
const reportInformation = inject('reportInformation', () => {})
const devices = ref([])
const selectedDeviceId = ref('')
const selectedChannelId = ref('')
const loadingDevices = ref(false)
const initialLoading = ref(!props.embedded)
const starting = ref(false)
let sessionVersion = 0
let disposed = false
const session = ref(null)
const signalStatus = ref('未连接')
const audioStatus = ref('未连接')
const latestFrame = ref(null)
const waterfallHistory = ref([])
const waveform = ref([])
const envelopeFrames = ref([])
const spectrum = ref([])
const lastFrameAt = ref(0)
const audioEnabled = ref(!props.embedded)
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
  props.embedded ? props.device : devices.value.find((device) => device.deviceId === selectedDeviceId.value) || devices.value[0] || null)

const channelOptions = computed(() => selectedDevice.value ? presentAcousticChannels(selectedDevice.value) : [])
const selectedChannels = computed(() =>
  channelOptions.value.filter((channel) => channel.channelId === selectedChannelId.value))
const channelName = channel => acousticChannelDisplayName(selectedDevice.value, channel)

const channelIp = computed(() => {
  const channel = channelOptions.value.find(item => item.channelId === (props.channelId || selectedChannelId.value))
  const collectors = selectedDevice.value?.collectors || []
  const collector = channel?.collectorId != null ? collectors.find(item => item.collectorId === channel.collectorId) : collectors.length === 1 ? collectors[0] : null
  return collector?.ip || '未提供'
})
const canStart = computed(() => selectedDevice.value?.online !== false && selectedChannels.value.some((channel) => channel.online) && !session.value && !starting.value)
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
  color: [props.accentColor],
  grid: props.compact ? { left: 8, right: 8, top: 14, bottom: 25 } : { left: 46, right: 18, top: 28, bottom: 34 },
  xAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.10)' } } },
  yAxis: { type: 'value', min: -1, max: 1, show: !props.compact, axisLabel: { color: '#C3E2D9', formatter: (value) => value > 0 ? `+${value}` : value }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.12)' } } },
  series: [{ name: '采样折线', type: 'line', symbol: 'none', data: waveformSamples.value, lineStyle: { width: 1.4 }, areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${props.accentColor}16` }, { offset: 1, color: `${props.accentColor}00` }] } } }],
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
  grid: { left: 8, right: 18, top: 28, bottom: 34 },
  xAxis: { type: 'value', axisLabel: { color: '#C3E2D9' }, splitLine: { lineStyle: { color: 'rgba(195,226,217,.10)' } } },
  yAxis: { type: 'value', min: -1, max: 1, show: false },
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
    reportInformation('声纹服务', error?.message || '可监听设备加载失败')
  } finally {
    loadingDevices.value = false
    initialLoading.value = false
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

const connectSignalWs = async (version = sessionVersion) => {
  const Socket = WebSocket
  if (disposed || version !== sessionVersion) return
  const sessionId = getSessionId(session.value)
  if (!sessionId) {
    signalStatus.value = '缺少会话ID'
    console.warn('[monitor/session missing id]', session.value)
    return
  }
  const wsUrl = resolveWsUrl(getSignalWsPath(session.value))
  console.log('[monitor/ws connect]', wsUrl)
  sockets.signal = new Socket(wsUrl)
  signalStatus.value = '连接中'
  sockets.signal.onopen = () => { signalStatus.value = '已连接' }
  sockets.signal.onclose = () => { signalStatus.value = session.value ? '已断开' : '未连接' }
  sockets.signal.onerror = () => { signalStatus.value = '异常'; reportInformation('声纹频谱连接', '连接异常') }
  sockets.signal.onmessage = (event) => {
    if (disposed || version !== sessionVersion) return
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

const connectAudioWs = async (version = sessionVersion) => {
  const Socket = WebSocket
  if (disposed || version !== sessionVersion) return
  const sessionId = getSessionId(session.value)
  if (!audioEnabled.value || !sessionId) {
    audioStatus.value = audioEnabled.value ? '无音频地址' : '已关闭'
    return
  }
  const wsUrl = resolveWsUrl(getAudioWsPath(session.value))
  console.log('[monitor/audio connect]', wsUrl)
  sockets.audio = new Socket(wsUrl)
  sockets.audio.binaryType = 'arraybuffer'
  audioStatus.value = '连接中'
  sockets.audio.onopen = () => { audioStatus.value = '已连接' }
  sockets.audio.onclose = () => { audioStatus.value = session.value ? '已断开' : '未连接' }
  sockets.audio.onerror = () => { audioStatus.value = '异常'; reportInformation('声纹音频连接', '连接异常') }
  sockets.audio.onmessage = (event) => {
    if (disposed || version !== sessionVersion) return
    stats.audioChunks += 1
    stats.audioBytes += event.data?.byteLength || 0
    playPcmChunk(event.data)
  }
}

let pendingStart
const startSession = () => {
  if (starting.value) return pendingStart
  pendingStart = beginSession()
  return pendingStart
}
const beginSession = async () => {
  if (!canStart.value) return
  starting.value = true
  const version = ++sessionVersion
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
    if (disposed || version !== sessionVersion) {
      const abandonedId = getSessionId(result)
      if (abandonedId) await api.closeMonitorSession(abandonedId).catch(() => {})
      return
    }
    session.value = result
    console.log('[monitor/session created]', result)
    await Promise.all([connectSignalWs(version), connectAudioWs(version)])
  } catch (error) {
    if (!disposed && version === sessionVersion) reportInformation('声纹服务', error?.message || '监听会话创建失败')
  } finally {
    starting.value = false
  }
}

const stopSession = async () => {
  sessionVersion += 1
  if (!session.value) return
  const sessionId = getSessionId(session.value)
  closeSockets()
  session.value = null
  latestFrame.value = null
  stats.frames = 0
  stats.audioChunks = 0
  stats.audioBytes = 0
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
    reportInformation('声纹服务', error?.message || '服务端会话关闭失败')
  })
}

defineExpose({ stopSession: async () => { await stopSession(); await pendingStart } })

watch(() => [props.device?.deviceId, props.channelId], () => {
  if (!props.embedded) return
  stopSession()
  selectedChannelId.value = props.channelId
})
onMounted(() => {
  if (props.embedded) {
    selectedChannelId.value = props.channelId
    if (props.compact) startSession()
  }
  else loadDevices()
})
onBeforeUnmount(() => { disposed = true; stopSession() })
</script>

<template>
  <article v-if="compact" class="acoustic-point-card" :style="{ '--point-color': accentColor }">
    <header><h3>{{ channelName(selectedChannels[0]) }}</h3><span>{{ signalStatus }}</span></header>
    <div class="acoustic-value">{{ waveformSamples.length ? Math.sqrt(waveformSamples.reduce((sum, item) => sum + item[1] ** 2, 0) / waveformSamples.length).toFixed(3) : '—' }} <small>波形 RMS</small></div>
    <p v-if="showAddress">网关 IP：{{ channelIp }}</p>
    <p>声纹实时波形 · {{ stats.sampleRate }} Hz</p>
    <div class="compact-waveform" role="img" :aria-label="channelId + '实时波形'"><EChart v-if="waveformSamples.length" :option="waveformOption" /><div v-else class="compact-empty">{{ starting ? '正在连接点位…' : '等待声纹采样' }}</div></div>
    <footer><span>{{ lastFrameAt ? new Date(lastFrameAt).toLocaleTimeString('zh-CN') : '暂无采样' }}</span><el-button v-if="!session" size="small" :loading="starting" :disabled="!canStart" @click="startSession">连接点位</el-button><el-button v-else size="small" @click="stopSession">暂停</el-button></footer>
  </article>
  <section v-else :aria-busy="initialLoading" class="page single-page spectrum-live-page" :class="{ 'embedded-spectrum': embedded }" :data-mode="displayMode">
    <header v-if="!embedded" class="spectrum-page-header content-page-header"><h1 class="content-page-title">频谱分析</h1></header>
    <article class="panel spectrum-live-panel">
      <h2>{{ embedded && displayMode === 'live' ? '实时声纹监测' : '实时频谱分析' }}</h2>

      <p v-if="showAddress">网关 IP：{{ channelIp }}</p>
      <div class="spectrum-live-toolbar">
        <el-select v-if="!embedded" v-model="selectedDeviceId" filterable placeholder="选择设备" :disabled="Boolean(session)">
          <el-option v-for="device in devices" :key="device.deviceId" :label="device.deviceName || device.deviceId" :value="device.deviceId" />
        </el-select>
        <el-select v-if="!embedded" v-model="selectedChannelId" filterable placeholder="选择通道" :disabled="Boolean(session)">
          <el-option v-for="channel in channelOptions" :key="channel.channelId" :label="channelName(channel)" :value="channel.channelId" :disabled="!channel.online" />
        </el-select>
        <el-switch v-model="audioEnabled" active-text="音频" inactive-text="静音" :disabled="Boolean(session)" />
        <el-button v-if="!embedded" :icon="RefreshCcw" :loading="loadingDevices" :disabled="Boolean(session)" @click="loadDevices">刷新设备</el-button>
        <el-button v-if="!session" type="primary" :icon="Headphones" :loading="starting" :disabled="!canStart" @click="startSession">开始监听</el-button>
        <el-button v-else type="danger" :icon="CircleStop" @click="stopSession">停止监听</el-button>
      </div>

      <div class="spectrum-session-strip">
        <span><Activity :size="15" />监听会话：<b>{{ session?.sessionId || '-' }}</b></span>
        <span>信号连接：<b :class="signalStatus === '已连接' ? 'ok-text' : 'warn-text'">{{ signalStatus }}</b></span>
        <span><AudioLines :size="15" />音频连接：<b :class="audioStatus === '已连接' ? 'ok-text' : 'warn-text'">{{ audioStatus }}</b></span>
        <span>采样率：<b>{{ stats.sampleRate }} Hz</b></span>
        <span>信号帧：<b>{{ stats.frames }}</b></span>
        <span>音频块：<b>{{ stats.audioChunks }}</b></span>
      </div>

      <section class="spectrum-live-grid"><DataLoading :loading="initialLoading" chart label="正在加载频谱设备">
        <AudioVisualizationPanel v-if="!embedded || displayMode === 'spectrum'"
          :active="frameLive"
          :waveform="waveform"
          :waveform-envelope="rollingEnvelope"
          :spectrum-data="spectrum"
          :waterfall-data="waterfallHistory"
          :sample-rate="stats.sampleRate || 22000"
          :window-seconds="10"
        />
        <section v-if="!embedded || displayMode === 'live'" class="acoustic-chart">
          <header><strong>时域采样折线</strong><span>{{ waveformSamples.length }} points</span></header>
          <div v-if="!waveformSamples.length" class="empty-state">开始监听后显示当前点位的实时波形</div>
          <EChart v-else :option="trackOption" />
        </section>
        <section v-if="!embedded || displayMode === 'live'" class="acoustic-chart">
          <header><strong>时域包络</strong><span>{{ envelopeData.length }} frames</span></header>
          <div v-if="!envelopeData.length" class="empty-state">开始监听后显示当前点位的时域包络</div>
          <EChart v-else :option="envelopeOption" />
        </section>
        <section v-if="!embedded || displayMode === 'spectrum'" class="acoustic-chart">
          <header><strong>频域响应图</strong><span>{{ spectrumData.length }} bins</span></header>
          <div v-if="!spectrumData.length" class="empty-state">开始监听后显示当前点位的频域响应</div>
          <EChart v-else :option="frequencyResponseOption" />
        </section>
        <section v-if="!embedded || displayMode === 'spectrum'" class="acoustic-chart">
          <header><strong>频谱瀑布图</strong><span>{{ waterfallMatrix.length }} cells</span></header>
          <div v-if="!waterfallMatrix.length" class="empty-state">开始监听后显示当前点位的频谱瀑布</div>
          <EChart v-else :option="waterfallOption" />
        </section>
      </DataLoading></section>
    </article>
  </section>
</template>

<style scoped>
.embedded-spectrum { height: auto; padding: 0; overflow: visible; background: transparent; }
.embedded-spectrum .spectrum-live-panel { height: auto; flex: none; overflow: visible; }
.embedded-spectrum .spectrum-live-toolbar { display: flex; flex-wrap: wrap; }
.embedded-spectrum .spectrum-live-grid { grid-template-columns: minmax(0, 1fr); }
.embedded-spectrum[data-mode="live"] .spectrum-live-grid > .acoustic-chart { display: flex; }
.embedded-spectrum[data-mode="live"] .acoustic-chart .echart { min-height: 260px; }
.embedded-spectrum .spectrum-live-grid { overflow: visible; flex: none; }
.embedded-spectrum .spectrum-session-strip { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.embedded-spectrum .spectrum-session-strip span { overflow: visible; flex-wrap: wrap; white-space: normal; }

.acoustic-point-card { min-width: 0; padding: 18px 16px 12px; background: var(--glass-card); border: 1px solid var(--glass-border); border-radius: 10px; }
.acoustic-point-card header, .acoustic-point-card footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.acoustic-point-card h3 { margin: 0; font-size: 17px; overflow-wrap: anywhere; }
.acoustic-point-card header span, .acoustic-point-card p, .acoustic-point-card footer { font-size: 12px; color: var(--text-muted); }
.acoustic-value { color: var(--point-color); font-size: 34px; margin-top: 18px; }
.acoustic-value small { font-size: 14px; color: var(--text-muted); }
.compact-waveform { height: 150px; }
.compact-empty { height: 100%; display: grid; place-items: center; color: var(--text-muted); font-size: 14px; }
</style>
