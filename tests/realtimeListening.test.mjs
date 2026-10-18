import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import * as vue from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { PcmStreamPlayer } from '../src/services/pcmStreamPlayer.js'
import { createRealtimeListening, monitorSocketUrl } from '../src/services/realtimeListening.js'
import * as charts from '../src/charts/realtimeListening.js'
import { configurationSnapshot, pointConfiguration, savePointConfiguration } from '../src/stores/pointConfiguration.js'
import { parameterKey } from '../src/charts/pointConfiguration.js'
import * as taxonomy from '../src/charts/machineTaxonomy.js'

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const flush = async () => { for (let i = 0; i < 20; i++) await vue.nextTick() }
const target = { deviceId: 'host', channelId: 'ch1', sampleRate: 100 }
const devices = [{ deviceId: 'host', deviceName: '主机', online: true,
  collectors: [{ collectorId: 1, ip: '192.168.3.51', sampleRate: 100, runtime: { connected: true } }, { collectorId: 2, ip: '192.168.3.53', runtime: { connected: false } }],
  channels: [{ channelId: 'ch1', collectorId: '1', online: true }, { channelId: 'ch2', collectorId: '2', online: false }] }]

function contextClass(instances = []) {
  return class {
    constructor() { this.currentTime = 0; this.destination = {}; this.sources = []; this.buffers = []; instances.push(this) }
    async resume() { this.resumed = true }
    async close() { this.closed = true }
    createGain() { this.gain = { gain: { value: 1 }, connect() {}, disconnect() { this.disconnected = true } }; return this.gain }
    createBuffer(_channels, length, rate) {
      const data = new Float32Array(length)
      const buffer = { duration: length / rate, getChannelData: () => data, data }
      this.buffers.push(buffer)
      return buffer
    }
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(time) { this.started = time }, stop() { this.stopped = true } }
      this.sources.push(source)
      return source
    }
  }
}

function harness(overrides = {}) {
  const sockets = [], contexts = [], states = [], frames = [], errors = [], created = [], deleted = []
  class Socket {
    constructor(url) { this.url = url; sockets.push(this) }
    close(code) { this.closed = code }
  }
  const api = { getNewApiBaseUrl: () => 'https://dashboard.test',
    async createMonitorSession(payload) { created.push(payload); return { sessionId: 's1', websocketPath: '/monitor/ws/s1', audioStreamUrl: '/monitor/audio/s1' } },
    async closeMonitorSession(id) { deleted.push(id) }, ...overrides }
  const listener = createRealtimeListening({ api, token: () => 'Bearer token', Socket, AudioContextClass: contextClass(contexts),
    onState: value => states.push(value), onFrame: value => frames.push(value), onError: value => errors.push(value) })
  return { listener, sockets, contexts, states, frames, errors, created, deleted }
}

test('PCM16 player prebuffers one second, preserves signed samples and schedules consecutive blocks', () => {
  const Context = contextClass(), context = new Context(), changes = []
  const player = new PcmStreamPlayer(context, {}, value => changes.push(value))
  const samples = new Int16Array(50)
  samples[0] = -32768; samples[1] = 32767
  player.enqueue(samples.buffer, 100)
  assert.equal(context.sources.length, 0)
  player.enqueue(new Int16Array(50).buffer, 100)
  assert.equal(context.sources.length, 2)
  assert.equal(context.buffers[0].data[0], -1)
  assert.ok(context.buffers[0].data[1] > 0.999)
  assert.equal(context.sources[0].started, 0.02)
  assert.equal(context.sources[1].started, 0.52)
  assert.deepEqual(changes, [false])
  player.stop()
  assert.ok(context.sources.every(source => source.stopped))
})

test('PCM changes in rate and underruns rebuffer; malformed data and excessive backlog fail explicitly', () => {
  const Context = contextClass(), context = new Context()
  const player = new PcmStreamPlayer(context, {})
  player.enqueue(new Int16Array(100).buffer, 100)
  context.currentTime = 2
  player.enqueue(new Int16Array(20).buffer, 100)
  assert.equal(player.buffering, true)
  assert.equal(context.sources.length, 1)
  player.enqueue(new Int16Array(100).buffer, 200)
  assert.equal(player.pendingSeconds, 0.5)
  assert.throws(() => player.enqueue(new ArrayBuffer(1), 200), /PCM16/)
  assert.throws(() => player.enqueue(new Int16Array(2200).buffer, 200), /10 秒/)
  assert.throws(() => player.enqueue(new Int16Array(1).buffer, NaN), /采样率/)
  player.stop()
})

