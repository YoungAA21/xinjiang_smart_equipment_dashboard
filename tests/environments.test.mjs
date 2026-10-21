import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { loadEnv, resolveConfig } from 'vite'
import developmentConfig from '../vite.config.build.js'
import buildConfig from '../vite.config.build.js'
import { projectRoot, resolveProxyTargets } from '../vite.config.build.js'
import { EventEmitter } from 'node:events'

const execute = promisify(execFile)
const collectionPath = '/_telemetry-api/api/realtime/latest'
const proxyFor = (config, path) => Object.entries(config.server.proxy)
  .find(([pattern]) => new RegExp(pattern).test(path))?.[1]

test('proxy targets use only server variables and reject wildcard listening addresses or URL paths', () => {
  const targets = resolveProxyTargets({
    API_PROXY_TARGET: ' http://127.0.0.1:15158/ ', ACOUSTIC_PROXY_TARGET: 'https://acoustic.example:18443/',
    VITE_API_BASE_URL: 'https://browser.example', VITE_DEV_NEW_API_BASE_URL: 'http://obsolete.example:18080',
  })
  assert.deepEqual(targets, { collection: 'http://127.0.0.1:15158', acoustic: 'https://acoustic.example:18443' })
  assert.equal(resolveProxyTargets({ VITE_API_BASE_URL: 'https://browser.example' }).collection, 'http://66.66.66.4:5158')
  for (const address of ['http://0.0.0.0:18080', '/auth/login', 'ftp://server', 'http://server/api', 'http://user:secret@server', 'http://server?x=1']) {
    assert.throws(() => resolveProxyTargets({ ACOUSTIC_PROXY_TARGET: address }), /ACOUSTIC_PROXY_TARGET/)
  }
})

for (const mode of ['development', 'debug', 'production']) {
  test(`${mode} keeps browser requests same-origin and separates collection and acoustic upstreams`, () => {
    const env = loadEnv(mode, projectRoot, ['VITE_', 'API_', 'ACOUSTIC_'])
    assert.equal(env.VITE_API_BASE_URL, '')
    assert.equal(env.VITE_NEW_API_BASE_URL, '')
    assert.equal(env.VITE_LOGIN_API_URL, '')
    assert.equal(env.VITE_LEGACY_API_DISABLED, 'true')

    const config = developmentConfig({ mode })
    const collection = proxyFor(config, collectionPath)
    assert.equal(collection.target, env.API_PROXY_TARGET)
    assert.equal(collection.rewrite(collectionPath), '/api/realtime/latest')
    const configurationPath = '/_configuration-api/api/frontend-files/%E7%9B%91%E6%B5%8B.json'
    const configuration = proxyFor(config, configurationPath)
    assert.equal(configuration.target, env.API_PROXY_TARGET)
    assert.equal(configuration.rewrite(configurationPath), '/api/frontend-files/%E7%9B%91%E6%B5%8B.json')
    assert.equal(proxyFor(config, '/_configuration-api/api/unrelated'), undefined)
    assert.equal(proxyFor(config, '/auth/login').target, env.ACOUSTIC_PROXY_TARGET)
    assert.equal(proxyFor(config, '/monitor/sessions').ws, true)
    assert.equal(proxyFor(config, '/_telemetry-api/api/modbus-writebacks/trigger'), undefined)
    assert.equal(config.preview.proxy, config.server.proxy)
    const upstream = new EventEmitter()
    collection.configure(upstream)
    const removed = []
    upstream.emit('proxyReq', { removeHeader: name => removed.push(name) })
    assert.deepEqual(removed, ['Authorization', 'Cookie'])
    assert.equal(proxyFor(config, '/auth/login').configure, undefined)
  })
}

test('debug and production use distinct build directories and source map policies', () => {
  const debug = buildConfig({ mode: 'debug' })
  const production = buildConfig({ mode: 'production' })
  assert.equal(debug.build.outDir, 'dist-debug')
  assert.equal(debug.build.sourcemap, true)
  assert.equal(debug.build.minify, false)
  assert.equal(debug.build.cssMinify, false)
  assert.equal(production.build.outDir, 'dist')
  assert.equal(production.build.sourcemap, false)
  assert.equal(production.build.minify, true)
  assert.equal(production.build.cssMinify, true)
  assert.equal(production.build.manifest, true)
  assert.equal(production.base, '/')
  assert.equal(production.preview.proxy, production.server.proxy)
})

test('proxy overrides work outside the project working directory without leaking into client env', async () => {
  const moduleUrl = new URL('../vite.config.build.js', import.meta.url).href
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', `
    import { createBaseConfig } from ${JSON.stringify(moduleUrl)}
    const config = createBaseConfig({ mode: 'debug' })
    console.log(JSON.stringify(Object.values(config.server.proxy).map(proxy => proxy.target)))
  `], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      API_PROXY_TARGET: 'http://127.0.0.1:15158',
      ACOUSTIC_PROXY_TARGET: 'http://127.0.0.1:18081',
    },
  })
  const targets = JSON.parse(stdout)
  assert.ok(targets.includes('http://127.0.0.1:15158'))
  assert.ok(targets.includes('http://127.0.0.1:18081'))
  assert.equal(targets.some(target => target.includes('66.66.66.4')), false)

  const resolved = await resolveConfig({
    configFile: fileURLToPath(new URL('../vite.config.build.js', import.meta.url)),
    mode: 'production',
  }, 'build')
  assert.equal(resolved.env.API_PROXY_TARGET, undefined)
  assert.equal(resolved.env.ACOUSTIC_PROXY_TARGET, undefined)
  assert.equal(resolved.env.VITE_API_BASE_URL, '')
  assert.equal(resolved.env.VITE_NEW_API_BASE_URL, '')
})
