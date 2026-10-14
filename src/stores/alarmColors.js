import { defineStore } from 'pinia'
import { auth } from '../services/auth.js'
import { alarmColorName } from '../charts/alarmColors.js'

export const useAlarmColorsStore = defineStore('alarmColors', {
  state: () => ({ rules: {}, storageKey: '', error: '' }),
  actions: {
    ensureUser() {
      const user = auth.getUser()
      const key = `equipment_alarm_colors_v1:${encodeURIComponent(String(user?.id || user?.username || user?.name || 'default'))}`
      if (key === this.storageKey) return
      this.storageKey = key
      this.rules = {}
      this.error = ''
      try {
        const saved = JSON.parse(localStorage.getItem(key) || '{}')
        this.rules = Object.fromEntries(Object.entries(saved || {}).filter(([key, value]) => key.startsWith('[') && ['yellow', 'red'].includes(value)))
      } catch { this.error = '颜色配置读取失败' }
    },
    color(event) { return `var(--alarm-color-${alarmColorName(event, this.rules)})` },
    save(key, color) {
      if (!['yellow', 'red', ''].includes(color)) return
      if (color) this.rules[key] = color
      else delete this.rules[key]
      try { localStorage.setItem(this.storageKey, JSON.stringify(this.rules)); this.error = '' }
      catch { this.error = '颜色配置暂存在当前页面，浏览器保存失败' }
    },
  },
})
