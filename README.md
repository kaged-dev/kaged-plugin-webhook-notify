<div align="center">

<img src="https://kaged.dev/hero.svg" alt="kaged" width="100%" />

# 影 @kaged/plugin-webhook-notify

**shadow ops for your `[doorbell]`**

A [kaged](https://kaged.dev) system plugin that POSTs the daemon's launch URL to your webhook the moment it's ready — HTTPS enforced, exponential backoff, zero polling.

[![npm](https://img.shields.io/npm/v/@kaged/plugin-webhook-notify?color=FFB000&label=npm&labelColor=0A0A0B)](https://www.npmjs.com/package/@kaged/plugin-webhook-notify)
[![license](https://img.shields.io/badge/license-MIT-FF2E63?labelColor=0A0A0B)](#license)
[![plugin](https://img.shields.io/badge/plugin-system-00E0FF?labelColor=0A0A0B)](#what-it-is)

</div>

---

## what it is

The kaged daemon mints a fresh launch URL on boot and on every token regeneration. This plugin subscribes to the `auth.launchUrlReady` hook and delivers that URL to a webhook of your choosing — a Slack/Discord/ntfy endpoint, your own service, anything that takes an HTTP request. Headless boxes stop being a "now ssh in and cat the launch-url file" chore.

- **HTTPS enforced** — plain `http://` targets are rejected (loopback excepted).
- **Exponential backoff retry** — transient webhook failures don't lose the notification.
- **Templated body** — `{{url}}` substitution, custom headers, POST or PUT.

## configure

In the daemon's `local.toml`:

```toml
[system_plugins."@kaged/plugin-webhook-notify"]
enabled = true

[system_plugins."@kaged/plugin-webhook-notify".config]
webhook_url = "https://ntfy.sh/my-kaged-box"
```

Full config:

| Field | Type | Default | Description |
|---|---|---|---|
| `webhook_url` | string | — (required) | HTTPS endpoint to notify |
| `method` | `"POST"` \| `"PUT"` | `"POST"` | HTTP method |
| `include_token` | boolean | `false` | Include the launch token in the payload |
| `body_template` | string | `🔑 kaged launch URL:\n{{url}}` | Body with `{{url}}` substitution |
| `headers` | record | `{}` | Extra request headers (e.g. auth) |
| `timeout_ms` | integer | clamped | Per-request timeout |
| `retry_count` | integer | clamped | Retry attempts on failure |
| `retry_delay_ms` | integer | clamped | Base delay, doubled per retry |

## development

```bash
bun install
bun test
bun run typecheck
bun run format      # biome
```

Type imports come from [`@kaged/plugin-types`](https://www.npmjs.com/package/@kaged/plugin-types) (devDependency — erased at runtime).

## release

Bump `version` in `package.json`, tag `v<version>`, push the tag. CI verifies the tag matches, runs the suite, and publishes to npm with provenance.

---

## license

MIT © the kaged project

<div align="center">

`[kaged]` · [kaged.dev](https://kaged.dev) · *sanctioned edge, sacred code*

</div>
