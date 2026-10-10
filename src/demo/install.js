import { auth } from '../services/auth.js'
import { createDemoFetch } from './transport.js'

export function installDemo() {
  const originalFetch = window.fetch.bind(window)
  window.fetch = createDemoFetch(originalFetch, { baseUrl: window.location.href })
  auth.setSession('offline-demo', { username: '演示管理员' })
  document.title = '智能设备健康管理平台 · 演示数据'
  const badge = document.createElement('div')
  badge.textContent = '演示数据 · 非现场实测'
  badge.style.cssText = 'position:fixed;bottom:8px;right:16px;z-index:9999;padding:4px 10px;border:1px solid #46907c66;border-radius:5px;background:#11241fe8;color:#a8d9c7;font:14px Microsoft YaHei,sans-serif;pointer-events:none'
  document.body.appendChild(badge)
}
