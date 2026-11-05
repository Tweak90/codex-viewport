# Installation

[English](en-Installation.md) · [Deutsche Startseite](de-Home.md)

Codex-Web ist ein Docker-Webclient für eine **vorhandene externe Codex-App-Server-API**. Die Verbindung läuft ausschließlich über `ws://` oder `wss://`. Codex-Anmeldung, Projektdateien und Werkzeuge bleiben auf dem Codex-Host. Dieses Projekt wird auf dem Web-Host installiert und startet oder enthält keinen Codex-Prozess.

## Voraussetzungen

- Docker auf dem Web-Host; Compose ist optional.
- Ein erreichbarer Codex-App-Server-WebSocket-Endpunkt, verifiziert mit Codex **0.166.0**. Die Servereinrichtung beschreibt die [offizielle App-Server-Dokumentation](https://learn.chatgpt.com/docs/app-server).
- Den zugehörigen Bearer-Token, falls die API eine Anmeldung verlangt.
- Python 3 und Git auf dem Codex-Host für Projekt- und Dateiwerkzeuge. Diese werden über die API aufgerufen.

Projektordner und Codex-Anmeldedaten werden nicht in den Web-Container eingebunden. Er benötigt nur sein eigenes persistentes Datenvolume und Netzwerkzugang zur API.

## Fertiges Image über Docker starten

Auf dem Web-Host `.env.web` anlegen:

```dotenv
CODEX_WS_URL=ws://codex-host.example:4500
CODEX_API_TOKEN=replace-with-your-api-token
HOST_LABEL=Codex-Host
```

Beispielhost und Token durch die Werte deines API-Endpunkts ersetzen. `CODEX_API_TOKEN` leer lassen, wenn der Endpunkt keinen Token verlangt.

```bash
docker volume create codex-web-data
docker pull ghcr.io/tweak90/codex-web-ui:latest
docker run -d --name codex-web --restart unless-stopped --init \
  -p 8787:8787 --env-file .env.web \
  -v codex-web-data:/data \
  ghcr.io/tweak90/codex-web-ui:latest
```

Das öffentliche Image unterstützt Linux/amd64. Registry-Anmeldung, Git-Checkout und eigener Build sind nicht nötig. Für ein eingeschränktes Fork-Image zuerst mit einem leseberechtigten Konto `docker login` ausführen.

`http://web-host.example:8787` öffnen und ein Browserpasswort mit mindestens vier Zeichen setzen. Dieses Passwort ist unabhängig von Codex-Konto und API-Token. Das Datenvolume bei Updates beibehalten.

## Compose verwenden

Quellcode auf dem Web-Host auschecken:

```bash
git clone https://github.com/Tweak90/codex-web.git
cd codex-web
cp .env.example .env
```

`CODEX_WS_URL` und bei Bedarf `CODEX_API_TOKEN` in `.env` setzen. Das fertige Image starten:

```bash
docker compose -f compose.image.yml up -d
```

Oder das Web-Image aus dem Quellcode bauen:

```bash
docker compose up -d --build
```

Beide Konfigurationen verbinden sich mit der externen API. Die Web-Daten bleiben im Volume `console-data` unter `/data`.

## Node direkt für die Entwicklung starten

```bash
npm ci
CODEX_WS_URL=ws://codex-host.example:4500 npm start
```

`CODEX_API_TOKEN` bei Bedarf über die eigene Umgebung bereitstellen. Eine API-Adresse aus `CODEX_WS_URL` oder den gespeicherten Einstellungen ist erforderlich; eine lokale Verbindung wird nicht automatisch gewählt. Weitere Schritte: [Konfiguration](Konfiguration.md), [Benutzung](Benutzung.md) und [Updates](Betrieb-und-Updates.md).
