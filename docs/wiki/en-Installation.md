# Installation

[Deutsch](Installation.md) · [English home](en-Home.md)

There are two roles: the Codex host and the web host. They can run on one machine or separate machines. The web server must reach the Codex host's API endpoint.

## Requirements

| Location | Requirement |
| --- | --- |
| Codex host | Running, signed-in Codex App Server; verified with Codex 0.166.0 |
| Codex host | Python 3 and Git for project, file and terminal tools |
| Web host | Docker; the published image targets Linux/amd64 |
| Gateway host | Docker and Compose when using the included gateway |
| Network | Web host can reach the Codex API port, normally TCP 4500 |
| Local development | Node.js 22 or newer and npm |

Replace `.example` hostnames, IDs and paths with values for your installation.

## 1. Provide the Codex API

Configure Codex with the account you want to use. Codex-Web reuses that existing sign-in; the web container does not install or launch another Codex process.

If you already have a compatible WebSocket endpoint, skip to the web container and point `CODEX_WS_URL` at it. Authentication and TLS follow that endpoint's configuration.

Otherwise, check out the project on the Codex host and configure the gateway:

```bash
git clone https://github.com/Tweak90/codex-web.git
cd codex-web
cp .env.example .env
codex app-server daemon start
codex app-server daemon version
readlink -f "$HOME/.codex/app-server-control/app-server-control.sock"
```

Set these gateway values in `.env`:

```dotenv
API_BIND_IP=0.0.0.0
API_PORT=4500
CODEX_SOCKET_DIR=${HOME}/.codex/app-server-control
CODEX_RUNTIME_SOCKET_DIR=/tmp/codex-daemon-1000
CODEX_UID=1000
CODEX_GID=1000
CODEX_API_TOKEN=replace-with-your-gateway-token
```

`CODEX_SOCKET_DIR` contains `app-server-control.sock`. If this socket is an absolute symlink, also mount its actual target directory as `CODEX_RUNTIME_SOCKET_DIR`. The runtime directory and UID/GID shown above are examples; match them to the Codex user.

Use your own bearer token and the same value on the web host. Do not commit the token.

```bash
docker compose -f compose.gateway.yml up -d --build
```

Alternatively, `bash scripts/start-api.sh` starts the daemon and builds the gateway. The gateway forwards to the existing socket and does not replace the daemon. Its health check only checks the gateway HTTP server.

See the [official App Server documentation](https://learn.chatgpt.com/docs/app-server) for the protocol and supported transports.

## 2. Run the published image using Docker

The published image needs no source checkout or local build. Public packages need no registry login. For restricted packages, first run `docker login ghcr.io` with an account that has read access.

Create `.env.web` on the web host:

```dotenv
CODEX_WS_URL=ws://codex-host.example:4500
CODEX_API_TOKEN=replace-with-your-gateway-token
HOST_LABEL=Codex-Host
```

Use `wss://` when connecting through a TLS proxy. Replace the hostname and token, then run:

```bash
docker volume create codex-web-data
docker pull ghcr.io/tweak90/codex-web-ui:latest
docker run -d --name codex-web --restart unless-stopped --init \
  -p 8787:8787 \
  --env-file .env.web \
  -v codex-web-data:/data \
  ghcr.io/tweak90/codex-web-ui:latest
```

Open `http://web-host.example:8787`. Set and confirm a password of at least four characters. There is no default password. Keep the data volume for future updates.

## Published image with Compose

After checking out the repository, copy `.env.example` to `.env` and enter the web API values:

```bash
docker compose -f compose.image.yml pull
docker compose -f compose.image.yml up -d
```

`compose.image.yml` uses the published image and does not build source code. `CODEX_WEB_IMAGE` can select a fixed version or your own image. `latest` follows the current release; a fixed tag allows an explicit version choice. Other container management tools must use equivalent image, environment, port and volume settings.

## Build from source

```bash
git clone https://github.com/Tweak90/codex-web.git
cd codex-web
cp .env.example .env
# Enter your Codex API address and token in .env.
docker compose up -d --build
```

Alternatively, use `bash scripts/start-web.sh`.

## Local development

```bash
npm ci
CODEX_SOCKET="$HOME/.codex/app-server-control/app-server-control.sock" npm start
```

Without `CODEX_WS_URL`, the Node server uses the local Unix control socket. Docker web configurations explicitly require a WebSocket URL. Continue with [Configuration](en-Configuration.md) and [Usage](en-Usage.md).
