import { defineStore } from 'pinia'
import { healthApi } from '../services/health.js'

export const useHealthStore = defineStore('health', {
  state: () => ({
    heartbeat: null,
    detail: null,
    maintenance: null,
    errors: {},
    loading: false,
    lastAttemptAt: null,
  }),
  getters: {
    modules: (state) => state.detail?.runtimeModules?.statuses || [],
    checks: (state) => state.detail?.checks || [],
    onlineCount() { return this.modules.filter((item) => item.isOnline === true).length },
    offlineCount() { return this.modules.filter((item) => item.isOnline === false).length },
    unknownCount() { return this.modules.length - this.onlineCount - this.offlineCount },
    failedChecks() { return this.checks.filter((item) => item.status !== 'Healthy') },
  },
  actions: {
    async refresh({ signal } = {}) {
      if (this.loading) return
      this.loading = true
      const requests = [
        ['heartbeat', healthApi.getHealth],
        ['detail', healthApi.getHealthDetail],
        ['maintenance', healthApi.getTableMaintenance],
      ]
      try {
        await Promise.all(requests.map(async ([key, request]) => {
          try {
            const value = await request({ signal })
            if (signal?.aborted) return
            this[key] = value
            delete this.errors[key]
          } catch (error) {
            if (signal?.aborted) return
            // Keep the last successful snapshot, but explicitly mark it stale in the UI.
            this.errors[key] = error.name === 'TimeoutError' ? '请求超时（10 秒）' : error.message || '连接失败'
          }
        }))
        if (!signal?.aborted) this.lastAttemptAt = new Date().toISOString()
      } finally {
        this.loading = false
      }
    },
  },
})
