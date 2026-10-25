/**
 * Ponytail for DeepSeek Harness — Client half.
 *
 * Draws the band above the composer, in the one seat that allocates space there
 * (`conversation.input.dock`, scoped to the session, after the shipped todo,
 * goal and queue rows). Upstream draws the same band above the prompt in Claude
 * Code; here it carries what this harness can act on: the current level, and
 * the two workflow buttons.
 *
 * The band reads and writes the Host half over its same-origin state route,
 * because a build-free plain-JavaScript bundle cannot declare a typed
 * `ctx.remote` namespace. Every level button is a shortcut for the literal
 * command argument, so the labels stay `lite`/`full`/`ultra`/`off`; only the
 * surrounding words are localized.
 *
 * The package imports no Harness Client package: the band is local markup
 * styled from theme tokens, so a renamed token degrades its appearance without
 * breaking the render.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-ponytail',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useState } = React

    const NS = 'dsh-ponytail'
    const STATE_PATH = '/ponytail/state'

    const DICT = {
      zh: {
        'band.level': 'Ponytail 档位',
        'band.review': '审查',
        'band.audit': '体检',
        'band.review.hint': '审查当前改动：Bug、安全、负载、缺失的测试、性能，以及能删掉的代码',
        'band.audit.hint': '对整个仓库做同样的体检，按重要性排序',
        'band.failed': '切换失败',
        'level.lite.hint': '只做被要求的事，用一行点出更小的选项',
        'level.full.hint': '用最小的完整改动解决问题（默认）',
        'level.ultra.hint': '先质疑需求，再动手',
        'level.off.hint': '关闭 Ponytail',
      },
      en: {
        'band.level': 'Ponytail level',
        'band.review': 'Review',
        'band.audit': 'Audit',
        'band.review.hint': 'Review the change: bugs, security, load, missing tests, speed, and what to cut',
        'band.audit.hint': 'The same review for the whole repo, ranked',
        'band.failed': 'Switch failed',
        'level.lite.hint': 'Build what was asked; name the smaller option in one line',
        'level.full.hint': 'The smallest complete change (default)',
        'level.ultra.hint': 'Question the request before building',
        'level.off.hint': 'Turn Ponytail off',
      },
    }

    /** Translate through the registered locale when there is one, else English. */
    let translate = null
    function t(key) {
      if (translate !== null) {
        try {
          const value = translate(key)
          if (typeof value === 'string' && value !== '') return value
        } catch {
          // A missing key falls through to the local table below.
        }
      }
      return DICT.en[key] ?? key
    }

    const CSS = `
.ptb-band{display:flex;align-items:center;gap:8px;padding:0 2px 6px;font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary)}
.ptb-name{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:var(--dsw-alias-label-primary)}
.ptb-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.ptb-name.ptb-off .ptb-dot{background:var(--dsw-alias-state-idle-primary)}
.ptb-group{display:inline-flex;align-items:center;gap:2px;padding:1px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px}
.ptb-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:1.5;padding:2px 8px;border-radius:999px;cursor:pointer}
.ptb-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.ptb-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.ptb-btn[aria-pressed="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.ptb-btn:disabled{opacity:.5;cursor:default}
.ptb-spacer{flex:1}
.ptb-error{color:var(--dsw-alias-state-error-primary);font-size:11px}
`

    /** Read one session's band state. */
    async function readState(sessionId, signal) {
      const response = await fetch(`${STATE_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
        signal,
        headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`ponytail state: ${response.status}`)
      return await response.json()
    }

    /** Apply a level, a band toggle or one workflow action. */
    async function writeState(sessionId, patch) {
      const response = await fetch(STATE_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sessionId, ...patch }),
      })
      const value = await response.json().catch(() => null)
      if (value === null || value.ok !== true) {
        throw new Error(typeof value?.message === 'string' ? value.message : `ponytail state: ${response.status}`)
      }
      return value
    }

    /**
     * The band itself. It renders nothing until it knows the level, and nothing
     * at all while the user has it hidden: a band that cannot reach its Host
     * half must not leave an empty row behind.
     */
    function Band({ sessionId }) {
      const [state, setState] = useState(null)
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState(false)

      useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        const controller = new AbortController()
        let live = true
        readState(sessionId, controller.signal)
          .then((value) => {
            if (live) setState(value)
          })
          .catch(() => {
            if (live) setState(null)
          })
        return () => {
          live = false
          controller.abort()
        }
      }, [sessionId])

      const apply = useCallback(
        (patch) => {
          if (typeof sessionId !== 'string' || sessionId === '') return
          setBusy(true)
          setFailed(false)
          writeState(sessionId, patch)
            .then((value) => setState(value))
            .catch(() => setFailed(true))
            .finally(() => setBusy(false))
        },
        [sessionId],
      )

      if (state === null || state.band === false) return null

      const levels = Array.isArray(state.levels) ? state.levels : ['off', 'lite', 'full', 'ultra']
      const button = (key, label, patch, hint, pressed) =>
        h(
          'button',
          {
            key,
            type: 'button',
            className: 'ptb-btn',
            disabled: busy,
            title: t(hint),
            ...(pressed === undefined ? {} : { 'aria-pressed': pressed }),
            onClick: () => apply(patch),
          },
          label,
        )

      return h(
        'div',
        { className: 'ptb-band' },
        h('style', { key: 'style' }, CSS),
        h(
          'span',
          { key: 'name', className: state.level === 'off' ? 'ptb-name ptb-off' : 'ptb-name' },
          h('span', { className: 'ptb-dot', 'aria-hidden': true }),
          'Ponytail',
        ),
        h(
          'span',
          { key: 'levels', className: 'ptb-group', role: 'group', 'aria-label': t('band.level') },
          levels.map((level) => button(level, level, { level }, `level.${level}.hint`, state.level === level)),
        ),
        h('span', { key: 'spacer', className: 'ptb-spacer' }),
        failed ? h('span', { key: 'failed', className: 'ptb-error' }, t('band.failed')) : null,
        button('review', t('band.review'), { action: 'review' }, 'band.review.hint'),
        button('audit', t('band.audit'), { action: 'audit' }, 'band.audit.hint'),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale !== undefined && typeof locale.register === 'function' && typeof locale.bind === 'function') {
          ctx.effect(() => locale.register(NS, DICT), 'dsh-ponytail: locale')
          translate = locale.bind(NS)
        }
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register({ name: 'conversation.input.dock', id: 'ponytail', order: 30, locale: NS }, Band),
        )
      },
    }
  },
})
