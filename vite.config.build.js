import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, mergeConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export const projectRoot = fileURLToPath(new URL('./', import.meta.url))

export function resolveProxyTargets(env) {
  const target = (key, fallback) => {
    const value = String(env[key] || fallback).trim()
    let url
    try { url = new URL(value) } catch { throw new Error(`${key} 必须是完整 HTTP(S) 服务地址`) }
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '0.0.0.0'
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`${key} 必须是可访问的 HTTP(S) 服务地址，不含路径、凭据或查询参数；0.0.0.0 仅用于监听`)
    }
    return url.origin
  }
  return {
    collection: target('API_PROXY_TARGET', 'http://66.66.66.4:5158'),
    acoustic: target('ACOUSTIC_PROXY_TARGET', 'http://66.66.66.4:18080'),
  }
}

export function createBaseConfig({ mode }) {
  const env = loadEnv(mode, projectRoot, ['VITE_', 'API_', 'ACOUSTIC_'])
  // Proxy targets stay in Node; VITE_* base URLs are optional browser-side overrides.
  const { collection: api5158Target, acoustic: api18080Target } = resolveProxyTargets(env)
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
  // Same-origin browser cookies must not cross into collection services.
  for (const [pattern, options] of Object.entries(proxy)) {
    if (!pattern.startsWith('^/_')) continue
    options.configure = (upstream) => {
      upstream.on('proxyReq', (request) => {
        request.removeHeader('Authorization')
        request.removeHeader('Cookie')
      })
    }
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

