import { PcmStreamPlayer } from './pcmStreamPlayer.js'

export function monitorSocketUrl(path, base, token) {
  const url = new URL(path, base)
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) throw new Error('实时连接地址无效')
  url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:'
  url.searchParams.set('token', String(token || '').replace(/^Bearer\s+/i, ''))
  return url.toString()
}

export function createRealtimeListening({ api, token, Socket, AudioContextClass, onState, onFrame, onError }) {
  let active = null, disposed = false, volume = 0.68, muted = false
  const current = operation => !disposed && active === operation && !operation.closed
  const state = (operation, value) => { if (current(operation)) onState(value) }
  const idle = () => onState({ starting: false, monitoring: false, signalConnected: false, audioConnected: false, buffering: true })

  async function close(operation) {
    if (!operation || operation.closed) return
    operation.closed = true
    for (const socket of operation.sockets) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      socket.close(1000, 'client stop')
    }
    operation.player?.stop()
    operation.gain?.disconnect()
    const jobs = []
    if (operation.context) jobs.push(operation.context.close())
    if (operation.sessionId) jobs.push(api.closeMonitorSession(operation.sessionId))
    const results = await Promise.allSettled(jobs)
    for (const result of results) if (result.status === 'rejected') onError(new Error('监听资源释放失败，请刷新后重试', { cause: result.reason }))
  }
  async function stop() {
    const closing = active
    active = null
    idle()
    await close(closing)
  }
  function fail(operation, message) {
    if (!current(operation)) return
    onError(message instanceof Error ? message : new Error(message))
    void stop()
  }
  function socketFor(operation, path, kind) {
    const socket = new Socket(monitorSocketUrl(path, api.getNewApiBaseUrl(), token()))
    operation.sockets.push(socket)
    if (kind === 'audio') socket.binaryType = 'arraybuffer'
    socket.onopen = () => state(operation, { [`${kind}Connected`]: true })
    socket.onerror = () => fail(operation, kind === 'audio' ? '音频连接失败，监听已停止' : '实时信号连接失败，监听已停止')
    socket.onclose = event => fail(operation, event.code === 1013 ? '音频传输积压超过 10 秒，监听已停止' : '实时连接已中断，监听已停止')
    return socket
  }
  async function start(target, visualizationRate = 10) {
    if (disposed) return
    if (target?.deviceId == null || target?.channelId == null) throw new Error('请选择有效的大点位及采集通道')
    const previous = active
    const operation = { sockets: [], closed: false, sessionId: '', sampleRate: target.sampleRate || 0 }
    active = operation
    void close(previous)
    state(operation, { starting: true, monitoring: false, signalConnected: false, audioConnected: false, buffering: true })
    try {
      if (!AudioContextClass) throw new Error('当前浏览器不支持实时音频播放')
      // Create and resume inside the explicit start gesture, before waiting for the backend.
      operation.context = new AudioContextClass()
      operation.gain = operation.context.createGain()
      operation.gain.connect(operation.context.destination)
      operation.gain.gain.value = muted ? 0 : volume
      operation.player = new PcmStreamPlayer(operation.context, operation.gain, buffering => state(operation, { buffering }))
      await operation.context.resume()
      if (!current(operation)) return
      const result = await api.createMonitorSession({ deviceId: target.deviceId, channelIds: [target.channelId], visualizationRate, audioCodec: 'pcm_s16le' })
      const id = result?.sessionId || result?.id || result?.session_id
      if (!id) throw new Error('监听会话缺少 sessionId')
      if (!current(operation)) {
        try { await api.closeMonitorSession(id) }
        catch (error) { onError(new Error('已取消监听的会话释放失败，请刷新后重试', { cause: error })) }
        return
      }
      operation.sessionId = id
      const signal = socketFor(operation, result.websocketPath || result.signalWsPath || `/monitor/ws/${encodeURIComponent(id)}`, 'signal')
      const audio = socketFor(operation, result.audioStreamUrl || result.audioWsPath || `/monitor/audio/${encodeURIComponent(id)}`, 'audio')
      signal.onmessage = event => {
        if (!current(operation)) return
        try {
          const message = JSON.parse(event.data)
          const frame = message.data && typeof message.data === 'object' ? message.data : message
          const deviceId = frame.deviceId ?? message.deviceId, channelId = frame.channelId ?? message.channelId
          if (deviceId != null && String(deviceId) !== String(target.deviceId)) return
          if (channelId != null && String(channelId) !== String(target.channelId)) return
          const rate = Number(frame.sampleRate)
          if (!Number.isInteger(rate) || rate <= 0 || rate > 384000) throw new Error('实时信号采样率无效')
          if (operation.sampleRate !== rate) operation.player.clear()
          operation.sampleRate = rate
          onFrame(frame)
        } catch (error) { fail(operation, new Error('实时信号格式异常，监听已停止', { cause: error })) }
      }
      audio.onmessage = event => {
        if (!current(operation) || !operation.sampleRate) return
        try {
          if (!(event.data instanceof ArrayBuffer)) throw new Error('音频数据必须为 PCM16 二进制')
          operation.player.enqueue(event.data, operation.sampleRate)
        } catch (error) { fail(operation, error) }
      }
      state(operation, { starting: false, monitoring: true })
    } catch (error) { fail(operation, error) }
  }
  function setVolume(value, silence = muted) {
    volume = Math.max(0, Math.min(100, Number(value) || 0)) / 100
    muted = Boolean(silence)
    if (active?.gain) active.gain.gain.value = muted ? 0 : volume
  }
  async function dispose() { disposed = true; await stop() }
  return { start, stop, setVolume, dispose }
}
