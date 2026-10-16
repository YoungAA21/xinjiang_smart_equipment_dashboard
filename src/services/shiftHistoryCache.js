import { shiftRange } from '../charts/shiftRange.js'

const abortError = () => new DOMException('请求已取消', 'AbortError')
const time = row => Date.parse(row.collectedAt)
const ordered = rows => [...new Map(rows.map(row => [time(row), row])).values()].sort((a, b) => time(a) - time(b))

function subscribe(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError())
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

// Raw samples live in IndexedDB. Only a bounded set of hour blocks stays in memory.
export function createShiftHistoryCache({ load, storage, scope = '', now = Date.now, signal, onWarning = () => {}, blockMs = 3600000, maxRows = 10000, memoryBlocks = 24 }) {
  const memory = new Map()
  const pending = new Map()
  const queue = []
  let running = 0
  let storageAvailable = Boolean(storage)
  const check = () => { if (signal?.aborted) throw abortError() }
  const remember = (key, record) => {
    memory.delete(key)
    memory.set(key, record)
    while (memory.size > memoryBlocks) memory.delete(memory.keys().next().value)
  }
  async function persist(method, ...args) {
    if (!storageAvailable) return
    try { return await storage[method](...args) }
    catch {
      storageAvailable = false
      onWarning('本地历史缓存不可用，当前使用内存缓存；缺失数据仍从接口读取')
    }
  }
  function pump() {
    while (running < 2 && queue.length) {
      const job = queue.shift()
      running++
      Promise.resolve().then(() => { check(); return job.run() }).then(job.resolve, job.reject).finally(() => { running--; pump() })
    }
  }
  function schedule(run, background) {
    return new Promise((resolve, reject) => {
      const job = { run, resolve, reject }
      if (background) queue.push(job)
      else queue.unshift(job)
      pump()
    })
  }
  async function fetchComplete(pointId, start, end) {
    check()
    const result = await load({ pointId, start: new Date(start).toISOString(), end: new Date(end).toISOString(), limit: maxRows }, { signal })
    check()
    if (!Array.isArray(result?.points) || (result.pointId != null && Number(result.pointId) !== Number(pointId))) throw new Error('历史点位返回格式不正确')
    if (result.points.some(row => !row || !Number.isFinite(time(row)) || (row.pointId != null && Number(row.pointId) !== Number(pointId)))) throw new Error('历史采样身份或时间格式不正确')
    if (result.points.length >= maxRows) {
      if (end - start <= 1) throw new Error('历史采样密度超出接口上限，无法缓存完整区间')
      const middle = Math.floor((start + end) / 2)
      const left = await fetchComplete(pointId, start, middle)
      const right = await fetchComplete(pointId, middle, end)
      return ordered([...left, ...right])
    }
    return ordered(result.points.filter(row => time(row) >= start && time(row) < end))
  }
  async function block(pointId, shiftStart, start, end, background) {
    const key = JSON.stringify([scope, shiftStart, pointId, start])
    for (;;) {
      check()
      let record = memory.get(key) || await persist('get', key)
      check()
      const age = record ? now() - record.fetchedAt : Infinity
      if (record && record.end >= end && age < (end <= now() - 120000 ? 1800000 : 15000)) {
        remember(key, record)
        return record.points
      }
      if (pending.has(key)) { await pending.get(key); continue }
      const request = schedule(async () => {
        // Re-read after queueing: another reader may have filled this block.
        record = memory.get(key) || record
        // Periodically revalidate settled blocks too, since the backend can backfill old samples.
        const from = record && now() - record.fetchedAt < 1800000 ? Math.max(start, Math.min(record.end, end) - 120000) : start
        const points = await fetchComplete(pointId, from, end)
        check()
        const next = { key, shiftStart, start, end, fetchedAt: now(), points: ordered([...(record?.points || []).filter(row => time(row) < from), ...points]) }
        remember(key, next)
        await persist('put', next)
        return next.points
      }, background)
      pending.set(key, request)
      try { return await request }
      finally { if (pending.get(key) === request) pending.delete(key) }
    }
  }
  return {
    async prune() {
      const start = Date.parse(shiftRange('current', new Date(now())).start)
      for (const [key, record] of memory) if (record.shiftStart !== start) memory.delete(key)
      await persist('prune', start)
    },
    read(query, { signal: callerSignal, background = false, warmOnly = false } = {}) {
      if (callerSignal?.aborted) return Promise.reject(abortError())
      const task = (async () => {
        check()
        const range = shiftRange('current', new Date(now()))
        const shiftStart = Date.parse(range.start), shiftEnd = Date.parse(range.end)
        const start = Date.parse(query.start), requestedEnd = Date.parse(query.end)
        // Cache current-shift data only; custom/previous-shift queries retain their transport semantics.
        if (start < shiftStart || requestedEnd > shiftEnd) return load(query, { signal: callerSignal ? AbortSignal.any([callerSignal, ...(signal ? [signal] : [])]) : signal })
        const end = Math.min(requestedEnd, now())
        if (end <= start) return { pointId: query.pointId, points: [], cache: 'shift' }
        const chunks = []
        // Recent data first, so a foreground point can share the warmup's first request.
        for (let cursor = shiftStart + Math.floor((end - 1 - shiftStart) / blockMs) * blockMs; cursor + blockMs > start && cursor >= shiftStart; cursor -= blockMs) {
          const rows = await block(query.pointId, shiftStart, cursor, Math.min(cursor + blockMs, end), background)
          if (!warmOnly) chunks.push(rows)
          if (callerSignal?.aborted) throw abortError()
        }
        const points = ordered(chunks.flat().filter(row => time(row) >= start && time(row) < end))
        return { pointId: query.pointId, points: points.slice(0, query.limit), cache: 'shift', truncated: points.length > query.limit }
      })()
      return subscribe(task, callerSignal)
    },
  }
}
