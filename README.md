# dsh-plugin-ponytail

**Ponytail for DeepSeek Harness.** Lazy senior dev mode: the smallest change that fully solves the task, a review that reads the code your change touches rather than only the diff, and a band above the composer that shows which level the model is *actually* running at.

An unofficial DSH port of [Ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich Gebert. It ships that project's prompt as a native DSH bundle — a prompt section, six slash commands, and a Web UI band — with **no runtime dependencies and no build step**.

> 非官方 DSH 移植版，规则集来自 [Ponytail](https://github.com/DietrichGebert/ponytail)（MIT）。零依赖、无需构建。

---

## 中文快速开始

**安装**：把仓库克隆到任意目录，然后让你的 DSH 智能体执行 `plugin_manager` 的 `install_bundle`，`target` 填克隆下来的绝对路径。安装完成后刷新页面，输入框上方就会出现档位带。

**用**：

| 命令 | 作用 |
|---|---|
| `/ponytail [lite\|full\|ultra\|off]` | 切换档位，不带参数则显示当前档位 |
| `/ponytail band [on\|off]` | 显示／隐藏档位带（档位不变） |
| `/ponytail-review [目标]` | 审查一处改动：Bug、安全、负载、缺失的测试、性能、能删的代码 |
| `/ponytail-audit [路径]` | 对整个仓库做同样的审查，按重要性排序 |
| `/ponytail-debt [标记词]` | 把 `shortcut:` 注释收成一份债务账本 |
| `/ponytail-gain` | 上游基准测试的实测收益 |
| `/ponytail-help` | 速查卡 |

**改默认值**：在你自己的 `cordis.patch.yml` 里按 `id: ponytail` 覆盖 `config`（见 [Configuration](#configuration)）。

---

## What it does

### Levels

Ponytail is a prompt, and the level is how much of it is active. The whole ruleset lives in the system prompt, so it applies to every step of a session, not just the first.

| Level | What changes |
|---|---|
| `lite` | Build what was asked, and name the smaller option in one line. No push-back. |
| `full` | The ladder: does it need to exist, is it already here, does the standard library do it, is it a platform feature, is it an installed dependency, can it be one line, else the minimum that works. Plus one small test for logic with a branch, a loop, a parser, money or security. **Default.** |
| `ultra` | `full`, and it questions the request before building. |
| `off` | The section contributes nothing. |

Every active level also ends its reply with what it skipped and any risk you should know.

**Never cut, at any level:** validation at trust boundaries, error handling that prevents data loss, security, accessibility, the calibration real hardware needs, anything the user asked for.

### The band

`conversation.input.dock`, the full-width seat above the composer card, after the shipped todo/goal/queue rows. It shows the current level as a four-way toggle, plus **Review** and **Audit** buttons that run the same two workflows as the slash commands.

The band reads and writes the Host half over a same-origin HTTP route, and it re-reads the level from the Host rather than remembering it locally — so what it shows is what the prompt says. Hiding it (`/ponytail band off`) keeps the level.

### Works as a whole bundle

Nothing is a stub. Each command does the work it names:

- `review`, `audit` and `debt` read their prompt from `prompts/` and start a real turn with it, so the model follows the upstream procedure.
- `help` and `gain` answer directly, with no model turn and no cost.

---

## Install

### Requirements

- A DeepSeek Harness build that provides the `commands` and `systemPrompt` services. Both are part of the base composition.
- The band additionally needs `webServer`. Without it the plugin still activates — the ruleset and all six commands work, and only the band is absent.

Verified on a stock DSH desktop profile (Cordis 4 lineage, 2026-10 build).

### From a cloned directory *(this is the path I verified)*

```bash
git clone https://github.com/<owner>/dsh-plugin-ponytail.git
```

Then ask your DSH agent to install that directory, or use the `plugin_manager` tool directly:

```jsonc
{ "action": "install_bundle", "target": "/path/to/dsh-plugin-ponytail" }  // absolute path to the clone
```

The tool links the directory into your profile, resolves the bundle patch, and reports `application: "applied"` when it is live. Reload the Harness Web UI to pick up the band.

### From a git spec *(convenient, but I have not tested it)*

```jsonc
{ "action": "install_bundle", "target": "github:<owner>/dsh-plugin-ponytail" }
```

A directory install is verified end to end; a git spec install is not, because I had no registry or GitHub access while building this. If it fails, use the cloned-directory path above.

### Verify it loaded

Ask your agent for `plugin_manager` `list_plugins` and look for a row with `"moduleName": "dsh-plugin-ponytail"` and `"fiberPhase": "active"`. The row id is `ponytail`.

### Uninstall

```jsonc
{ "action": "remove_bundle", "target": "dsh-plugin-ponytail" }
```

---

## Commands

| Command | Input | What happens |
|---|---|---|
| `/ponytail` | `[lite\|full\|ultra\|off]` | Sets the session's level and reports it. With no argument, reports the current level, the band state and the command list. Also accepts `band`, `band on`, `band off`. |
| `/ponytail-review` | `[uncommitted\|staged\|branch\|any target]` | Starts a turn carrying `prompts/review.md`. The target is appended as `Target: …`, so `/ponytail-review staged` narrows the review. |
| `/ponytail-audit` | `[<path>]` | The same for `prompts/audit.md`, against the whole repo or the named path. |
| `/ponytail-debt` | `[<marker word>]` | The same for `prompts/debt.md`; a word replaces the default `shortcut` marker. |
| `/ponytail-gain` | — | Prints upstream's published benchmark scoreboard. Direct answer, no turn. |
| `/ponytail-help` | — | Prints the reference card. Direct answer, no turn. |

`/ponytail-gain` deliberately prints benchmark averages and never a number for *your* repo: the unbuilt version was never written, so there is no baseline to subtract from. The only real per-repo figure is `/ponytail-debt`, which counts actual markers.

---

## Configuration

The bundle patch sets the defaults. Your own `cordis.patch.yml` layer wins over it and survives package upgrades — an override by `id` replaces the whole `config`, so list every key:

```yaml
- id: ponytail
  name: dsh-plugin-ponytail
  config:
    level: ultra          # off | lite | full | ultra — the level a session starts in
    band: true            # show the band above the composer
    shortcutWord: shortcut # how a deliberate shortcut is marked in code comments
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `level` | string | `full` | The level a session starts at. |
| `band` | boolean | `true` | Whether the band starts visible. |
| `shortcutWord` | string | `shortcut` | The marker word `/ponytail-debt` looks for, and the word the ruleset tells the model to write. |

An invalid value falls back to the default rather than failing activation, so a typo cannot stop the plugin from loading.

---

## How it works

Two halves, both plain JavaScript:

- **[`index.js`](index.js) — Host.** Registers the ruleset as a `systemPrompt` section at order 450 (between the deployment persona and the plan policy), registers the six commands, and serves one same-origin state route at `/ponytail/state`.
- **[`client.js`](client.js) — Client.** Registers the band into `conversation.input.dock` at order 30, styled only from `--dsw-alias-*` theme tokens.

Three decisions worth knowing:

**The level is per session, and the band cannot lie about it.** The plugin registers one global section as the default, then a second section *on each agent's own context* whose name is the same — a scoped section shadows a global one, which is exactly the per-session override. Changing the level replaces that section, which publishes `system-prompt/change`. That is why the band asks the Host for the level instead of caching it.

**No `@deepseek-ai/*` imports.** A bundle installed from a directory is linked into the profile, so Node resolves its imports from *that* directory, not from the Harness installation. A schema dependency would have been the only reason to reach for one, and it is not worth a plugin that cannot load. So the three tunables are read from the row config and validated in `index.js`.

**The route is not an auth bypass.** It refuses any request whose `Origin` is not this Harness, validates `sessionId` against a safe-segment pattern (never a path), caps the body at 4 KB, and rejects an unknown level or action with a 400. `action` accepts only the three known workflow names, and the workflow can only ever be started on a session that already has a live agent.

### Verified behaviour

Checked on a live DSH profile, not inferred:

- The band registers as `{ id: "ponytail", order: 30, active: true }` in `conversation.input.dock`, after the shipped todo/goal/queue rows.
- `GET /ponytail/state` returns the configured defaults; a level round-trips through POST.
- **The level reaches the model.** Reading the session log's `system/message` events across one switch shows `full` → `lite` → `full` (8408 → 6183 → 8408 characters), each carrying the matching ruleset.
- The workflow path delivers end to end: firing `/ponytail-debt` at a live session produced a correct `shortcut:` debt ledger of this repo, with the boundary rules from `prompts/debt.md` applied and the `No shortcut debt. Clean ledger.` footer.
- A malformed `sessionId`, an unknown level and an unknown action are each rejected with a 400.

---

## Privacy

The plugin makes **no network requests off your machine**. No telemetry, no analytics, no update check.

- [`index.js`](index.js) opens no outbound connection. It reads only its own `prompts/` files and calls DSH services, and it registers one *inbound* route.
- [`client.js`](client.js) performs two `fetch` calls, both to the relative path `/ponytail/state` — same origin, this Harness only — carrying `{ sessionId, level, band, action }` and nothing else.
- That route refuses a cross-origin request and validates every field, so it cannot be turned into a local data proxy.
- No dependencies, so there is no transitive supply chain either.

One limit worth knowing: that route carries no separate credential. It answers without the token the Harness page itself requires, so any process already running on this machine could set a Ponytail level or start one of the three read-only report workflows on a live session. It cannot read your data, delete anything, or reach the network, and this is how plugin routes work in this Harness — but if you want it closed, add your own token check to the route in `index.js`.

The review, audit and debt workflows do read your repository — that is their job — but they do it through the agent's own file tools, under your normal permission and sandbox policy. The plugin itself never reads your source, your session logs, or your credentials.

---

## Limits

- **The level lives in memory.** Restarting returns every session to the configured default. That is deliberate — which level you are working at is a working preference, not a durable fact about the work.
- **Not implemented from upstream:** the band's cost/token/reuse/test metrics (DSH does not expose them to a dependency-free plugin); `stop ponytail` / `normal mode` as natural-language deactivation (use `/ponytail off` — a deterministic command beats phrase matching); and the band's copy-as-Markdown and fold-to-one-line buttons.
- **No `Config` schema.** Tuning works through `cordis.patch.yml` as documented above, but the Plugins settings page cannot render a form for this row. See "No `@deepseek-ai/*` imports" for why.
- **Unofficial.** Not affiliated with Dietrich Gebert or DeepSeek. Behaviour can change if DSH changes its service surface — the plugin depends on `commands`, `systemPrompt`, `agents` and `webServer` and on the `conversation.input.dock` slot.

---

## Credits

- **[Ponytail](https://github.com/DietrichGebert/ponytail)** by Dietrich Gebert — the ruleset, the level design, and the review/audit/debt/gain workflows. MIT.
- The [DSH plugin skill](https://github.com/deepseek-ai/deepseek-harness) references for the bundle, slot and prompt-section contracts.

## License

[MIT](LICENSE). The prompt text is derived from Ponytail and retains its copyright notice, as that license requires.

---

## Publishing checklist

This repo is ready to push. Before you do, replace the placeholders:

1. `<owner>` in the two install snippets above, and add a `repository` field to [`package.json`](package.json).
2. `Copyright (c) 2026 dsh-plugin-ponytail contributors` in [`LICENSE`](LICENSE) with your name.

Then:

```bash
git init && git add . && git commit -m "dsh-plugin-ponytail 1.0.0"
git remote add origin https://github.com/<owner>/dsh-plugin-ponytail.git
git push -u origin main
```
