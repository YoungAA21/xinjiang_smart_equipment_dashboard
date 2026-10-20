<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Headphones, Play, Square, RefreshCcw, Volume2, VolumeX } from 'lucide-vue-next'
import AudioVisualizationPanel from '../components/AudioVisualizationPanel.vue'
import { api } from '../services/api.js'
import { auth } from '../services/auth.js'
import { reportInformation } from '../services/information.js'
import { pointConfiguration } from '../stores/pointConfiguration.js'
import { locationHierarchyLabel } from '../charts/machineTaxonomy.js'
import { listeningChannels, emptyListeningSignal, appendListeningSignal, listeningEnvelope } from '../charts/realtimeListening.js'
import { createRealtimeListening } from '../services/realtimeListening.js'
import '../styles/realtime-listening.css'

const route = useRoute()
const devices = ref([]), loading = ref(false), devicesError = ref(''), error = ref('')
const initialLoading = ref(true)
const locationId = ref(String(route.query.location || '')), channelKey = ref(''), refreshRate = ref(10)
const volume = ref(68), muted = ref(false), signal = shallowRef(emptyListeningSignal())
const state = reactive({ starting: false, monitoring: false, signalConnected: false, audioConnected: false, buffering: true })
const lastFrameAt = ref(0), clock = ref(Date.now())
const controller = new AbortController()
let refreshTimer, clockTimer
const allChannels = computed(() => listeningChannels(devices.value, pointConfiguration.locations))
const locations = computed(() => pointConfiguration.locations.map(location => ({ ...location,
  label: locationHierarchyLabel(location), count: allChannels.value.filter(channel => channel.locationId === location.id).length })))
const channels = computed(() => allChannels.value.filter(channel => channel.locationId === locationId.value))
const selected = computed(() => channels.value.find(channel => channel.key === channelKey.value))
const selectedLocation = computed(() => locations.value.find(location => location.id === locationId.value))
const canStart = computed(() => selected.value?.online === true && !devicesError.value && !state.starting && !state.monitoring)
const frameLive = computed(() => state.monitoring && state.signalConnected && lastFrameAt.value > 0 && clock.value - lastFrameAt.value < 3000)
const connectionLabel = computed(() => state.starting ? '正在创建监听会话' : !state.monitoring ? '监听未启动'
  : !state.signalConnected || !state.audioConnected ? '正在连接' : frameLive.value ? '实时数据已接入' : '等待实时数据')
const audioLabel = computed(() => !state.monitoring || !state.audioConnected ? '未开启' : muted.value ? '已静音' : state.buffering ? '缓冲中' : '监听中')
const gatewayLabel = computed(() => devicesError.value ? '状态获取失败' : selected.value?.online === true ? '在线' : selected.value?.online === false ? '离线' : '状态待确认')
const envelope = computed(() => listeningEnvelope(signal.value.waveform))
// The visual panel receives at most 1400 representatives; the envelope retains every bucket's peaks.
const displayedWaveform = computed(() => {
  const values = signal.value.waveform
  const size = Math.min(1400, values.length)
  return Array.from({ length: size }, (_, index) => values[Math.floor(index * values.length / size)])
})

