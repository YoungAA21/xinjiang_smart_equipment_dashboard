import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [vue()],
    server: {
      proxy: {
        '^/_alarm-api/api/analysis/(?:alarms|status)(?:\\?.*)?$': {
          target: env.VITE_API_BASE_URL || 'http://localhost:5158',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/_alarm-api/, ''),
        },
        // Scope this migration to three read-only health endpoints.
        '^/_health-api/api/health(?:/detail|/table-maintenance)?$': {
          target: env.VITE_API_BASE_URL || 'http://localhost:5158',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/_health-api/, ''),
        },
        '^/_telemetry-api/api/(?:configuration/modules(?:/[^/?]+/points)?|realtime/latest|telemetry/history)(?:\\?.*)?$': {
          target: env.VITE_API_BASE_URL || 'http://localhost:5158',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/_telemetry-api/, ''),
        },
      },
    },
  }
})
