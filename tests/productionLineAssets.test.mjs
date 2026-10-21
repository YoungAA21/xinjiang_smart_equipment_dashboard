import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'

test('Vite serves all production plan raw imports as SVG modules without public asset warnings', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const component = new URL('../src/components/SiteProductionLinePlan.vue', import.meta.url)
  const source = await readFile(component, 'utf8')
  const imports = [...source.matchAll(/import \w+ from '([^']+\.svg\?raw)'/g)]
  assert.equal(imports.length, 3)
  const warnings = []
  const server = await createServer({ root, configFile: false, envDir: false, plugins: [vue()],
    server: { middlewareMode: true, watch: null }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    customLogger: { info() {}, warn(message) { warnings.push(message) }, warnOnce(message) { warnings.push(message) }, error() {}, clearScreen() {}, hasErrorLogged() { return false }, hasWarned: false },
  })
  try {
    await server.transformRequest('/src/components/SiteProductionLinePlan.vue')
    for (const [, specifier] of imports) {
      const asset = new URL(specifier, component)
      const url = '/' + relative(root, fileURLToPath(asset)).replaceAll('\\', '/') + asset.search
      const result = await server.transformRequest(url)
      assert.ok(result?.code.includes('<svg'), `${specifier} exports inline SVG markup`)
      assert.ok(result.code.includes('data-machine'), 'interactive machine links remain inline')
      const chunks = []
      const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { chunks.push(chunk); callback() } })
      const request = new IncomingMessage(socket)
      request.url = `${url}&import`
      request.method = 'GET'
      request.headers = {}
      const response = new ServerResponse(request)
      response.assignSocket(socket)
      await new Promise((resolve, reject) => {
        response.on('finish', resolve)
        server.middlewares(request, response, error => reject(error || new Error('Asset middleware did not handle the import')))
      })
      assert.equal(response.statusCode, 200)
      assert.ok(Buffer.concat(chunks).toString().includes('<svg'))
      socket.destroy()
    }
    assert.deepEqual(warnings, [])
  } finally {
    await server.close()
  }
})
