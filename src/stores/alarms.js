import { defineStore } from 'pinia'
import { alarmApi, validateAlarmQuery } from '../services/alarms.js'

export function alarmEvents(body) {
  const events = Array.isArray(body) ? body : body?.events
  if (!Array.isArray(events) || events.some((event) => !event || typeof event !== 'object')) throw new Error('报警响应格式不正确，需返回数组或 events 数组')
  return events
}
const errorMessage = (error) => error.name === 'TimeoutError' ? '请求超时（10 秒）' : error.message || '请求失败'

export const useAlarmStore = defineStore('legacyAlarms', {
  state: () => ({ rows: null, requested: null, updatedAt: null, error: '', loading: false, selected: null, version: 0, status: null, statusError: '', statusLoading: false, statusVersion: 0 }),
  actions: {
    async load(query = {}, { signal } = {}) {
      const version = ++this.version
      this.loading = true
      this.error = ''
      try {
        const requested = validateAlarmQuery(query)
        const body = await alarmApi.getAlarms(requested, { signal })
        if (signal?.aborted || version !== this.version) return
        this.rows = alarmEvents(body)
        this.requested = { ...requested }
        this.updatedAt = new Date().toISOString()
        this.selected = this.rows[0] || null
      } catch (error) {
        if (!signal?.aborted && version === this.version) this.error = errorMessage(error)
      } finally {
        if (version === this.version) this.loading = false
      }
    },
    async loadStatus({ signal } = {}) {
      const version = ++this.statusVersion
      this.statusLoading = true
      this.statusError = ''
      try {
        const body = await alarmApi.getStatus({ signal })
        if (signal?.aborted || version !== this.statusVersion) return
        if (!body || typeof body !== 'object' || !body.runtimeStatus) throw new Error('分析状态响应格式不正确')
        this.status = body
      } catch (error) {
        if (!signal?.aborted && version === this.statusVersion) this.statusError = errorMessage(error)
      } finally {
        if (version === this.statusVersion) this.statusLoading = false
      }
    },
    clear() {
      const version = this.version + 1
      const statusVersion = this.statusVersion + 1
      this.$reset()
      this.version = version
      this.statusVersion = statusVersion
    },
  },
})
