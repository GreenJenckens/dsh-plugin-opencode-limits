// Offline check of the host half: a local HTTP server stands in for the
// OpenCode usage endpoint, and a fake Cordis context provides the route seat.
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const plugin = await import(pathToFileURL(resolve(here, '../lib/index.js')).href)

const USAGE = {
  usage: {
    rolling: { status: 'ok', percent: 9, resetsAt: '2026-11-04T00:49:21.000Z' },
    weekly: { status: 'ok', percent: 16, resetsAt: '2026-11-09T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 8, resetsAt: '2026-12-02T20:04:56.000Z' },
  },
}

let authorisedHits = 0
const server = createServer((req, res) => {
  if (req.url === '/usage') {
    authorisedHits += 1
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(USAGE))
    return
  }
  if (req.url === '/unauthorised') {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { type: 'authentication_error', code: 'api_key_expired', message: 'Unauthorized' } }))
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`

let failures = 0
const check = (name, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures += 1
  console.error(`  FAIL ${name}${detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`)
}

/** Build a plugin instance over a fake context and return its registered route. */
function mount(config, key) {
  process.env.OPENCODE_LIMITS_TEST_KEY = key
  const routes = []
  const effects = []
  const ctx = {
    get: () => undefined,
    effect: (fn, label) => {
      effects.push({ label, disposable: fn() })
      return () => {}
    },
    webServer: {
      register: (route) => {
        routes.push(route)
        return () => {}
      },
    },
  }
  plugin.apply(ctx, { keyEnv: 'OPENCODE_LIMITS_TEST_KEY', timeoutMs: 4000, ...config })
  return { route: routes[0], routes, effects }
}

/** Call the route the way the host's HTTP server would. */
function call(route, { method = 'GET', url = '/x/opencode-limits', remoteAddress = '127.0.0.1' } = {}) {
  return new Promise((done, fail) => {
    const timer = setTimeout(() => fail(new Error('route did not answer')), 10000)
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value
      },
      end(body) {
        clearTimeout(timer)
        done({ status: this.statusCode, headers: this.headers, body: body === undefined ? undefined : String(body) })
      },
    }
    route.handler({ method, url, socket: { remoteAddress } }, res)
  })
}

console.log('host half')
const ok = mount({ usageUrl: `${origin}/usage` }, 'test-key')
check('registers one exact route', ok.routes.length === 1 && ok.route.path === '/x/opencode-limits', ok.routes.map((r) => r.path))
await new Promise((done) => setTimeout(done, 300))
const first = await call(ok.route)
const payload = JSON.parse(first.body)
check('answers 200', first.status === 200, first.status)
check('reports ok', payload.ok === true, payload)
check('carries three windows', ['rolling', 'weekly', 'monthly'].every((key) => payload.usage[key]), Object.keys(payload.usage || {}))
check('reports the key source', payload.keySource === 'env', payload.keySource)
check('serves no-store', first.headers['cache-control'] === 'no-store', first.headers)

const beforeForce = authorisedHits
await call(ok.route, { url: '/x/opencode-limits?refresh=1' })
check('refresh=1 bypasses the cache', authorisedHits === beforeForce + 1, { beforeForce, after: authorisedHits })

const forbidden = await call(ok.route, { remoteAddress: '10.1.2.3' })
check('refuses a non-loopback peer', forbidden.status === 403, forbidden.status)
const wrongMethod = await call(ok.route, { method: 'POST' })
check('refuses a non-GET method', wrongMethod.status === 405, wrongMethod.status)
const head = await call(ok.route, { method: 'HEAD' })
check('answers HEAD without a body', head.status === 200 && head.body === undefined, head)

const expired = mount({ usageUrl: `${origin}/unauthorised` }, 'test-key')
await new Promise((done) => setTimeout(done, 300))
const failed = await call(expired.route)
const failedPayload = JSON.parse(failed.body)
check('surfaces an auth failure', failedPayload.ok === false && /api_key_expired/.test(failedPayload.error || ''), failedPayload.error)

const missing = mount({ usageUrl: `${origin}/usage` }, '')
const noKey = await call(missing.route)
check('surfaces a missing key', JSON.parse(noKey.body).error.includes('OPENCODE_LIMITS_TEST_KEY'), JSON.parse(noKey.body).error)

for (const mounted of [ok, expired, missing]) {
  for (const effect of mounted.effects) if (typeof effect.disposable === 'function') effect.disposable()
}
server.close()
delete process.env.OPENCODE_LIMITS_TEST_KEY

console.log(failures === 0 ? 'PASS host half' : `FAILED ${failures} check(s)`)
process.exit(failures === 0 ? 0 : 1)
