import { defineStore } from 'pinia'
import { api } from '../services/api'

// Home-only snapshot; existing device/recording/monitor pages keep their own behavior.
export const useHomeDevicesStore = defineStore('homeDevices', {
  state: () => ({ devices: null, error: '', loading: false, refreshedAt: null, requestId: 0 }),
  actions: {
    async refresh({ signal } = {}) {
      if (this.loading || signal?.aborted) return
      const requestId = ++this.requestId
      this.loading = true
      try {
        const timeout = AbortSignal.timeout(10000)
        const devices = await api.getMonitorDevices({ signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
        if (signal?.aborted || this.requestId !== requestId) return
        if (!Array.isArray(devices) || devices.some((device) => !device || device.deviceId == null || String(device.deviceId).trim() === '')) {
          throw new Error('设备接口返回格式不正确')
        }
        this.devices = devices
        this.refreshedAt = new Date().toISOString()
        this.error = ''
      } catch (error) {
        if (signal?.aborted || this.requestId !== requestId) return
        this.error = error.name === 'TimeoutError' ? '请求超时（10 秒）' : error.message || '设备接口连接失败'
      } finally {
        if (this.requestId === requestId) this.loading = false
      }
    },
    clear() {
      // Invalidate requests from a previous home visit or signed-in session.
      this.requestId += 1
      this.devices = null
      this.error = ''
      this.loading = false
      this.refreshedAt = null
    },
  },
})
