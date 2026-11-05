# Konfiguration

[English](en-Configuration.md) · [Deutsche Startseite](de-Home.md)

Der Web-Container verbindet sich ausschließlich über WebSocket mit einer externen Codex-API. `.env.example` enthält neutrale Beispiele. Docker liest die Datei über `--env-file`; Compose verwendet `.env`.

## Anwendungsvariablen

| Variable | Zweck | Vorgabe |
| --- | --- | --- |
| `CODEX_WS_URL` | Externe Codex-API-Adresse mit `ws://` oder `wss://` | Leer; für die Verbindung über ENV oder Einstellungen setzen |
| `CODEX_API_TOKEN` | Bearer-Token, falls die API einen verlangt | Leer |
| `HOST_LABEL` | Anzeigename des Codex-Hosts | `Codex-Host` |
| `CODEX_PROJECTS_ROOT` | Basisverzeichnis neuer Projekte auf dem Codex-Host | Aus Codex-Metadaten abgeleitet, endet auf `codex-projects` |
| `CODEX_WEB_LANGUAGE` | Sprache ohne gespeicherte Einstellung | `en`; alternativ `de` |
| `CODEX_SEND_WITH` | Sendetaste ohne gespeicherte Einstellung | `shiftEnter`; alternativ `enter` |
| `CODEX_FOLLOWUP_MODE` | Folgenachrichten während laufender Arbeit | `steer`; alternativ `queue` |
| `CODEX_RELEASE_REPOSITORY` | Repository für Releasehinweise im Format `owner/repo` | Dieses Projekt |
| `CODEX_GITHUB_TOKEN` | Optionaler lesender Token für Releaseabfragen | Leer; öffentliche Releases werden ohne Anmeldung geprüft |

`CODEX_API_TOKEN` ist unabhängig vom Browserpasswort und kein OpenAI-API-Key. Projektpfade beziehen sich auf den Codex-Host und werden über die API angesprochen.

## Einstellungen und ENV-Vorrang

**Einstellungen** steht in der linken Seitenleiste direkt über **Kontingente**. Der Dialog enthält drei Bereiche:

- **Allgemeine Einstellungen:** Sprache, Sendetaste und Folgenachrichten.
- **Codex-Einstellungen:** Anzeigename, API-Adresse und Token sowie Projektbasis.
- **Updates:** Release-Repository, optionaler GitHub-Token und Info-Dialog.

Jedes Feld zeigt, ob ein eigener Wert, ENV oder eine Vorgabe gilt. **ENV-Details** klappt Variablenname und Rückfallwert auf. Eingaben bleiben beim Bereichswechsel erhalten; **Speichern** und **Abbrechen** bleiben sichtbar.

- **Leeres Feld / Standard verwenden:** Der ENV-Wert gilt, andernfalls die dokumentierte Vorgabe.
- **Ausgefülltes Feld:** Die gespeicherte Einstellung hat Vorrang vor ENV.
- Geheime Werte werden nicht an den Browser zurückgegeben. Ein gespeicherter geheimer Wert bleibt ohne Bearbeitung erhalten. **Standard verwenden** entfernt ausdrücklich diesen Override.

Overrides liegen in `settings.json` im Datenvolume. Nicht mehr unterstützte Einstellungen früherer Installationen werden beim Start entfernt; aktuelle Vorgaben bleiben erhalten. Eine geänderte API-Verbindung wird neu verbunden; während offener API-Aufrufe wird der Wechsel abgelehnt. Gesendete Aufträge werden nicht wiederholt. Ein anderer Codex-Host kann andere absolute Projektpfade besitzen.

## Docker- und Node-Start

| Variable | Zweck | Vorgabe |
| --- | --- | --- |
| `WEB_BIND_IP` / `WEB_PORT` | Veröffentlichte Docker-Browseradresse und Port | `0.0.0.0` / `8787` |
| `CODEX_WEB_IMAGE` | Image für `compose.image.yml` | `ghcr.io/tweak90/codex-web-ui:latest` |
| `DATA_DIR` | Web-Daten beim direkten Node-Start | `.data`; `/data` in Docker |
| `PORT` / `BIND_ADDRESS` | HTTP-Listener des Node-Prozesses | `8787` / `0.0.0.0` |

Ports, Volumes und Image-Auswahl gehören zur Docker-/Compose-Konfiguration. Der Einstellungsdialog verwaltet keine Container und startet keine Deployments.

## Browserpasswort und Reverse Proxy

Das Passwort wird in der Oberfläche festgelegt; ENV enthält keine Passwortvorgabe. Das Datenvolume bei Updates beibehalten, damit Anmeldung und Einstellungen erhalten bleiben.


## Standardwerte und Info

Ohne ENV und gespeicherte Overrides verwendet die Oberfläche Englisch, Shift+Enter zum Senden, steuernde Folgenachrichten, `Codex-Host` als Anzeigenamen und das Projekt-Repository für Releases. Die Projektbasis stammt aus Codex-Metadaten; Zugangstoken sind leer. Die API-Adresse muss über ENV oder Einstellungen gesetzt werden. Compose kann die Weboberfläche schon vorher starten; die Verbindung bleibt bis zum Hinterlegen des Endpunkts offline.

Konfigurierte Umgebungswerte sind als **Umgebungswert** markiert. **Eigener Wert** kennzeichnet einen gespeicherten Override; **Standard verwenden** entfernt ihn. Die aufklappbaren ENV-Details zeigen den Rückfallwert. Eine bereits gespeicherte Sprachwahl bleibt bei Updates erhalten.

**Info** enthält die installierte Version und eine lesende GitHub-Releaseprüfung mit aktueller Versionsnummer und Veröffentlichungsdatum. Öffentliche Abfragen erfolgen ohne Anmeldung, Codex-Host-Befehl oder Docker-Zugriff. Zwischengespeicherte Ergebnisse reduzieren Wiederholungen; **Nach Updates suchen** fragt neu ab. Ein Token ist für private Repositorys oder ein höheres GitHub-Anfragelimit optional.
