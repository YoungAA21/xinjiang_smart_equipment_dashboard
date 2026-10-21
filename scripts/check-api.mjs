import net from 'node:net'
import { pathToFileURL } from 'node:url'
import { loadEnv } from 'vite'
import { projectRoot, resolveProxyTargets } from '../vite.config.build.js'

// TCP only: never submit login credentials or create backend sessions.
export function probeTcp(address, timeoutMs = 4000) {
  const url = new URL(address)
  return new Promise(resolve => {
    const socket = net.createConnection({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) })
    const finish = result => { socket.destroy(); resolve(result) }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish('connected'))
    socket.once('timeout', () => finish('ETIMEDOUT'))
    socket.once('error', error => finish(error.code || error.message))
  })
}

async function main() {
  const args = process.argv.slice(2)
  const modeIndex = args.indexOf('--mode')
  const mode = modeIndex < 0 ? 'development' : args[modeIndex + 1]
  if (!['development', 'debug', 'production'].includes(mode)) throw new Error('--mode 仅支持 development、debug、production')
  const env = loadEnv(mode, projectRoot, ['VITE_', 'API_', 'ACOUSTIC_'])
  const targets = resolveProxyTargets(env)
  console.log(`环境：${mode}；配置：.env.${mode} / .env.${mode}.local（进程环境变量优先）`)
  console.table([
    { 服务: '采集', 浏览器入口: '/_telemetry-api、/_health-api、/_alarm-api、/_analysis-api、/_runtime-api、/_configuration-api', Vite上游: targets.collection },
    { 服务: '声纹 / 登录', 浏览器入口: '/auth/login、/monitor、/alarm、/collectorManagement、/recordings、/api', Vite上游: targets.acoustic },
  ])
  for (const key of ['VITE_API_BASE_URL', 'VITE_NEW_API_BASE_URL', 'VITE_LOGIN_API_URL']) {
    if (String(env[key] || '').trim()) console.log(`${key} 已配置：对应浏览器请求使用独立地址，不一定经过以上代理。`)
  }
  console.log('生产 Nginx 的 upstream 独立配置，不受 Vite 代理变量控制。')
  if (args.includes('--offline')) return
  const results = await Promise.all(Object.entries(targets).map(async ([name, address]) => ({ name, address, status: await probeTcp(address) })))
  for (const result of results) console.log(`${result.name} ${result.address}: ${result.status}`)
  console.log('connected 仅表示端口可达；登录是否正常需检查 HTTP 响应。超时请检查局域网/VPN、路由、防火墙和服务监听。')
  if (results.some(result => result.status !== 'connected')) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
