# Codex-Web maintenance

By default Enter inserts a newline and Shift+Enter sends; the user can reverse this in Settings. Follow-ups can steer active work or use the native queue. The workbench scope excludes Git commit/push/branch controls, Git worktrees and a recycle bin. Keep the existing read-only Git view and project Git creation/clone options; do not add those excluded features unless explicitly requested.

This is an independent browser client for the Codex App Server API. Keep the web container separate from the Codex process and project files on the KI VM. The supported transports are the WebSocket API and the local Unix control socket. Do not copy code or assets from third-party Codex web clients or unpacked official desktop apps.

The operator performs every production Docker deployment. NEVER deploy, pull images, recreate, restart, stop or update the running production Docker stack or its containers. Prepare, test, commit, push and publish release images only. Read-only production Docker diagnostics are allowed. Do not change live production Docker configuration unless the user specifically requests that configuration edit; never combine it with deployment.

For each change, update README.md when setup or behavior changes, and add an entry to CHANGELOG.md. Run the relevant tests. Keep API compatibility explicit; current verified Codex version is 0.166.0. Never replay a previously sent mutating RPC after a transport failure.

When a release is requested, update package.json/package-lock.json and Compose image tags together, prepare release notes in docs/releases/, run checks and Docker build, then tag and publish GitHub release assets including checksums. The tag workflow publishes a versioned GHCR image. Do not include .env, SSH keys, runtime data or test screenshots with user data in commits or release archives.

Local commands:

- npm test
- node --check public/app.js
- docker compose config --quiet
- docker compose -f compose.gateway.yml config --quiet
- docker build -t codex-vm-console:1.0.0 .

Browser tests start their own isolated mock-backed server and temporary project tree with `npm run test:browser`. Live tests use TEST_BASE_URL and TEST_PASSWORD only against a dedicated test deployment. Never set up or replace the production password during verification. Never consume real quota resets in tests. Folder deletion tests must use only disposable projects created by those tests. production Docker uses the configured image (latest by default) and repulls on deployment.

Keep source, examples, UI placeholders and release notes independent of any installation. Do not commit private network addresses, personal home paths or credentials. Use reserved example hostnames and derive remote paths from Codex metadata. Run `npm run check:publication`; review reachable history and published artifacts separately before changing repository visibility.
