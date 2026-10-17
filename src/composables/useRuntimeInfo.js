import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { getRuntimeInfo } from '../services/runtimeInfo.js'

export function useRuntimeInfo() {
  const data = ref(null)
  const error = ref('')
  let timer, controller, stopped = false, busy = false
  const summary = computed(() => data.value?.summary || {})
  const status = computed(() => {
    if (error.value) return '运行信息获取失败，数据可能已过期'
    if (!data.value) return '运行信息加载中'
    if (data.value.status === 'Online') return data.value.stations?.some(row => row.isStale) ? '运行信息已过期' : ''
    return { Offline: '运行信息离线，显示上次数据', NoData: '暂无运行信息', Disabled: '运行信息未启用' }[data.value.status] || '运行信息状态未知'
  })
  async function refresh() {
    if (stopped || busy) return
    busy = true
    controller = new AbortController()
    try {
      const result = await getRuntimeInfo({ signal: controller.signal })
      if (!stopped) { data.value = result; error.value = '' }
    } catch (cause) {
      if (!stopped) error.value = cause.message
    } finally {
      busy = false
    }
  }
  onMounted(() => {
    refresh()
    timer = window.setInterval(refresh, 1000)
  })
  onBeforeUnmount(() => {
    stopped = true
    window.clearInterval(timer)
    controller?.abort()
  })
  return { summary, status, error }
}
