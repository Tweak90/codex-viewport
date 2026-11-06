# Tech stack and development

[Deutsch](Techstack-und-Entwicklung.md) · [English home](en-Home.md)

## Stack

| Component | Technology |
| --- | --- |
| Runtime | Node.js 22 or later, ES modules |
| Server | Native Node `http`, authentication and REST routes |
| Transport | `ws` for the external WebSocket API |
| UI | HTML, CSS and JavaScript without a frontend framework |
| Markdown | `marked` and DOMPurify |
| Passwords | Node `crypto`, scrypt, random session tickets |
| Storage | Atomically replaced JSON files in the web volume |
| Host tools | Python 3 and Git through the native API |
| Packaging | Docker, Node-22 Debian Slim, Compose |
| Tests | Node test runner and Playwright/Chromium |
| Publishing | GitHub Actions, GHCR, release downloads and SHA-256 checksums |

Dependency versions are in `package.json` and `package-lock.json`. There is no frontend bundler or additional database.

## Source map

| File | Responsibility |
| --- | --- |
| `server.mjs` | Browser API, authentication and event delivery |
| `lib/bridge.mjs` | Native RPCs, request IDs and reconnection |
| `lib/auth.mjs` | Passwords, sessions and origin protection |
| `lib/settings.mjs` | Saved overrides, ENV fallback and validation |
| `lib/questions.mjs` | Async questions and reply claims |
| `lib/message-queue.mjs` | Native queue ownership and safe advancement |
| `lib/projects.mjs` | Projects, assignments, defaults and deletion guards |
| `lib/history.mjs`, `lib/media.mjs` | History paging, images and gallery |
| `lib/files.mjs` | File actions, uploads and ZIP |
| `lib/workbench.mjs`, `lib/search.mjs` | Drafts, pins, tasks, context, search and export |
| `lib/releases.mjs`, `lib/work-routes.mjs` | Release checks and authenticated routes |
| `public/app.js`, `public/features.js` | Navigation, chats and workbench |
| `public/settings.js`, `public/questions.js`, `public/queue.js` | Settings, dialogs and queue display |
| `public/i18n.js`, `public/locales/en.json` | German and English UI |
| `public/style.css` | IDE layout, themes and responsive styles |

## Local development and tests

```bash
npm ci
CODEX_WS_URL=ws://codex-host.example:4500 npm start
npm test
npx playwright install chromium
npm run test:browser
npm run check:publication
npm run check:docs
npm run check:i18n
node --check public/app.js
```

Provide `CODEX_API_TOKEN` through your environment if required by the external API. Keep private values out of tracked sources.

Browser tests start a mock-backed server and temporary project tree. They do not send real model requests or consume real reset credits. Live tests require an explicitly selected dedicated test instance using `TEST_BASE_URL` and `TEST_PASSWORD`; never set up or replace the production password while testing.

```bash
docker compose --env-file .env.example config --quiet
docker build -t codex-viewport:dev .
```

Release tags run the checks and publish versioned and `latest` images. Release downloads also include a Docker archive and checksums. Publishing is separate from deployment.

Full GitHub event payloads are excluded from build provenance, metadata output and build records. A manual registry metadata audit checks existing published image metadata; its sanitization mode preserves runnable platforms while removing old provenance versions. Reports contain finding locations, not secret values.

## Maintaining documentation — for contributors

Wiki sources live in `docs/wiki/`. `npm run check:docs` validates internal page links. For an initialized GitHub Wiki:

```bash
git clone https://github.com/Tweak90/codex-viewport.wiki.git ../codex-viewport.wiki
node scripts/sync-wiki.mjs ../codex-viewport.wiki
git -C ../codex-viewport.wiki add --all
git -C ../codex-viewport.wiki commit -m "Update documentation"
git -C ../codex-viewport.wiki push
```

Keep the checkout outside the app or in an ignored local directory. The exporter removes `.md` from local page links for GitHub Wiki; repository sources keep normal Markdown file links.

`Home.md` chooses `en-Home.md` or `de-Home.md`. Update both language versions of docs, README, changelog and release notes when behavior changes. UI translation applies to product controls; project names, messages, code and file contents are preserved.

`lib/agents.mjs` and `public/agents.js` provide project-scoped agent lists and read-only output history. Settings use three categories with keyboard-accessible tabs and a fixed action footer. Select options inherit theme colors, including their opened menus.
