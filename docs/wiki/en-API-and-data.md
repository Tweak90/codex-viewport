# API and data storage

[Deutsch](API-und-Datenhaltung.md) · [English home](en-Home.md)

## Two API layers

Codex-Web's browser API is separate from the native App Server protocol. The web server checks sign-in and CSRF, manages local metadata and translates actions into permitted native RPCs.

| Browser endpoint | Purpose |
| --- | --- |
| `/api/auth/*` | Initial setup, sign-in, session and sign-out |
| `/api/settings` | Protected instance settings and ENV overrides |
| `/api/state` | Connection and project state |
| `/api/rpc` | Explicitly allowed native methods |
| `/api/projects` | Project management |
| `/api/projects/:id/agents`, `/agents/:agentId` | Project-scoped agent lists and paginated, read-only output |
| `/api/projects/:id/files`, `/uploads`, `/download`, `/media` | Files, attachments and gallery |
| `/api/chats/:id/history` | Paged history |
| `/api/chats/:id/questions` | Async questions and one-shot replies |
| `/api/chats/:id/composer`, `/context`, `/export` | Draft, context and Markdown export |
| `/api/workbench`, `/api/pins` | Preferences and pins |
| `/api/search`, `/api/tasks`, `/api/version` | Search, tasks and release information |
| `/api/usage`, `/api/usage/reset` | Usage limits and confirmed resets |
| `/events` | Browser event WebSocket |
| `/healthz` | Public web health; connection state when authenticated |

These are endpoint groups. HTTP methods, request validation and exact payloads are defined in `server.mjs` and `lib/work-routes.mjs`.

## Native communication

The bridge initializes the connection and uses the server's models, threads, limits and events. Requests include method, parameters and ID; notifications can omit ID. Server-initiated requests retain their native IDs. The browser-facing RPC route has an explicit allowlist.

Native groups include `thread/*`, `turn/*`, `account/*`, `fs/*` and `command/exec`. Host commands use argument arrays rather than interpolated filenames in shell code. No separate file server exposes the project filesystem.

A usage reset requires confirmation and an idempotency key. Mutating operations are never automatically replayed after a transport failure.

## Questions and queued input

Codex 0.166.0 exposes asynchronous questions in `agentMessage.questions`, separately from synchronous `item/tool/requestUserInput` server requests. Async replies use a structured user message containing the original call ID and question index. The app reserves delivery state before sending. An unconfirmed delivery stays blocked against resubmission; read-only history recovery can recognize an already recorded reply.

Follow-ups can use `thread/queue/add` and `thread/queue/list`. The web server starts its own pending entries with `thread/queue/start` once the thread is idle. It does not take over queue entries from other clients. A failed or interrupted turn pauses automatic advancement. Start claims are persisted before the mutating RPC, so reconnects do not replay an uncertain start.

## Storage locations

| Location | Content |
| --- | --- |
| Web volume: `auth.json` | Salted scrypt password hash |
| Web volume: `sessions.json` | Hashed session tickets and session metadata |
| Web volume: `settings.json` | Saved overrides, including configured API/GitHub secrets |
| Web volume: `questions.json` | Question prompts, options and delivery state |
| Web volume: `message-queue.json` | Queue ownership, paused threads and start claims |
| Web volume: `projects.json` | IDs, paths, assignments, defaults and empty chat drafts |
| Web volume: `workbench.json` | Pins, input drafts, tasks and context values |
| Web volume: `search-index.json` | Searchable text and history locations |
| Codex host | Native chats, sign-in, tools and project files; submitted answers and queued input |
| Project: `.codex-web/uploads/` | Uploaded attachments |
| Browser storage | Theme, panel sizes, language, navigation and cached drafts |

JSON writes replace files atomically. Write queues serialize updates; initial password setup creates its file exclusively. Secret settings are never included in browser API responses.

## Search, context and private data

Search indexes paged entries, storing text and location cursors instead of large binary image data. It honors archive state and explicit project assignment. Initial indexing runs in the background.

Context values come from native token events or saved native history. Missing data stays unknown rather than being inferred from a model assumption.

The web volume contains private drafts, prompts, search text and credentials. It is excluded from source and release archives, as are `.env`, local keys, uploads and test images. See [Security and limitations](en-Security-and-limitations.md).
