# @kaged/webhook-notify

System plugin for [kaged](https://github.com/kaged-dev) that POSTs the daemon launch URL to a webhook on `auth.launchUrlReady`, with HTTPS enforcement and exponential backoff retry.

Extracted from the kaged monorepo (`plugins/system/webhook-notify`); symlinked back into it as a workspace member during the transition.

`vendor/plugin-types.ts` is a vendored copy of the monorepo's `@kaged/plugin-types` (type-only imports, so it never exists at runtime). Once `@kaged/plugin-types` is published to npm, replace the vendored copy with a devDependency.

## Develop

```sh
bun install
bun test
bun run typecheck
bun run format
```

## Release

Bump `version` in `package.json`, then tag and push:

```sh
git tag v0.1.x && git push origin v0.1.x
```

The release workflow verifies the tag matches the package version, runs tests, and publishes to npm with provenance.

## License

MIT