const listener = createRealtimeListening({ api, token: () => auth.getToken(), Socket: WebSocket,
  AudioContextClass: globalThis.AudioContext || globalThis.webkitAudioContext,
  onState(value) {
    Object.assign(state, value)
    if (value.monitoring === false) { signal.value = emptyListeningSignal(); lastFrameAt.value = 0 }
  },
  onFrame(frame) { signal.value = appendListeningSignal(signal.value, frame); lastFrameAt.value = Date.now() },
  onError(reason) { error.value = reason.message; reportInformation('实时监听', reason) },
})
async function stop() { await listener.stop() }
async function start() {
  if (!canStart.value) return
  error.value = ''
  listener.setVolume(volume.value, muted.value)
  await listener.start({ ...selected.value }, refreshRate.value)
}
async function refreshDevices() {
  if (loading.value || controller.signal.aborted) return
  loading.value = true
  try {
    const result = await api.getMonitorDevices({ signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
    if (controller.signal.aborted) return
    if (!Array.isArray(result) || result.some(device => device?.deviceId == null || (device.channels != null && !Array.isArray(device.channels)))) throw new Error('声纹通道目录格式不正确')
    devices.value = result
    devicesError.value = ''
    if (!locationId.value || !locations.value.some(location => location.id === locationId.value)) locationId.value = locations.value.find(location => location.count)?.id || ''
    if (!channels.value.some(channel => channel.key === channelKey.value)) channelKey.value = channels.value[0]?.key || ''
  } catch (reason) {
    if (!controller.signal.aborted) {
      devicesError.value = reason.name === 'TimeoutError' ? '声纹通道目录请求超时' : reason.message || '声纹通道目录获取失败'
      reportInformation('实时监听', devicesError.value)
    }
  } finally { loading.value = false; initialLoading.value = false }
}
watch(locationId, () => { channelKey.value = channels.value[0]?.key || ''; void stop() })
watch(() => selected.value?.key, () => { void stop() }, { flush: 'sync' })
watch(() => selected.value?.online, online => { if (online !== true) void stop() })
watch(channels, value => { if (!value.some(channel => channel.key === channelKey.value)) channelKey.value = value[0]?.key || '' })
watch([volume, muted], () => listener.setVolume(volume.value, muted.value))
watch(() => route.query.location, value => { if (value) locationId.value = String(value) })
onMounted(() => {
  refreshDevices()
  refreshTimer = setInterval(refreshDevices, 15000)
  clockTimer = setInterval(() => { clock.value = Date.now() }, 1000)
})
onBeforeUnmount(() => {
  controller.abort()
  clearInterval(refreshTimer)
  clearInterval(clockTimer)
  void listener.dispose()
})
</script>

<template>
  <section :aria-busy="initialLoading" class="page realtime-listening-page" aria-label="实时监听">
    <header class="listening-heading"><div><h1><Headphones :size="24" />实时监听</h1><p>选择大点位，查看现场信号并监听实时音频。</p></div><span class="listening-badge" :class="{ live: frameLive }">{{ connectionLabel }}</span></header>
    <section class="listening-controls listening-panel">
      <label><span>大点位</span><el-select v-model="locationId" filterable aria-label="监听大点位" placeholder="选择大点位" :loading="loading"><el-option v-for="location in locations" :key="location.id" :label="`${location.label}${location.count ? '' : '（暂无音频通道）'}`" :value="location.id" :disabled="!location.count" /></el-select></label>
      <label><span>采集通道</span><el-select v-model="channelKey" aria-label="监听采集通道" placeholder="暂无音频通道" :disabled="!channels.length"><el-option v-for="channel in channels" :key="channel.key" :value="channel.key" :label="`${channel.name} · ${channel.deviceName}${channel.online === false ? '（离线）' : ''}`" /></el-select></label>
      <label><span>刷新频率</span><el-select v-model="refreshRate" aria-label="监听刷新频率" :disabled="state.monitoring || state.starting"><el-option v-for="rate in [30, 20, 10, 5, 1]" :key="rate" :value="rate" :label="`${rate} 帧/秒${rate === 10 ? '（推荐）' : ''}`" /></el-select></label>
      <div class="listening-actions"><el-button :icon="RefreshCcw" :loading="loading" @click="refreshDevices">刷新通道</el-button><el-button v-if="!state.monitoring && !state.starting" type="primary" :icon="Play" :disabled="!canStart" @click="start">开始监听</el-button><el-button v-else :icon="Square" @click="stop">停止监听</el-button></div>
    </section>
    <p v-if="devicesError || error" class="listening-error" role="alert">{{ devicesError || error }}</p>
    <p v-if="!loading && !channels.length" class="listening-empty">当前大点位暂无可监听的音频通道，请检查声纹通道及参数点位归属。</p>
    <section class="listening-status-grid" aria-label="监听状态">
      <article class="listening-panel"><span>采集连接</span><strong><DataLoading :loading="initialLoading" compact>{{ gatewayLabel }}</DataLoading></strong></article>
      <article class="listening-panel"><span>现场音频</span><strong><DataLoading :loading="initialLoading" compact>{{ audioLabel }}</DataLoading></strong></article>
      <article class="listening-panel"><span>有效采样率</span><strong><DataLoading :loading="initialLoading" compact>{{ signal.sampleRate ? `${signal.sampleRate / 1000} kHz` : '—' }}</DataLoading></strong></article>
      <article class="listening-panel"><span>信号电平</span><strong><DataLoading :loading="initialLoading" compact>{{ signal.peakDb == null ? '—' : `${signal.peakDb.toFixed(1)} dBFS` }}</DataLoading></strong></article>
    </section>
    <section class="listening-panel listening-signal">
      <header><div><h2>{{ selectedLocation?.name || '未选择大点位' }}<span v-if="selected"> · {{ selected.name }}</span></h2><p>{{ selected?.deviceName || '等待选择音频通道' }}</p></div><span class="listening-badge" :class="{ live: frameLive }">{{ frameLive ? 'LIVE' : 'IDLE' }}</span></header>
      <DataLoading :loading="initialLoading" chart label="正在加载监听通道"><AudioVisualizationPanel :active="frameLive" :waveform="displayedWaveform" :waveform-envelope="envelope" :spectrum-data="signal.spectrum" :waterfall-data="signal.waterfall" :sample-rate="signal.sampleRate || 22000" :window-seconds="10" /></DataLoading>
    </section>
    <section class="listening-panel listening-audio"><div><h2>现场音频监听</h2><p>积累 1 秒音频后连续播放，切换点位或离开页面会停止监听。</p></div><label><Volume2 :size="20" /><input v-model.number="volume" type="range" min="0" max="100" aria-label="监听音量" :disabled="!state.monitoring || muted" /><span>{{ muted ? 0 : volume }}%</span></label><el-button :icon="muted ? VolumeX : Volume2" :disabled="!state.monitoring" @click="muted = !muted">{{ muted ? '恢复监听' : '静音' }}</el-button></section>
  </section>
</template>
