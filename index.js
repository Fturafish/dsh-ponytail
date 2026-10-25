/**
 * Ponytail for DeepSeek Harness — Host half.
 *
 * Ponytail is one prompt: the smallest change that fully solves the task, and a
 * reply that ends by naming what was skipped. This half carries it into DSH:
 *
 *   - a prompt section, so the ruleset is active for every step of a session;
 *   - `/ponytail [lite|full|ultra|off]`, the level switch, answered directly;
 *   - `/ponytail-help` and `/ponytail-gain`, one-shot reference cards;
 *   - `/ponytail-review`, `/ponytail-audit` and `/ponytail-debt`, which start a
 *     turn carrying the workflow the user asked for;
 *   - one same-origin state route that the band above the composer reads and
 *     writes. A build-free plain-JavaScript bundle cannot declare a typed
 *     `ctx.remote` namespace, so the route is the transport.
 *
 * The level is per session. A session's level lives in memory: which level the
 * user is working at is a working preference, not a durable fact about the
 * work, and the durable default belongs in this plugin's row config. Its prompt
 * section is re-registered on every change, which is what publishes
 * `system-prompt/change`, so a switch takes effect at the next step.
 *
 * This module imports nothing from `@deepseek-ai/*`. A bundle installed from a
 * directory is linked into the profile, so Node resolves its imports from that
 * directory rather than from the harness installation; a schema dependency
 * would have been the only reason to reach for one, and it is not worth a
 * plugin that cannot load. The three tunables below are therefore read from the
 * row config and documented in `cordis.patch.yml`, and validated here.
 *
 * Upstream: https://github.com/DietrichGebert/ponytail (MIT).
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const name = 'ponytail'

/** `webServer` stays optional: without a Web surface the ruleset and commands still work. */
export const inject = ['commands', 'systemPrompt']

const LEVELS = ['off', 'lite', 'full', 'ultra']

/**
 * Prompt-section name and placement. The section is deliberately one name for
 * both the global and the per-session registration, because a scoped section
 * shadows a global one of the same name — that shadowing is the per-session
 * override. 450 sits between the deployment persona (0) and the plan policy
 * (500): a behavioural ruleset, not a tool description.
 */
const SECTION = 'ponytail'
const SECTION_ORDER = 450

const STATE_PATH = '/ponytail/state'

/** Session ids are opaque strings, but never paths: keep them to safe segments. */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

/** The state body carries a level, a toggle and one action word; nothing more is accepted. */
const MAX_BODY_BYTES = 4096

/** The three workflows that need a model turn; `help` and `gain` answer directly. */
const WORKFLOWS = ['review', 'audit', 'debt']

const COMMAND_HELP =
  'Commands: /ponytail [lite|full|ultra|off], /ponytail band [on|off], ' +
  '/ponytail-review, /ponytail-audit, /ponytail-debt, /ponytail-gain, /ponytail-help'

/** Read a failure the same way everywhere. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build one user-role message, in the exact shape the message factory produces:
 * a stable identity, the role, the content blocks, and who wrote it. The user
 * typed the command, so the source is the user.
 * @param text - the instruction the turn should follow.
 * @returns a message `agent.followup` can accept.
 */
function userMessage(text) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

/**
 * The model-facing ruleset for one level, following upstream's `SKILL.md`.
 * A level is a strict superset of the one below it; `off` contributes nothing,
 * and an empty section is dropped before the prompt is rendered.
 * @param level - `off`, `lite`, `full` or `ultra`.
 * @param shortcutWord - the marker word for a deliberate shortcut.
 * @returns the section text.
 */
