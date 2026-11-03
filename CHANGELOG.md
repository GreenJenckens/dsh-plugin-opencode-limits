# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-11-04

### Added

* Host half: polls `https://opencode.ai/zen/go/v1/usage` on a timer, keeps the last good document,
  and serves it over one exact HTTP route (`/x/opencode-limits`) for loopback peers only.
* Client half: a stat pill in the `conversation.composer.dock` slot, styled with the harness's own
  tokens and metrics, next to the steps, decode speed, token and cache pills.
* Per-window ring indicators reusing the context meter's geometry; the arc shows the remaining share
  of each window (5 hours, weekly, monthly) and turns into a warning colour near the limit.
* Key resolution per poll from the environment, the DSH credential store, or `$DSH_HOME/.credentials.yaml`
  — the key never reaches the browser.
* Freshness: 20 s host polling, 15 s client polling, an immediate refresh on window focus, and a
  click-to-refresh that bypasses the host cache.
* Offline test suites for both halves (`node test/host.test.mjs`, `node test/client.test.mjs`) that
  need no network and no key.
* Format-1 plugin market index (`market/index.json`) with an icon, so the plugin can be added as a
  market source and installed from the Discover tab.