test('listening uses current location assignments, collector identities and explicit online status', () => {
  const original = configurationSnapshot()
  try {
    let channels = charts.listeningChannels(devices, pointConfiguration.locations)
    assert.equal(channels[0].locationId, 've')
    assert.equal(channels[0].online, true)
    assert.equal(channels[1].locationId, 'main-motor')
    assert.equal(channels[1].online, false)
    const next = configurationSnapshot()
    next.targets.push({ id: 'listening-test', name: '测试通道', locationId: 'max' })
    next.parameters[parameterKey(devices[0].channels[0], 'monitor', 'host')] = { locationId: 'max', targetId: 'listening-test', displayName: '已配置声音', unit: '' }
    savePointConfiguration(next, { setItem() {} })
    channels = charts.listeningChannels(devices, pointConfiguration.locations)
    assert.equal(channels[0].locationId, 'max')
    assert.equal(channels[0].name, '已配置声音')
    assert.equal(charts.listeningChannels([{ deviceId: 'unknown', channels: [{ channelId: 'x' }] }], pointConfiguration.locations).length, 0)
  } finally { savePointConfiguration(original, { setItem() {} }) }
})

test('signal windows retain ten seconds, preserve zero peaks and reset on sequence gaps and rate changes', () => {
  let state = charts.emptyListeningSignal()
  for (let sequence = 0; sequence < 15; sequence++) state = charts.appendListeningSignal(state, { sequence, sampleRate: 10, waveform: Array(10).fill(sequence), waterfallRow: [0, 0.5], metrics: { peak: 0 } })
  assert.equal(state.waveform.length, 100)
  assert.equal(state.waterfall.length, 10)
  assert.equal(state.peakDb, 0)
  const gap = charts.appendListeningSignal(state, { sequence: 20, sampleRate: 10, waveform: [0, 1], waterfallRow: [0] })
  assert.deepEqual(gap.waveform, [0, 1])
  const changed = charts.appendListeningSignal(gap, { sequence: 21, sampleRate: 20, waveform: [-1], waterfallRow: [0] })
  assert.deepEqual(changed.waveform, [-1])
  assert.deepEqual(charts.listeningEnvelope([-1, 0, 1, 0], 2), [[-1, 0], [0, 1]])
  assert.throws(() => charts.appendListeningSignal(state, { sampleRate: 0 }), /采样率/)
})

test('session opens separate signal and PCM sockets, applies volume and cleans all resources on stop', async () => {
  const h = harness()
  await h.listener.start(target, 5)
  assert.deepEqual(h.created[0], { deviceId: 'host', channelIds: ['ch1'], visualizationRate: 5, audioCodec: 'pcm_s16le' })
  assert.equal(h.sockets.length, 2)
  assert.equal(h.sockets[1].binaryType, 'arraybuffer')
  assert.equal(new URL(h.sockets[0].url).protocol, 'wss:')
  assert.equal(new URL(h.sockets[0].url).searchParams.get('token'), 'token')
  h.sockets[0].onopen(); h.sockets[1].onopen()
  h.sockets[0].onmessage({ data: JSON.stringify({ deviceId: 'wrong', sampleRate: 100, waveform: [0] }) })
  h.sockets[0].onmessage({ data: JSON.stringify({ channelId: 'wrong', sampleRate: 100, waveform: [0] }) })
  h.sockets[0].onmessage({ data: JSON.stringify({ channelId: 'ch1', sampleRate: 100, waveform: [0] }) })
  assert.equal(h.frames.length, 1)
  h.sockets[1].onmessage({ data: new Int16Array(100).buffer })
  assert.equal(h.contexts[0].sources.length, 1)
  h.listener.setVolume(25, true)
  assert.equal(h.contexts[0].gain.gain.value, 0)
  h.listener.setVolume(25, false)
  assert.equal(h.contexts[0].gain.gain.value, 0.25)
  await h.listener.stop()
  assert.deepEqual(h.deleted, ['s1'])
  assert.ok(h.sockets.every(socket => socket.closed === 1000 && socket.onmessage === null))
  assert.ok(h.contexts[0].closed)
  assert.ok(h.contexts[0].sources[0].stopped)
})

test('stopping during creation deletes the late session without opening sockets or reviving state', async () => {
  const wait = deferred()
  const h = harness({ createMonitorSession: () => wait.promise })
  const request = h.listener.start(target)
  await flush()
  await h.listener.stop()
  wait.resolve({ sessionId: 'late' })
  await request
  assert.deepEqual(h.deleted, ['late'])
  assert.equal(h.sockets.length, 0)
  assert.equal(h.states.at(-1).monitoring, false)
  assert.ok(h.contexts[0].closed)
})

test('creation failures release the audio graph and stopping before audio resume prevents session creation', async () => {
  const h = harness({ createMonitorSession: async () => { throw new Error('HTTP 503') } })
  await h.listener.start(target)
  await flush()
  assert.equal(h.sockets.length, 0)
  assert.ok(h.contexts[0].closed)
  assert.match(h.errors[0].message, /503/)
  const waiting = harness()
  const starting = waiting.listener.start(target)
  await waiting.listener.dispose()
  await starting
  assert.equal(waiting.created.length, 0)
  assert.equal(waiting.sockets.length, 0)
  assert.ok(waiting.contexts[0].closed)
})

test('socket disconnections and malformed frames stop playback and delete the backend session', async () => {
  for (const failure of ['disconnect', 'bad-frame']) {
    const h = harness()
    await h.listener.start(target)
    if (failure === 'disconnect') h.sockets[1].onclose({ code: 1013 })
    else h.sockets[0].onmessage({ data: 'invalid-json' })
    await flush()
    assert.equal(h.errors.length, 1)
    assert.equal(h.states.at(-1).monitoring, false)
    assert.ok(h.contexts[0].closed)
    assert.deepEqual(h.deleted, ['s1'])
  }
})