function ruleset(level, shortcutWord) {
  if (level === 'off') return ''
  const parts = [
    '# Ponytail — lazy senior dev mode',
    '',
    'You are a lazy senior developer. The best code is the code never written. You solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.',
  ]
  if (level === 'lite') {
    parts.push(
      '',
      '## Level: lite',
      '',
      'Build what was asked. Name the smaller option in one line and let the user pick. Do not push back on the request.',
    )
    return parts.join('\n')
  }
  parts.push(
    '',
    '## Before you write',
    '',
    'Read the task and the code it touches. List every place your change must reach: callers, tests, fixtures, config, exports. Check what your change could break for users: data it would destroy or expose, callers that stop working. That is scope. Extra features are not.',
    '',
    '## The smallest complete change',
    '',
    'Take the first option that fully works:',
    '',
    '1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line. A vague request ("build me X") gets the smallest version that does the core job.',
    '2. Already in this codebase (a helper, component, service, pattern)? Use it the way the surrounding code does.',
    '3. Standard library or a platform feature? Use it, unless the project has its own. A house component beats a native widget.',
    '4. An installed dependency? Use it. Never add a dependency for a few lines.',
    '5. Can it be one line a reader gets at a glance? One line.',
    '6. Otherwise: the minimum code that works.',
    '',
    '- Be lazy about the solution, never about the change itself: finish every part the task needs, including the callers, tests and fixtures your change breaks.',
    '- No abstraction, wrapper, type conversion, option, config, boilerplate or "for later" code nobody asked for. Keep values in the form the platform already gives you. Deletion beats addition. Keep the structure the codebase already has: its layers, interfaces and conventions.',
    '- The shortest working diff wins, once you know everything it must touch. A one-liner that needs decoding is not short.',
    '- Comment only the why the code cannot show, in one line.',
    '- Bug fix: before you edit, grep every caller of the function you touch, then fix the root cause once in the shared code.',
    '- Code you move or merge keeps its error handling and validation.',
    '- Between options of equal size, take the one that is correct on edge cases.',
    '- Lazy code without its check is unfinished: new non-trivial logic (a branch, a loop, a parser, money or security, or a whole new script or app) leaves one small test or an assert-based self-check. Trivial changes need none.',
    `- A shortcut with a known limit gets a code comment in this form: \`${shortcutWord}: <the limit>, <when to upgrade>\`.`,
    '',
    'Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.',
  )
  if (level === 'ultra') {
    parts.push(
      '',
      '## Level: ultra',
      '',
      'Also question the request: before building, push back on any part the need does not justify. Say what you would drop and why, then build what survives.',
    )
  }
  return parts.join('\n')
}

/** Workflow prompt bodies, read once from `prompts/` beside this module. */
const promptCache = new Map()

/**
 * Read one workflow prompt. A failed read is not cached, so a transient
 * filesystem error does not poison every later invocation.
 * @param key - `review`, `audit` or `debt`.
 * @returns the prompt text.
 */
async function readPrompt(key) {
  const cached = promptCache.get(key)
  if (cached !== undefined) return cached
  try {
    const text = await readFile(new URL(`./prompts/${key}.md`, import.meta.url), 'utf8')
    promptCache.set(key, text)
    return text
  } catch (error) {
    promptCache.delete(key)
    throw error
  }
}

/** Upstream's published scoreboard. Measured, never computed from a live repo. */
function gainCard() {
  const width = 20
  const bar = (share) => {
    const filled = Math.round((share / 100) * width)
    return '█'.repeat(filled) + '·'.repeat(width - filled)
  }
  const rows = [
    ['Lines of code', 47],
    ['Output tokens', 55],
    ['Cost', 74],
    ['Time', 59],
  ]
  return [
    '  ponytail gain           benchmark · 39 tasks × 5 runs · Opus 5.5',
    '',
    `  no-skill        ${bar(100)}  100%`,
    ...rows.map(([label, share]) => `  ${label.padEnd(15)} ${bar(share)}   ${share}%   ▼ ${100 - share}%`),
    '',
    '  Hidden checks passed   97%  (no-skill 96%)',
    '  Tests where the logic needs one   98%  (no-skill 68%)',
    '',
    '  Averages from the published benchmark of Ponytail 5, not from this repo:',
    '  the unbuilt version was never written, so there is no baseline to subtract here.',
    '',
    '  This repo:  /ponytail-debt   shortcuts you deferred',
    '              /ponytail-audit  what is still cuttable',
  ].join('\n')
}

