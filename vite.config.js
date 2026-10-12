import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const api5158Target = env.VITE_DEV_API_BASE_URL || env.VITE_API_BASE_URL || 'http://66.66.66.4:5158'
  const api18080Target = env.VITE_DEV_NEW_API_BASE_URL || env.VITE_NEW_API_BASE_URL || 'http://66.66.66.4:18080'
  const proxy = {
    '^/(?:api|auth|monitor|alarm|collectorManagement|recordings)(?:/|$)': {
      target: api18080Target,
      changeOrigin: true,
      ws: true,
    },
    '^/_analysis-api/api/analysis/(?:daily-limit-trends|trend-insights|trend-alarms)(?:\\?.*)?$': {
      target: api5158Target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/_analysis-api/, ''),
    },
    '^/_alarm-api/api/analysis/(?:alarms|status)(?:\\?.*)?$': {
      target: api5158Target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/_alarm-api/, ''),
    },
    // Scope this migration to three read-only health endpoints.
    '^/_health-api/api/health(?:/detail|/table-maintenance)?$': {
      target: api5158Target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/_health-api/, ''),
    },
    '^/_telemetry-api/api/(?:configuration/modules(?:/[^/?]+/points)?|realtime/latest|telemetry/history)(?:\\?.*)?$': {
      target: api5158Target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/_telemetry-api/, ''),
    },
  }
  return {
    plugins: [vue()],
    server: { host: '0.0.0.0', proxy },
    preview: { proxy },
  }
})
