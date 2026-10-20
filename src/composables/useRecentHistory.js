import { computed, ref, watch } from 'vue'
import { pointKey } from '../charts/telemetry.js'

export function useRecentHistory(points, telemetry, signal) {
  const states = ref({})
  let running = false
  const identity = point => JSON.stringify([pointKey(point), point.pointId])
  const eligible = computed(() => points.value.filter(point => Number.isSafeInteger(Number(point.pointId)) && Number(point.pointId) > 0))
  const loading = computed(() => eligible.value.some(point => states.value[identity(point)] === 'loading'))
  const failed = computed(() => eligible.value.some(point => states.value[identity(point)] === 'error'))
  async function warm() {
    if (running || signal.aborted) return
    running = true
    try {
      while (!signal.aborted) {
        const batch = eligible.value.filter(point => !states.value[identity(point)]).slice(0, 2)
        if (!batch.length) break
        await Promise.all(batch.map(async point => {
          const key = identity(point)
          states.value[key] = 'loading'
          try {
            await telemetry.seedRecentPoints(point, { signal })
            if (!signal.aborted) states.value[key] = 'ready'
          } catch { if (!signal.aborted) states.value[key] = 'error' }
        }))
      }
    } finally { running = false }
  }
  function retry() {
    for (const key of Object.keys(states.value)) if (states.value[key] === 'error') delete states.value[key]
    return warm()
  }
  watch(eligible, warm, { immediate: true })
  const isLoading = point => states.value[identity(point)] === 'loading'
  return { loading, failed, retry, isLoading }
}
