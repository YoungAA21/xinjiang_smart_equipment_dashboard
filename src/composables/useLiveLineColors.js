import { inject, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { alarmApi } from '../services/alarms.js'
import { alarmEvents } from '../stores/alarms.js'
import { pointConfiguration } from '../stores/pointConfiguration.js'
import { liveLineColor } from '../charts/liveLineColors.js'

const contextKey = Symbol('liveLineColors')

export function provideLiveLineColors() {
  const events = ref([])
  const controller = new AbortController()
  let timer, busy = false
  async function refresh() {
    if (busy || controller.signal.aborted) return
    busy = true
    try {
      const result = await alarmApi.getAlarms({ isActive: true, limit: 1000 }, { signal: controller.signal })
      if (!controller.signal.aborted) events.value = alarmEvents(result)
    } catch { /* Keep the last known alarms; realtime limits still apply. */ }
    finally { busy = false }
  }
  provide(contextKey, (point, sample) => liveLineColor(point, sample, events.value, pointConfiguration.lineColors))
  onMounted(() => { refresh(); timer = setInterval(refresh, 5000) })
  onBeforeUnmount(() => { controller.abort(); clearInterval(timer) })
}

export const useLiveLineColor = () => inject(contextKey, null)
