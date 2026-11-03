/**
 * OpenCode Go usage limits — host half.
 *
 * Polls the OpenCode Go subscription usage endpoint with the API key already
 * stored for the `opencode-go` LLM provider and serves the result to the Web
 * client over one small named HTTP route. The client half (lib/client.js)
 * renders it as a strip in the shell's bottom slot.
 *
 * The key is resolved per request from the credential store, so rotating it
 * takes effect without a restart.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'opencode-limits'

/** The route needs the Web server; a composition without one loads no limits. */
export const inject = ['webServer']

const DEFAULTS = {
  usageUrl: 'https://opencode.ai/zen/go/v1/usage',
  routePath: '/x/opencode-limits',
  keyEnv: 'OPENCODE_GO_API_KEY',
  refreshMs: 20000,
  timeoutMs: 15000,
}

/** Read one credential value out of the local store file as a last resort. */
function keyFromStoreFile(keyName) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const file = join(home, '.credentials.yaml')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
  // `refs:` is a flat name -> value map; match the line that names the key.
  const re = new RegExp(String.raw`^\s*${keyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*:\s*(.+?)\s*$`, 'm')
  const hit = re.exec(text)
  if (!hit) return undefined
  let value = hit[1]
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  return value.length > 0 ? value : undefined
}

/** Resolve the OpenCode key: launching environment, then store, then store file. */
async function resolveKey(ctx, keyName) {
  const fromEnv = process.env[keyName]
  if (fromEnv && fromEnv.trim()) return { key: fromEnv.trim(), source: 'env' }

  const credentials = ctx.get('credentials')
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(keyName)
      if (hit && typeof hit.value === 'string' && hit.value.trim()) {
        return { key: hit.value.trim(), source: `store:${hit.source || 'local'}` }
      }
    } catch {
      // Fall through to the file; a missing store is not a plugin failure.
    }
  }

  const fromFile = keyFromStoreFile(keyName)
  if (fromFile) return { key: fromFile, source: 'file' }
  return undefined
}

/** Turn an OpenCode error envelope into one readable line. */
function errorText(json, status) {
  const err = json && (json.error || json)
  if (err && typeof err === 'object') {
    const code = typeof err.code === 'string' ? err.code : undefined
    const message = typeof err.message === 'string' ? err.message : undefined
    if (message && code) return `${code}: ${message}`
    if (message) return message
    if (code) return code
  }
  if (typeof err === 'string' && err) return err
  return `HTTP ${status}`
}

/** GET the usage document; never throws. */
async function fetchUsage(apiKey, usageUrl, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(usageUrl, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: controller.signal,
    })
    const text = await response.text()
    let json
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    if (!response.ok) {
      return { ok: false, status: response.status, error: errorText(json, response.status) }
    }
    if (!json || typeof json !== 'object' || !json.usage || typeof json.usage !== 'object') {
      return { ok: false, status: response.status, error: 'unexpected usage response' }
    }
    return { ok: true, status: response.status, usage: json.usage }
  } catch (error) {
    const message = String((error && error.message) || error)
    return { ok: false, status: 0, error: message === 'This operation was aborted' ? 'timeout' : message }
  } finally {
    clearTimeout(timer)
  }
}

/** Keep the last good document so a transient failure never blanks the strip. */
function createState() {
  return {
    ok: false,
    usage: undefined,
    error: undefined,
    fetchedAt: undefined,
    keySource: undefined,
    inflight: undefined,
    lastAttemptAt: 0,
    hits: 0,
    lastHitAt: 0,
  }
}

export function apply(ctx, config) {
  const settings = { ...DEFAULTS, ...(config && typeof config === 'object' ? config : {}) }
  const state = createState()

  const refresh = () => {
    if (state.inflight) return state.inflight
    const run = (async () => {
      state.lastAttemptAt = Date.now()
      const resolved = await resolveKey(ctx, settings.keyEnv)
      if (!resolved) {
        state.error = `ключ ${settings.keyEnv} не найден`
        state.keySource = undefined
        return
      }
      state.keySource = resolved.source
      const result = await fetchUsage(resolved.key, settings.usageUrl, settings.timeoutMs)
      if (result.ok) {
        state.ok = true
        state.usage = result.usage
        state.error = undefined
        state.status = undefined
        state.fetchedAt = new Date().toISOString()
      } else {
        state.ok = false
        state.error = result.error
        state.status = result.status
      }
    })()
      .catch((error) => {
        state.ok = false
        state.error = String((error && error.message) || error)
      })
      .finally(() => {
        state.inflight = undefined
      })
    state.inflight = run
    return run
  }

  const snapshot = () => ({
    ok: state.ok,
    usage: state.usage,
    error: state.error,
    status: state.status,
    fetchedAt: state.fetchedAt,
    keySource: state.keySource,
    refreshMs: settings.refreshMs,
    hits: state.hits,
    lastHitAt: state.lastHitAt ? new Date(state.lastHitAt).toISOString() : undefined,
  })

  ctx.effect(() => {
    let timer
    let stopped = false
    const tick = () => {
      void refresh().then(() => {
        if (!stopped) timer = setTimeout(tick, Math.max(5000, settings.refreshMs))
      })
    }
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, 'opencode-limits: poll')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: settings.routePath,
        handler: (req, res) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.statusCode = 405
            res.setHeader('allow', 'GET, HEAD')
            res.end()
            return
          }
          // The route is unauthenticated by design, so it answers loopback peers only.
          const peer = (req.socket && req.socket.remoteAddress) || ''
          const loopback = peer === '::1' || peer === '::ffff:127.0.0.1' || peer.startsWith('127.')
          if (!loopback) {
            res.statusCode = 403
            res.end('forbidden')
            return
          }
          // A visitor triggers a refresh when the cached document is old; `?refresh=1`
          // forces one (the pill's click).
          state.hits += 1
          state.lastHitAt = Date.now()
          let force = false
          try {
            force = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1'
          } catch {
            force = false
          }
          const stale =
            force ||
            !state.ok ||
            !state.lastAttemptAt ||
            Date.now() - state.lastAttemptAt > Math.max(5000, settings.refreshMs / 2)
          const respond = () => {
            const body = JSON.stringify(snapshot())
            res.statusCode = 200
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('cache-control', 'no-store')
            res.end(req.method === 'HEAD' ? undefined : body)
          }
          if (stale) {
            void refresh().then(respond, respond)
          } else {
            respond()
          }
        },
      }),
    `opencode-limits: ${settings.routePath} route`,
  )
}