/** The reference card. Stated as text, so it is one-shot and changes nothing. */
function helpCard() {
  return [
    'Ponytail — lazy senior dev mode',
    '',
    'Levels',
    '  lite    Build what was asked; name the smaller option in one line.',
    '  full    The smallest complete change, a check where the logic needs one,',
    '          and a reply that names what was skipped. Default.',
    '  ultra   Also questions the request and pushes back before building.',
    '  off     Ponytail is inactive.',
    '  The level sticks for this session until you change it.',
    '',
    'Commands',
    '  /ponytail [lite|full|ultra|off]   Set the level, or show it.',
    '  /ponytail band [on|off]           Hide or show the band. The level stays.',
    '  /ponytail-review [target]         Review a change: bugs, security, load,',
    '                                    missing tests, speed, and what to cut.',
    '  /ponytail-audit [path]            The same review for the whole repo, ranked.',
    '  /ponytail-debt [marker]           Harvest shortcut comments into a ledger.',
    '  /ponytail-gain                    Measured savings from the benchmark.',
    '  /ponytail-help                    This card.',
    '',
    'Deactivate',
    '  /ponytail off.',
    '',
    'Defaults (level, band, and the shortcut marker word) come from this',
    "plugin's `config` in the profile's cordis.patch.yml.",
    '',
    'Upstream: https://github.com/DietrichGebert/ponytail (MIT)',
  ].join('\n')
}

