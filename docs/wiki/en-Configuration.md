# Configuration

[Deutsch](Konfiguration.md) · [English home](en-Home.md)

`.env.example` contains neutral examples. A local `.env` is not tracked. Docker reads an environment file with `--env-file`; Compose reads `.env` for the chosen role.

## Web application

| Variable | Purpose | Default |
| --- | --- | --- |
| `CODEX_WS_URL` | WebSocket endpoint on the Codex host | Required by Docker configurations |
| `CODEX_API_TOKEN` | Bearer token for the gateway or compatible endpoint | Required by `compose.image.yml` |
| `HOST_LABEL` | Host name displayed in the UI | `KI-VM` |
| `CODEX_PROJECTS_ROOT` | Base directory for new projects on the Codex host | Derived from Codex metadata, ending in `codex-projects` |
| `CODEX_WEB_LANGUAGE` | Language without a saved override | `de`; alternatively `en` |
| `CODEX_SEND_WITH` | Send key without a saved override | `shiftEnter`; alternatively `enter` |
| `CODEX_FOLLOWUP_MODE` | Handling of follow-ups while a task is active | `steer`; alternatively `queue` |
| `CODEX_WEB_IMAGE` | Image used by `compose.image.yml` | `ghcr.io/tweak90/codex-web-ui:latest` |
| `CODEX_RELEASE_REPOSITORY` | Repository for release notifications | This project; use `owner/repo` |
| `CODEX_GITHUB_TOKEN` | Optional read-only token for release checks | Otherwise use `gh` on the Codex host |

`CODEX_API_TOKEN` protects the Codex connection. It is independent of the browser password and is not an OpenAI API key.

## Gear menu and precedence

The gear button opens settings shared by this web instance. Overrides persist in `settings.json` in the data volume.

- **Empty field / Use ENV:** use the environment value, or the documented default if ENV is absent.
- **Filled field:** the saved setting takes precedence over ENV.
- Secret values are never sent back to the browser. An existing secret shown as active stays unchanged until edited. **Use ENV** removes that saved override; a new value replaces it.

Settings cover language, Enter behavior, follow-up handling, host label, API address and token, local control socket, project base directory and GitHub release access.

Host label, project base directory and release access changes apply immediately. A changed Codex endpoint reconnects the bridge; connection changes are rejected while API calls are pending. Previously sent work is never replayed. A different Codex host may use different absolute project paths.

## Docker and gateway parameters

These settings belong to container creation rather than the application settings menu:

| Variable | Purpose | Default or example |
| --- | --- | --- |
| `WEB_BIND_IP` / `WEB_PORT` | Published browser address and port | `0.0.0.0` / `8787` |
| `API_BIND_IP` / `API_PORT` | Published gateway address and port | `0.0.0.0` / `4500` |
| `CODEX_SOCKET_DIR` | Control-socket directory | `${HOME}/.codex/app-server-control` |
| `CODEX_RUNTIME_SOCKET_DIR` | Actual socket target directory | `/tmp/codex-daemon-1000` |
| `CODEX_UID` / `CODEX_GID` | Gateway user and group | `1000` / `1000`; match your installation |

The gateway only needs the control socket. It receives no project directories or Docker socket. The web UI does not manage containers or deploy updates.

## Direct Node startup

`npm start` also accepts `CODEX_SOCKET`, `DATA_DIR`, `PORT` and `BIND_ADDRESS`. The Docker image stores web data under `/data` and listens internally on port `8787`. Docker ports, mounts and process bind settings are configured at startup.

## Browser password and reverse proxy

Set the password in the UI; there is no password default in `.env`. Keep the data volume to preserve sign-in and settings during updates.

A reverse proxy must support WebSocket upgrades for `/events` and for any proxied gateway. Allow long-lived connections and forward `Host`, `X-Forwarded-Host` where needed, and `X-Forwarded-Proto` correctly; these affect origin checks and cookie security.

Desktop notifications require HTTPS or localhost and browser permission. In-app notices do not require desktop notification support.

The Codex account sign-in stays on the Codex host. The browser password, gateway token, optional GitHub token and any Git credentials serve separate purposes.
