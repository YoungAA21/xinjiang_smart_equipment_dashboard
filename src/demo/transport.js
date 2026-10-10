import { demoResponse } from './data.js'

function waitForDemo(delayMs, signal) {
  signal?.throwIfAborted()
  if (!delayMs) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve() }, delayMs)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

export function createDemoFetch(originalFetch, { baseUrl, delayMs = 120 } = {}) {
  return async (input, options = {}) => {
    const inputUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url
    const url = new URL(inputUrl, baseUrl)
    const path = url.pathname.replace(/^\/_\w+-api/, '')
    if (!/^\/(api|auth|monitor|alarm|collectorManagement|recordings)(\/|$)/.test(path)) return originalFetch(input, options)
    const request = new Request(input instanceof Request ? input : url, options)
    await waitForDemo(delayMs, request.signal)
    const query = Object.fromEntries(url.searchParams)
    try {
      const text = ['GET', 'HEAD'].includes(request.method) ? '' : await request.text()
      const body = !text ? {} : request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(text)) : JSON.parse(text)
      request.signal.throwIfAborted()
      const data = demoResponse(path, { ...query, ...body })
      return Response.json(path.startsWith('/api/') ? data : { code: 200, success: true, data })
    } catch (error) {
      if (request.signal.aborted) throw request.signal.reason
      // Unsupported business routes remain local errors; never contact the backend.
      return Response.json({ message: error.message }, { status: 404 })
    }
  }
}
