import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('documented collection configuration sends latest through the original 5158 proxy', async () => {
  const env = Object.fromEntries((await readFile(new URL('../.env.development', import.meta.url), 'utf8')).split(/\r?\n/).filter(line => /^VITE_\w+=/.test(line)).map(line => { const index = line.indexOf('='); return [line.slice(0,index),line.slice(index+1).trim()] }))
  const calls = []
  const context = vm.createContext({ URLSearchParams, AbortSignal, process: { cwd: () => '' }, fetch: async url => {
    calls.push(url)
    return { ok:true, json:async()=>url === '/_telemetry-api/api/realtime/latest' ? [] : {success:false,code:404,message:'Not Found',data:null} }
  } })
  const endpoints = new vm.SourceTextModule(await readFile(new URL('../src/services/endpoints.js',import.meta.url),'utf8'),{context})
  await endpoints.link(()=>{throw Error('Unexpected dependency')})
  const transport = new vm.SourceTextModule(await readFile(new URL('../src/services/telemetry.js',import.meta.url),'utf8'),{context,initializeImportMeta(meta){meta.env={...env,DEV:true}}})
  await transport.link(()=>endpoints);await transport.evaluate()
  const latest=await transport.namespace.telemetryApi.getLatest()
  assert.ok(Array.isArray(latest),'latest was routed to the gateway business-404 envelope')
  assert.equal(calls[0],'/_telemetry-api/api/realtime/latest')
  const { default: config } = await import('../vite.config.build.js')
  const proxies=config({mode:'development'}).server.proxy
  const key=Object.keys(proxies).find(key=>new RegExp(key).test(calls[0]))
  assert.ok(key.startsWith('^/_'))
  assert.equal(proxies[key].target,'http://66.66.66.4:5158')
  assert.equal(proxies[key].rewrite(calls[0]),'/api/realtime/latest')
})
