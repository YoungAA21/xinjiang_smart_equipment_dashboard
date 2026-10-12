import test from 'node:test'
import assert from 'node:assert/strict'
import { createSoundPreview } from '../src/services/soundPreview.js'

test('one visual session routes channels and releases before switching, without an audio socket', async () => {
  const calls = [], frames = [], sockets = []
  class Socket { constructor(url) { this.url = url; sockets.push(this) } close() { calls.push('socket-close') } }
  const api = { getNewApiBaseUrl: () => 'http://localhost:18080',
    async createMonitorSession(payload) { calls.push(payload); return { sessionId: payload.deviceId } },
    async closeMonitorSession(id) { calls.push(`delete-${id}`) },
  }
  const preview = createSoundPreview({ api, Socket, token: () => 'test', onFrame: (...frame) => frames.push(frame), onStatus() {} })
  await preview.setTarget({ deviceId: 'a', channelIds: ['1', '2'] })
  assert.equal(sockets.length, 1)
  assert.ok(sockets[0].url.includes('/monitor/ws/a'))
  sockets[0].onmessage({ data: JSON.stringify({ channelId: '2', data: { waterfallRow: [0, .5] } }) })
  sockets[0].onmessage({ data: JSON.stringify({ channelId: 'wrong', data: { waterfallRow: [1] } }) })
  sockets[0].onmessage({ data: JSON.stringify({ data: { waterfallRow: [1] } }) })
  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0].slice(0, 2), ['a', '2'])
  await preview.setTarget({ deviceId: 'b', channelIds: ['3'] })
  assert.equal(calls[1], 'socket-close')
  assert.equal(calls[2], 'delete-a')
  assert.equal(calls[3].deviceId, 'b')
  await preview.stop()
  assert.equal(calls.at(-1), 'delete-b')
})

test('a pending creation is closed when the user leaves before it returns', async () => {
  let release; const deleted = []
  const preview = createSoundPreview({ api: {
    createMonitorSession: () => new Promise(resolve => release = resolve),
    closeMonitorSession: async id => deleted.push(id),
  }, token: () => '', Socket: class { constructor() { throw Error('must not connect') } }, onFrame() {}, onStatus() {} })
  const loading = preview.setTarget({ deviceId: 'a', channelIds: ['1'] })
  while (!release) await Promise.resolve()
  const stop = preview.stop()
  release({ sessionId: 'late' })
  await Promise.all([loading, stop])
  assert.deepEqual(deleted, ['late'])
})

