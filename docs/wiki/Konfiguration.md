# Konfiguration

[English](en-Configuration.md) · [Deutsche Startseite](de-Home.md)

`.env.example` enthält neutrale Beispiele. Eine lokale `.env` wird nicht versioniert. Docker kann eine Umgebungsdatei mit `--env-file` laden; Compose liest `.env` für die gewählte Rolle.

## Web-Container

| Variable | Zweck | Vorgabe |
| --- | --- | --- |
| `CODEX_WS_URL` | WebSocket-Ziel des Codex-Hosts | In Compose erforderlich |
| `CODEX_API_TOKEN` | Bearer-Token des Gateways oder passenden API-Endpunkts | In `compose.image.yml` erforderlich |
| `WEB_BIND_IP` | Bind-Adresse des veröffentlichten Browserports | `0.0.0.0` |
| `WEB_PORT` | Browserport auf dem Web-Host | `8787` |
| `CODEX_WEB_LANGUAGE` | Sprache ohne gespeicherte Einstellung | `de`; alternativ `en` |
| `CODEX_FOLLOWUP_MODE` | Folgenachrichten bei laufendem Auftrag | `steer`; alternativ `queue` |
| `CODEX_SEND_WITH` | Sendetaste ohne gespeicherte Einstellung | `shiftEnter`; alternativ `enter` |
| `HOST_LABEL` | Anzeigename in der Oberfläche | `KI-VM` |
| `CODEX_PROJECTS_ROOT` | Basisverzeichnis für neue Projekte auf dem Codex-Host | Aus Codex-Metadaten abgeleitet, endet auf `codex-projects` |
| `CODEX_WEB_IMAGE` | Image für `compose.image.yml` | `ghcr.io/tweak90/codex-web-ui:latest` |
| `CODEX_RELEASE_REPOSITORY` | GitHub-Repository für Updatehinweise | Das Projekt-Repository; Format `owner/repo` |
| `CODEX_GITHUB_TOKEN` | Optionaler lesender GitHub-Token für Updatehinweise | Leer; andernfalls wird `gh` auf dem Codex-Host verwendet |

`CODEX_API_TOKEN` ist der Zugang zur Codex-Verbindung. Er ist nicht das Browserpasswort und kein OpenAI-API-Key.

## Gateway

| Variable | Zweck | Vorgabe beziehungsweise Beispiel |
| --- | --- | --- |
| `API_BIND_IP` | Bind-Adresse des Gateway-Ports | `0.0.0.0` |
| `API_PORT` | Gateway-Port auf dem Codex-Host | `4500` |
| `CODEX_SOCKET_DIR` | Verzeichnis des Control-Sockets | `${HOME}/.codex/app-server-control` |
| `CODEX_RUNTIME_SOCKET_DIR` | Verzeichnis des tatsächlichen Socket-Ziels | `/tmp/codex-daemon-1000` |
| `CODEX_UID` / `CODEX_GID` | Benutzer und Gruppe des Gateway-Prozesses | `1000` / `1000`, an Installation anpassen |

Der Gateway benötigt Zugriff auf den vorhandenen Control-Socket. Er erhält keine Projektverzeichnisse und keinen Docker-Socket.

## Direkter Node-Start

Für `npm start` sind außerdem `CODEX_SOCKET`, `DATA_DIR`, `PORT` und `BIND_ADDRESS` verfügbar. Ohne WebSocket-Ziel wird der lokale Control-Socket des Benutzerverzeichnisses verwendet. Im Docker-Image liegen die Web-Daten standardmäßig unter `/data` und der Webserver lauscht intern auf Port `8787`.

## Browserpasswort

Das Passwort wird ausschließlich in der Oberfläche eingerichtet. Es gibt keine Passwortvorgabe in `.env`. Das Datenvolume enthält den Passwort-Hash und die Sitzungen; ein normales Update ändert diese Daten nicht.

## Reverse Proxy

Der Proxy muss WebSocket-Upgrades sowohl für `/events` als auch für einen gegebenenfalls vorgeschalteten API-Gateway unterstützen. Für längere Aufgaben sind ausreichend lange Verbindungszeitlimits erforderlich. Bei TLS-Terminierung `Host`, gegebenenfalls `X-Forwarded-Host` und `X-Forwarded-Proto` passend weiterreichen. Diese Angaben werden unter anderem für Herkunftsprüfung und Cookie-Einstellungen verwendet.

Desktop-Browserbenachrichtigungen benötigen HTTPS oder localhost und eine Browserberechtigung. Hinweise innerhalb der App funktionieren auch ohne diese Browserfunktion.

## Rollen nicht verwechseln

Die OpenAI-Anmeldung liegt auf dem Codex-Host. Das Browserpasswort schützt Codex-Web. Der Gateway-Token schützt die Verbindung zum Codex-Host. Eine GitHub-Registry-Anmeldung dient dem Image-Pull; ein Git-Deploy-Key dient dem Repository-Abruf. Diese Zugänge erfüllen unterschiedliche Aufgaben.

## Einstellungen in der Oberfläche

Das Zahnrad links öffnet die Einstellungen. Sie gelten für diese gemeinsam genutzte Webinstanz und bleiben im Volume in `settings.json` gespeichert.

- **Leeres Feld / ENV verwenden:** Der ENV-Wert gilt, andernfalls die dokumentierte Vorgabe.
- **Ausgefülltes Feld:** Die gespeicherte Einstellung hat Vorrang vor ENV.
- Geheime Werte werden nicht zurück an den Browser übertragen. Ein als aktiv angezeigter gespeicherter Wert bleibt ohne Änderung erhalten. **ENV verwenden** entfernt den gespeicherten Override; eine neue Eingabe ersetzt ihn.

Einstellbar sind Sprache, Enter-Belegung, Behandlung von Folgenachrichten, Hostname, WebSocket-Adresse, API-Token, lokaler Control-Socket, Projektbasis und GitHub-Releasezugang. Änderungen an Hostname, Projektbasis und Releasezugang gelten sofort. Eine geänderte Codex-Verbindung wird neu verbunden; während offener API-Aufrufe wird der Wechsel abgelehnt. Gesendete Aufträge werden nicht wiederholt. Ein anderer Codex-Host besitzt möglicherweise andere absolute Projektpfade.

Docker-Portfreigaben, Image-Auswahl, Volume-Mounts, Prozess-Bind-Adresse und Gateway-Parameter werden beim Containerstart festgelegt. Sie bleiben Teil der Docker-/Compose-Konfiguration. Die Weboberfläche verwaltet keine Container und startet keine Deployments.
