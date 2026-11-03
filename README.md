# OpenCode Go Limits for DeepSeek Harness

Remaining **OpenCode Go** subscription quota, rendered as a native stat pill in DeepSeek Harness —
in the composer dock, next to the harness's own steps, decode speed, token total and cache hit.

![The limits pill inside the DeepSeek Harness composer](docs/hero.png)

The pill itself, up close — `OpenCode` followed by one ring per window (5 hours, weekly, monthly),
the arc showing how much of that window is still available:

![Close-up of the limits pill](docs/pill.png)

## What it shows

OpenCode Go limits are monthly dollar amounts per model, split into three windows: **5 hours** (20 % of
the monthly limit), **weekly** (50 %) and **monthly** (100 %). The plugin reads OpenCode's own usage
endpoint and shows what is left in each window:

| pill segment | meaning |
|---|---|
| `5ч 87%` | 87 % of the 5-hour window is still available |
| `нед 83%` | 83 % of the weekly window |
| `мес 92%` | 92 % of the monthly window |

Each segment has the same ring the harness's context meter uses (`svg 14×14`, `circle r=5.5`,
`stroke-width: 2`, track `--dsw-alias-border-l3`, round-capped arc, twelve-o'clock start). The arc is
the **remaining** share: a full ring means plenty of budget, a shrinking one means the window is
running out, and an exhausted window shows an empty track plus the word «лимит».

Hovering a segment shows the exact reset moment and the time left; hovering the pill shows where the
key came from, when the data was fetched, and that a click refreshes. Click the pill to force a
refresh. While everything is comfortably below its limit the pill stays monochrome like its
neighbours; at ≥85 % spent the arc and number take `--dsw-alias-state-warn-label`, at ≥95 % or
`status: "rate-limited"` they take `--dsw-alias-label-error`.

Data source: `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer oc_sk_…`.
The API reports percentages and reset times only — no dollar balance exists in any public endpoint.

## Install

### From the plugin market (recommended)

DSH ships the market as an optional experimental bundle. Turn on **Plugins → Experimental plugins →
Custom plugin markets**, open **Discover**, choose **Add index source**, and paste:

```
https://cdn.jsdelivr.net/gh/GreenJenckens/dsh-plugin-opencode-limits@main/market/index.json
```

Then install the plugin from its card (the confirmation shows the Git source and commit).

### As a bundle spec

On **Plugins → Installed → Install bundle**, pass the Git spec, or use the CLI:

```sh
dsh plugin --profile desktop install "git+https://github.com/GreenJenckens/dsh-plugin-opencode-limits.git#<commit>"
```

### From a local checkout

```sh
git clone https://github.com/GreenJenckens/dsh-plugin-opencode-limits.git
```

Then add the package to your profile as a linked bundle — `dependencies` gets
`"dsh-plugin-opencode-limits": "link:<absolute path>"`, `dsh.profile.bundles` gets the package name,
and the package's own patch inserts the row. The Plugins page can do the same for you.

## Configure

Defaults live in `lib/index.js`; override them in the profile patch:

```yaml
- id: opencode-limits
  name: dsh-plugin-opencode-limits
  config:
    usageUrl: https://opencode.ai/zen/go/v1/usage
    routePath: /x/opencode-limits
    keyEnv: OPENCODE_GO_API_KEY
    refreshMs: 20000
    timeoutMs: 15000
```

| field | default | meaning |
|---|---|---|
| `usageUrl` | `https://opencode.ai/zen/go/v1/usage` | usage endpoint |
| `routePath` | `/x/opencode-limits` | route the host half serves |
| `keyEnv` | `OPENCODE_GO_API_KEY` | key name in the environment / credential store |
| `refreshMs` | `20000` | how often the host half asks OpenCode |
| `timeoutMs` | `15000` | one request's deadline |

## Where the key comes from

The key is resolved on **every** poll, in this order: `process.env[keyEnv]`, then
`ctx.credentials.resolve(keyEnv)` (the DSH credential store), then the `refs:` section of
`$DSH_HOME/.credentials.yaml`. Rotating the key needs no restart.

**The key never reaches the browser.** The host half holds it, calls OpenCode, and serves only
percentages and reset times over `/x/opencode-limits`; that route answers loopback peers only and is
never proxied to the model. The plugin writes nothing to disk and sends nothing anywhere else.

## Freshness

| link | period |
|---|---|
| host half asks OpenCode | 20 s (independent of the window state) |
| client asks the host | 15 s while the window is active, immediately on visibility change |
| click on the pill | right away (`?refresh=1`) |

Chromium throttles timers of a hidden or occluded window, which is why the polling lives in the host
process: returning to the window shows data no older than about twenty seconds. The percentages
themselves move slowly — they are shares of a monthly allowance.

## Debug

```sh
curl -s http://127.0.0.1:<port>/x/opencode-limits              # cached, refreshed when stale
curl -s "http://127.0.0.1:<port>/x/opencode-limits?refresh=1"  # ask OpenCode now
```

The JSON carries `ok`, `usage` (three windows), `error`, `status`, `fetchedAt`, `keySource`
(`env` / `store:…` / `file`), `refreshMs`, and `hits` / `lastHitAt` diagnostics.

## Development

```sh
node test/host.test.mjs     # host half against a local stand-in for the usage endpoint
node test/client.test.mjs   # bundle format, dock registration, rendered tree
```

Both suites are offline. While developing against a running app, editing the files of a linked package
and touching the profile's `cordis.patch.yml` makes HMR recompose without a restart; the client bundle
is picked up on the fly.

## Limitations

* The pill lives in the composer dock, so it appears in a conversation with an open session — not on
  service pages without a composer.
* Only percentages and reset times are shown: no public endpoint exposes a dollar balance.
* If OpenCode changes the response of `/v1/usage`, the pill reports «нет данных (…)» instead of failing
  the interface.

## Releasing a new version

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Commit, tag `vX.Y.Z`, push the branch and the tag.
3. Add the tag's commit to `market/index.json` (`versions[]`, `publishTimestamp` = commit time, and
   `"source": { "type": "npm" }` once the package is on npm), validate it with
   `@deepseek-ai/dsh-plugin-market-index`, then push.
4. `npm publish --access public` when a registry token is available; the market keeps working from the
   Git source in the meantime.

## License

MIT — see [LICENSE](LICENSE).

---

## По-русски

Остатки лимитов подписки **OpenCode Go** в строке статистики композера: `OpenCode ◔ 5ч 87% · ◔ нед 83% · ◔ мес 92%`.
Кольцо — та же геометрия, что у индикатора контекста; дуга показывает **остаток** окна, при исчерпании
пишется «лимит». Наведение на сегмент — время сброса, клик по плашке — принудительное обновление.

Установка: включить **Plugins → Experimental plugins → Custom plugin markets**, в **Discover** добавить
источник `https://cdn.jsdelivr.net/gh/GreenJenckens/dsh-plugin-opencode-limits@main/market/index.json`
и поставить плагин с карточки. Ключ берётся из `OPENCODE_GO_API_KEY`, хранилища ключей DSH или
`~/.dsh/.credentials.yaml` и никогда не попадает в браузер: страница получает только проценты и время
сброса. Подробности — в английской части выше.
