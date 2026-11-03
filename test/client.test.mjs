// Offline check of the client half: the bundle format, the composer-dock
// registration and the rendered tree, with a minimal React stand-in.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../lib/client.js'), 'utf8')
const SLOT = 'conversation.composer.dock'

let registration
globalThis.document = {
  baseURI: 'http://127.0.0.1:57060/',
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window = { __ModuleLoader__: { load: (value) => (registration = value) } }
globalThis.fetch = async () => {
  throw new Error('fetch must not run in the static render test')
}

new Function(source)()

let failures = 0
const check = (name, condition, detail) => {
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures += 1
  console.error(`  FAIL ${name}${detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`)
}

// ---- a minimal React stand-in ----------------------------------------------
let stateQueue = []
let stateIndex = 0
const react = {
  createElement(type, props, ...children) {
    if (typeof type === 'function') return { __component: type, props: { ...(props || {}) } }
    const merged = { ...(props || {}) }
    if (children.length > 0) merged.children = children.length === 1 ? children[0] : children
    return { type, props: merged }
  },
  useState(initial) {
    const value = stateIndex < stateQueue.length ? stateQueue[stateIndex] : typeof initial === 'function' ? initial() : initial
    stateIndex += 1
    return [value, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useRef(initial) {
    return { current: initial }
  },
  Fragment: 'fragment',
}

console.log('client half')
check('bundle registers its module id', registration?.id === 'dsh-plugin-opencode-limits', registration?.id)

const clientExports = registration.factory((id) => {
  if (id === 'react') return react
  throw new Error('unexpected require ' + id)
})
check('exports apply/inject', typeof clientExports.apply === 'function' && JSON.stringify(clientExports.inject) === '["slots"]', Object.keys(clientExports))

const registrations = []
let injectedSlot
clientExports.apply({
  slots: {
    inject(name, factory) {
      injectedSlot = name
      return factory()
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
})
check('registers into the composer dock', injectedSlot === SLOT && registrations[0]?.options.id === 'opencode-limits', registrations[0]?.options)
check('sits after the harness pills', registrations[0]?.options.order === 2, registrations[0]?.options.order)

const meter = (percent, status, offsetMs) => ({ percent, status, resetsAt: new Date(Date.now() + offsetMs).toISOString() })
const okState = {
  phase: 'ok',
  data: {
    ok: true,
    fetchedAt: new Date().toISOString(),
    keySource: 'store:local',
    usage: {
      rolling: meter(1, 'ok', 3600_000),
      weekly: meter(12, 'ok', 3 * 86_400_000),
      monthly: meter(96, 'rate-limited', 20 * 86_400_000),
    },
  },
}

function render(state) {
  stateIndex = 0
  stateQueue = [state, Date.now(), false, false]
  const texts = []
  const colours = []
  const walk = (node) => {
    if (node === null || node === undefined || node === false) return
    if (typeof node === 'string' || typeof node === 'number') {
      texts.push(String(node))
      return
    }
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node.__component) {
      walk(node.__component(node.props))
      return
    }
    if (node.props) {
      const style = node.props.style
      if (style && typeof style === 'object') {
        if (style.color) colours.push(style.color)
        if (style.background) colours.push(style.background)
      }
      walk(node.props.children)
    }
  }
  walk(registrations[0].component({}))
  return { line: texts.join('').replace(/\s+/g, ' ').trim(), colours }
}

const ok = render(okState)
console.log('  rendered:', ok.line)
check('renders the provider name', ok.line.includes('OpenCode'))
check('renders free share per window', ok.line.includes('5ч 99%') && ok.line.includes('нед 88%'), ok.line)
check('renders an exhausted window as a word', ok.line.includes('лимит'), ok.line)
check('marks the exhausted window with the error token', ok.colours.includes('var(--dsw-alias-label-error)'), ok.colours)
check('uses no raw colours', !ok.colours.some((colour) => /#[0-9a-f]{3,8}/i.test(colour)), ok.colours)

const loading = render({ phase: 'loading' })
check('renders the loading state', loading.line.includes('загружаю'), loading.line)
const failed = render({ phase: 'error', error: 'HTTP 401' })
check('renders the error state', failed.line.includes('нет данных') && failed.line.includes('HTTP 401'), failed.line)

console.log(failures === 0 ? 'PASS client half' : `FAILED ${failures} check(s)`)
process.exit(failures === 0 ? 0 : 1)