test('late callbacks from previous targets cannot update frames or stop a replacement session', async () => {
  let index = 0
  const h = harness({ createMonitorSession: async () => ({ sessionId: `s${++index}` }) })
  await h.listener.start(target)
  const oldMessage = h.sockets[0].onmessage, oldClose = h.sockets[1].onclose
  await h.listener.start({ ...target, channelId: 'ch2' })
  oldMessage({ data: JSON.stringify({ sampleRate: 100, waveform: [1] }) })
  oldClose({ code: 1006 })
  assert.equal(h.frames.length, 0)
  assert.equal(h.errors.length, 0)
  assert.equal(h.states.at(-1).monitoring, true)
  await h.listener.dispose()
  assert.deepEqual(h.deleted, ['s1', 's2'])
  await h.listener.start(target)
  assert.equal(h.sockets.length, 4)
})

test('secure websocket URLs retain WSS and normalize bearer tokens', () => {
  assert.equal(new URL(monitorSocketUrl('wss://dashboard.test/monitor/ws/x', 'https://dashboard.test', 'Bearer a b')).protocol, 'wss:')
  assert.equal(new URL(monitorSocketUrl('/monitor/ws/x', 'http://dashboard.test', 'Bearer a b')).searchParams.get('token'), 'a b')
})

test('hidden recording and acoustic alarm entries cannot mount or make their old background requests', async () => {
  const alarm = await readFile(new URL('../src/views/AlarmListPage.vue', import.meta.url), 'utf8')
  const router = await readFile(new URL('../src/router/index.js', import.meta.url), 'utf8')
  assert.doesNotMatch(alarm, /声纹告警|getExternalAlarm|loadExternal/)
  assert.doesNotMatch(router, /import RecordingManagementPage|component: RecordingManagementPage/)
  assert.match(router, /path: '\/recordings', redirect: '\/realtime-listen'/)
})

test('listening page loads channels without autoplay, stops on selection changes and cancels on unmount', async () => {
  const source = await readFile(new URL('../src/views/RealtimeListeningPage.vue', import.meta.url), 'utf8')
  const compiled = compileScript(parse(source).descriptor, { id: 'realtime-listening-test' })
  const waits = [], calls = [], intervals = new Set()
  let metadataSignal
  const route = vue.reactive({ query: {} })
  const transport = { getMonitorDevices: async ({ signal }) => { metadataSignal = signal; const wait = deferred(); waits.push(wait); return wait.promise } }
  const dependencies = {
    vue, 'vue-router': { useRoute: () => route },
    'lucide-vue-next': Object.fromEntries(['Headphones', 'Play', 'Square', 'RefreshCcw', 'Volume2', 'VolumeX'].map(name => [name, {}])),
    '../services/api.js': { api: transport }, '../services/auth.js': { auth: { getToken: () => '' } },
    '../services/information.js': { reportInformation() {} }, '../stores/pointConfiguration.js': { pointConfiguration },
    '../charts/machineTaxonomy.js': taxonomy, '../charts/realtimeListening.js': charts,
    '../services/realtimeListening.js': { createRealtimeListening: () => ({ start: async value => calls.push(['start', value]), stop: async () => calls.push(['stop']), setVolume() {}, dispose: async () => calls.push(['dispose']) }) },
  }
  const context = vm.createContext({ Date, AbortController, AbortSignal, WebSocket: class {},
    setInterval: callback => { intervals.add(callback); return callback }, clearInterval: id => intervals.delete(id) })
  const module = new vm.SourceTextModule(compiled.content, { context })
  await module.link(specifier => {
    const exports = specifier.endsWith('.vue') ? { default: {} } : specifier.endsWith('.css') ? {} : dependencies[specifier]
    assert.ok(exports, specifier)
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
  })
  await module.evaluate()
  const renderer = vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null })
  const component = module.namespace.default
  component.render = () => vue.h('div')
  const app = renderer.createApp(component)
  const state = app.mount({}).$.setupState
  waits[0].resolve(devices)
  await flush()
  assert.equal(state.locationId, 've')
  assert.equal(state.selected.channelId, 'ch1')
  assert.equal(calls.filter(call => call[0] === 'start').length, 0)
  await state.start()
  assert.equal(calls.find(call => call[0] === 'start')[1].channelId, 'ch1')
  const stops = calls.length
  state.locationId = 'main-motor'
  await flush()
  assert.ok(calls.slice(stops).some(call => call[0] === 'stop'))
  assert.equal(state.canStart, false)
  const refresh = state.refreshDevices()
  app.unmount()
  assert.equal(metadataSignal.aborted, true)
  assert.equal(intervals.size, 0)
  waits[1].resolve([])
  await refresh
  assert.equal(state.devices.length, 1)
  assert.equal(calls.at(-1)[0], 'dispose')
})
