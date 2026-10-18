import { reportInformation } from './information.js'

// One visualization session at a time; never subscribe to the audio socket.
export function createSoundPreview({ api, token, Socket, onFrame, onStatus }) {
  let version = 0, sessionId = '', socket, queue = Promise.resolve()
  const idOf = result => result?.sessionId || result?.id || result?.session_id
  async function close() {
    if (socket) { socket.onmessage = socket.onclose = socket.onerror = null; socket.close(); socket = null }
    if (sessionId) { await api.closeMonitorSession(sessionId); sessionId = '' }
  }
  function setTarget(target) {
    const current = ++version
    if (socket) socket.onmessage = null
    queue = queue.catch(() => {}).then(async () => {
      await close()
      if (current !== version || !target) return
      onStatus('连接中')
      const result = await api.createMonitorSession({ deviceId: target.deviceId, channelIds: target.channelIds, visualizationRate: 2, audioCodec: 'pcm_s16le' })
      sessionId = idOf(result)
      if (!sessionId) throw new Error('缺少会话ID')
      if (current !== version) { await close(); return }
      const url = new URL(result.websocketPath || result.signalWsPath || result.wsPath || `/monitor/ws/${sessionId}`, api.getNewApiBaseUrl())
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('token', token().replace(/^Bearer\s+/i, ''))
      socket = new Socket(url.toString())
      socket.onclose = () => { if (current === version) { onStatus('连接断开'); reportInformation('声纹连接', '连接断开') } }
      socket.onerror = () => { if (current === version) { onStatus('连接异常'); reportInformation('声纹连接', '连接异常') } }
      socket.onmessage = event => {
        if (current !== version) return
        try {
          const frame = JSON.parse(event.data)
          const data = frame.data && typeof frame.data === 'object' ? frame.data : frame
          const channelId = data.channelId ?? frame.channelId ?? (target.channelIds.length === 1 ? target.channelIds[0] : null)
          const matchedChannel = target.channelIds.find(id => String(id) === String(channelId))
          if (matchedChannel == null) return
          if ((data.deviceId ?? frame.deviceId) != null && String(data.deviceId ?? frame.deviceId) !== String(target.deviceId)) return
          onFrame(target.deviceId, matchedChannel, data)
          onStatus('已连接')
        } catch { /* Ignore malformed frames without replacing valid charts. */ }
      }
    }).catch(error => { if (current === version) onStatus('连接失败'); throw error })
    return queue
  }
  return { setTarget, stop: () => setTarget(null) }
}