/** Answer a JSON request body, always with no-store. */
function send(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/** Refuse anything that did not come from this Harness page. */
function sameOrigin(request) {
  const origin = request.headers?.origin
  // A same-origin GET carries no Origin header; a cross-origin one always does.
  if (origin === undefined || origin === '') return true
  const host = request.headers?.host
  if (host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read a bounded request body as text. */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('request body is too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/**
 * Register the ruleset, the commands and the band's state route.
 * @param ctx - Host Cordis context.
 * @param config - the validated row config.
 */
export function apply(ctx, config) {
  const startLevel = LEVELS.includes(config?.level) ? config.level : 'full'
  const startBand = config?.band !== false
  const shortcutWord =
    typeof config?.shortcutWord === 'string' && config.shortcutWord.trim() !== ''
      ? config.shortcutWord.trim()
      : 'shortcut'

  /** Built once: a level's ruleset never changes while this plugin is mounted. */
  const RULES = {}
  for (const level of LEVELS) RULES[level] = ruleset(level, shortcutWord)

  /** sessionId → `{ level, band, unmount }`. */
  const states = new Map()

  /**
   * Register this session's prompt section on the agent's own scope, where it
   * shadows the global default of the same name.
   * @returns whether a live agent scope accepted it.
   */
  const mountSection = (sessionId, state) => {
    const scoped = ctx.get('agents')?.get(sessionId)?.ctx?.systemPrompt
    if (scoped === undefined || typeof scoped.section !== 'function') return false
    state.unmount = scoped.section({
      name: SECTION,
      order: SECTION_ORDER,
      text: () => RULES[state.level],
    })
    return true
  }

  const dropSection = (state) => {
    if (state.unmount === undefined) return
    const unmount = state.unmount
    state.unmount = undefined
    try {
      unmount()
    } catch {
      // The agent's own disposal already unwound its scope; nothing is left to remove.
    }
  }

  /** This session's state, created on first use and mounted when its agent is live. */
  const ensureState = (sessionId) => {
    let state = states.get(sessionId)
    if (state !== undefined) return state
    state = { level: startLevel, band: startBand, unmount: undefined }
    states.set(sessionId, state)
    mountSection(sessionId, state)
    return state
  }

  /**
   * Change one session's level. The section is replaced rather than mutated so
   * the switch is published as `system-prompt/change`; the closure alone would
   * only be read at the next assembly this session happens to perform.
   */
  const setLevel = (sessionId, state, level) => {
    state.level = level
    dropSection(state)
    mountSection(sessionId, state)
  }

  // The global default: every session gets Ponytail, including the ones whose
  // agent scope this plugin never saw, and each live session shadows it above.
  ctx.systemPrompt.section({
    name: SECTION,
    order: SECTION_ORDER,
    text: () => RULES[startLevel],
  })

  ctx.on('agent/created', ({ agent }) => {
    const state = ensureState(agent.id)
    // A level chosen before the agent existed could not mount; mount it now.
    if (state.unmount === undefined) mountSection(agent.id, state)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const state = states.get(agent.id)
    if (state === undefined) return
    dropSection(state)
    states.delete(agent.id)
  })

  // An agent's disposal unwinds its own scope, but unloading this plugin does
  // not: every registration made on another context is released here too.
  ctx.effect(
    () => () => {
      for (const state of states.values()) dropSection(state)
      states.clear()
    },
    'ponytail: scoped prompt sections',
  )

  /**
   * Start one workflow turn on `agent` with the prompt the user asked for.
   * @returns the command result to report.
   */
  const startWorkflow = async (agent, key, target) => {
    let body
    try {
      body = await readPrompt(key)
    } catch (error) {
      return { kind: 'error', text: `Ponytail could not read its ${key} prompt: ${messageOf(error)}` }
    }
    const text = target === '' ? body : `${body}\n\nTarget: ${target}`
    try {
      await agent.followup(userMessage(text))
    } catch (error) {
      return { kind: 'error', text: `Ponytail could not start the ${key} turn: ${messageOf(error)}` }
    }
    return { kind: 'success', text: `Ponytail ${key} started.` }
  }

  const describe = (state) => [
    `Ponytail: ${state.level}`,
    `Band: ${state.band ? 'on' : 'off'}`,
    '',
    COMMAND_HELP,
  ].join('\n')

  ctx.commands.register({
    name: 'ponytail',
    description: 'Set the Ponytail level, or show it',
    input: { hint: '[lite|full|ultra|off|band [on|off]]' },
    handler: (invocation) => {
      const state = ensureState(invocation.agent.id)
      const input = invocation.rawInput.trim()
      if (input === '') return { kind: 'success', text: describe(state) }

      const [head, second] = input.split(/\s+/)
      const word = head.toLowerCase()

      if (word === 'band') {
        const next = second === undefined ? undefined : second.toLowerCase()
        if (next === undefined) state.band = !state.band
        else if (next === 'on') state.band = true
        else if (next === 'off') state.band = false
        else return { kind: 'error', text: `Usage: /ponytail band [on|off]` }
        return { kind: 'success', text: `Ponytail band ${state.band ? 'on' : 'off'}.` }
      }

      if (!LEVELS.includes(word)) {
        return {
          kind: 'error',
          text: `Unknown Ponytail level "${head}". Usage: /ponytail [lite|full|ultra|off]`,
        }
      }

      setLevel(invocation.agent.id, state, word)
      return {
        kind: 'success',
        text: word === 'off' ? 'Ponytail off.' : `Ponytail level: ${word}.`,
      }
    },
  })

  ctx.commands.register({
    name: 'ponytail-review',
    description: 'Review a change like the senior dev who gets paged when it breaks',
    input: { hint: '[uncommitted|staged|branch|a target in plain words]' },
    handler: (invocation) => startWorkflow(invocation.agent, 'review', invocation.rawInput.trim()),
  })

  ctx.commands.register({
    name: 'ponytail-audit',
    description: 'Audit the whole repo the same way, ranked, most important first',
    input: { hint: '[<path>]' },
    handler: (invocation) => startWorkflow(invocation.agent, 'audit', invocation.rawInput.trim()),
  })

  ctx.commands.register({
    name: 'ponytail-debt',
    description: 'Harvest shortcut comments into a debt ledger',
    input: { hint: '[<marker word>]' },
    handler: (invocation) => startWorkflow(invocation.agent, 'debt', invocation.rawInput.trim()),
  })

  ctx.commands.register({
    name: 'ponytail-gain',
    description: "Show Ponytail's measured savings from the benchmark",
    handler: () => ({ kind: 'success', text: gainCard() }),
  })

  ctx.commands.register({
    name: 'ponytail-help',
    description: 'Quick reference for the Ponytail levels and commands',
    handler: () => ({ kind: 'success', text: helpCard() }),
  })

  const webServer = ctx.get('webServer')
  if (webServer === undefined || typeof webServer.register !== 'function') return

  /** What the band renders for one session. */
  const snapshot = (sessionId, state) => ({
    ok: true,
    sessionId,
    level: state.level,
    band: state.band,
    levels: LEVELS,
    shortcutWord,
  })

  const onState = (request, response) => {
    void (async () => {
      if (!sameOrigin(request)) {
        send(response, 403, { ok: false, code: 'untrusted-origin' })
        return
      }

      if (request.method === 'GET') {
        let sessionId
        try {
          sessionId = (new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('sessionId') ?? '').trim()
        } catch {
          sessionId = ''
        }
        if (!SESSION_ID.test(sessionId)) {
          send(response, 400, { ok: false, code: 'bad-request', message: 'sessionId is missing or malformed' })
          return
        }
        // Reading never creates state: a session whose agent has not started
        // yet reports the configured default instead of growing the map.
        send(response, 200, snapshot(sessionId, states.get(sessionId) ?? { level: startLevel, band: startBand }))
        return
      }

      if (request.method !== 'POST') {
        send(response, 405, { ok: false, code: 'method-not-allowed', message: 'only GET and POST are accepted' })
        return
      }

      let body
      try {
        body = JSON.parse(await readBody(request))
      } catch (error) {
        send(response, 400, { ok: false, code: 'bad-request', message: messageOf(error) })
        return
      }

      const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : ''
      if (!SESSION_ID.test(sessionId)) {
        send(response, 400, { ok: false, code: 'bad-request', message: 'sessionId is missing or malformed' })
        return
      }

      const state = ensureState(sessionId)

      if (body?.level !== undefined) {
        const level = typeof body.level === 'string' ? body.level.trim().toLowerCase() : ''
        if (!LEVELS.includes(level)) {
          send(response, 400, { ok: false, code: 'bad-level', message: `level must be one of ${LEVELS.join(', ')}` })
          return
        }
        setLevel(sessionId, state, level)
      }

      if (typeof body?.band === 'boolean') state.band = body.band

      if (body?.action !== undefined) {
        const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : ''
        if (!WORKFLOWS.includes(action)) {
          send(response, 400, { ok: false, code: 'bad-action', message: `action must be one of ${WORKFLOWS.join(', ')}` })
          return
        }
        const agent = ctx.get('agents')?.get(sessionId)
        if (agent === undefined) {
          send(response, 409, { ok: false, code: 'session-not-live', message: 'this session has no live agent' })
          return
        }
        const started = await startWorkflow(agent, action, '')
        if (started.kind === 'error') {
          send(response, 500, { ok: false, code: 'workflow-failed', message: started.text })
          return
        }
      }

      send(response, 200, snapshot(sessionId, state))
    })().catch((error) => {
      ctx.logger?.warn?.(`[ponytail] state route failed: ${messageOf(error)}`)
      try {
        send(response, 500, { ok: false, code: 'internal', message: messageOf(error) })
      } catch {
        // The response may already be committed; there is nothing left to say.
      }
    })
  }

  ctx.effect(
    () => webServer.register({ kind: 'exact', path: STATE_PATH, handler: onState }),
    'ponytail: state route',
  )
}
