import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, mergeConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export const projectRoot = fileURLToPath(new URL('./', import.meta.url))

export function createBaseConfig({ mode }) {
  const env = loadEnv(mode, projectRoot, ['VITE_', 'API_', 'ACOUSTIC_'])
  // Proxy targets stay in Node; VITE_* base URLs are optional browser-side overrides.
  const api5158Target = env.API_PROXY_TARGET || env.VITE_DEV_API_BASE_URL || env.VITE_API_BASE_URL || 'http://66.66.66.4:5158'
  const api18080Target = env.ACOUSTIC_PROXY_TARGET || env.VITE_DEV_NEW_API_BASE_URL || env.VITE_NEW_API_BASE_URL || 'http://66.66.66.4:18080'
  const proxy = {
    '^/_configuration-api/api/frontend-files/[^/?]+(?:\\?.*)?$': {
      target: api5158Target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/_configuration-api/, ''),
    },
    '^/_runtime-api/api/runtime-info/latest$': {
      target: api5158Target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/_runtime-api/, ''),
    },
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
    '^/_telemetry-api/api/(?:configuration/modules(?:/[^/?]+/points)?|configuration/points/[0-9]+/limits|realtime/latest|telemetry/history)(?:\\?.*)?$': {
      target: api5158Target,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/_telemetry-api/, ''),
    },
  }
  return {
    root: projectRoot,
    envDir: projectRoot,
    base: '/',
    plugins: [vue()],
    server: { host: '0.0.0.0', port: 5173, proxy },
    preview: { host: '0.0.0.0', port: 4173, proxy },
  }
}

export default defineConfig((environment) => {
  const debug = environment.mode === 'debug'

  return mergeConfig(createBaseConfig(environment), {
    build: {
      target: 'es2020',
      outDir: debug ? 'dist-debug' : 'dist',
      emptyOutDir: true,
      sourcemap: debug,
      minify: !debug,
      cssMinify: !debug,
      manifest: true,
      assetsDir: 'assets',
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'charts', test: /node_modules[\\/](?:echarts|zrender)[\\/]/ },
              { name: 'element-plus', test: /node_modules[\\/](?:element-plus|@element-plus)[\\/]/ },
              { name: 'vue-vendor', test: /node_modules[\\/](?:@vue|vue|vue-router|pinia)[\\/]/ },
            ],
          },
        },
      },
    },
  })
})

