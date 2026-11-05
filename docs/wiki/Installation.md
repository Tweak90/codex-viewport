# Installation

[English](en-Installation.md) · [Deutsche Startseite](de-Home.md)

Die Installation besteht aus einem Codex-Host und einem Web-Host. Beide Rollen können auf demselben Rechner oder auf getrennten Rechnern laufen. Die Browseroberfläche benötigt Zugriff auf die API des Codex-Hosts.

## Voraussetzungen

| Ort | Benötigt |
| --- | --- |
| Codex-Host | Angemeldeter Codex App Server; verifiziert mit Codex 0.166.0 |
| Codex-Host | Python 3 und Git für Projekt-, Datei- und Konsolenwerkzeuge |
| Beide Hosts | Docker und Docker Compose, wenn der mitgelieferte Gateway verwendet wird |
| Entwicklung | Node.js ab Version 22 und npm |
| Netzwerk | Web-Host erreicht den API-Port des Codex-Hosts, standardmäßig TCP 4500 |

Alle `.example`-Hostnamen sind Platzhalter. UID/GID und Socket-Pfade müssen zur eigenen Installation passen.

## 1. Quellcode bereitstellen

Auf den benötigten Hosts:

```bash
git clone https://github.com/Tweak90/codex-web.git
cd codex-web
cp .env.example .env
```

Bei einem privaten Repository benötigt Git einen berechtigten Zugang. Diese Git-Authentifizierung ist unabhängig von der Verbindung zwischen Codex-Web und Codex.

## 2. API auf dem Codex-Host

Zuerst Codex mit der gewünschten Benutzeranmeldung einrichten. Codex-Web verwendet diese vorhandene Anmeldung und startet keine eigene Codex-Installation.

```bash
codex app-server daemon start
codex app-server daemon version
readlink -f "$HOME/.codex/app-server-control/app-server-control.sock"
```

In `.env` konfigurieren:

```dotenv
API_BIND_IP=0.0.0.0
API_PORT=4500
CODEX_SOCKET_DIR=${HOME}/.codex/app-server-control
CODEX_RUNTIME_SOCKET_DIR=/tmp/codex-daemon-1000
CODEX_UID=1000
CODEX_GID=1000
CODEX_API_TOKEN=
```

`CODEX_SOCKET_DIR` ist das Verzeichnis, das `app-server-control.sock` enthält. Falls der Socket ein absoluter Symlink ist, muss dessen tatsächliches Zielverzeichnis zusätzlich als `CODEX_RUNTIME_SOCKET_DIR` eingebunden werden. `/tmp/codex-daemon-1000` und UID/GID 1000 sind Beispiele für eine Linux-Installation.

Für den Gateway einen eigenen Bearer-Token als `CODEX_API_TOKEN` setzen. Derselbe Wert wird später auf dem Web-Host verwendet. Der Token wird nicht in Git gespeichert.

Gateway starten:

```bash
docker compose -f compose.gateway.yml up -d --build
```

Alternativ erledigt `bash scripts/start-api.sh` den Daemon-Start und den Gateway-Build. Der Gateway verbindet sich mit dem vorhandenen Socket. Er ersetzt den Codex-Daemon nicht.

Der Gateway-Healthcheck prüft den Gateway-Webserver. Die tatsächliche Codex-Verbindung zeigt später die angemeldete Weboberfläche.

## 3. Weboberfläche starten

Auf dem Web-Host in `.env` setzen:

```dotenv
CODEX_WS_URL=ws://codex-host.example:4500
CODEX_API_TOKEN=
WEB_PORT=8787
HOST_LABEL=Codex-Host
```

Den eigenen Hostnamen und den zuvor gewählten Token eintragen. Für Verbindungen über einen TLS-Proxy kann `wss://` verwendet werden.

```bash
docker compose up -d --build
```

Alternativ: `bash scripts/start-web.sh`.

Danach `http://web-host.example:8787` öffnen. Beim ersten Aufruf ein eigenes Passwort festlegen und bestätigen. Die Mindestlänge beträgt vier Zeichen. Es gibt kein Standardpasswort.

## Fertiges Image über die Docker-Konsole

Das fertige Image `ghcr.io/tweak90/codex-web-ui:latest` benötigt weder Git-Checkout noch eigenen Build und ist für Linux/amd64 gebaut. Öffentliche Pakete sind ohne Anmeldung abrufbar. Für eingeschränkte Pakete zuerst `docker login ghcr.io` mit einem leseberechtigten Konto ausführen. Ein vorhandener Codex-API-Endpunkt ist weiterhin erforderlich.

Eine Datei `.env.web` mit den eigenen Werten anlegen:

```dotenv
CODEX_WS_URL=ws://codex-host.example:4500
CODEX_API_TOKEN=replace-with-your-gateway-token
HOST_LABEL=Codex-Host
```

Dann auf dem Web-Host ausführen:

```bash
docker volume create codex-web-data
docker pull ghcr.io/tweak90/codex-web-ui:latest
docker run -d --name codex-web --restart unless-stopped --init \
  -p 8787:8787 \
  --env-file .env.web \
  -v codex-web-data:/data \
  ghcr.io/tweak90/codex-web-ui:latest
```

`codex-host.example` und den Token ersetzen. Anschließend `http://web-host.example:8787` öffnen und ein Passwort mit mindestens vier Zeichen festlegen. Das Volume enthält Anmeldung und Einstellungen und muss bei Updates wiederverwendet werden.

### Fertiges Image mit Compose

Nach einem Git-Checkout `.env.example` nach `.env` kopieren und die API-Werte setzen:

```bash
docker compose -f compose.image.yml pull
docker compose -f compose.image.yml up -d
```

Diese Variante baut keinen Quellcode. `CODEX_WEB_IMAGE` erlaubt ein festes Versionstag oder ein eigenes Image. Ein festes Tag eignet sich für kontrollierte Versionswechsel; `latest` folgt dem aktuellen Release. Andere Verwaltungsoberflächen müssen dieselben Image-, Umgebungs-, Port- und Volume-Angaben übernehmen.

## Vorhandener WebSocket-Endpunkt

Ist der Codex App Server bereits über einen passenden WebSocket-Endpunkt erreichbar, kann `CODEX_WS_URL` direkt darauf zeigen. Dann entfällt der Gateway. Authentifizierung und TLS richten sich nach diesem Endpunkt. Zum Protokoll siehe die [offizielle App-Server-Dokumentation](https://learn.chatgpt.com/docs/app-server).

## Lokaler Entwicklungsbetrieb

```bash
npm ci
CODEX_SOCKET="$HOME/.codex/app-server-control/app-server-control.sock" npm start
```

Ohne `CODEX_WS_URL` verwendet der Node-Webserver den lokalen Unix-Socket. Die Docker-Web-Konfiguration erwartet dagegen ausdrücklich eine WebSocket-URL. Weitere Schritte: [Konfiguration](Konfiguration.md) und [Benutzung](Benutzung.md).
