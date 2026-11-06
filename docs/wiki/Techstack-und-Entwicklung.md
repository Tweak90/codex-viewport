# Techstack und Entwicklung

[English](en-Tech-stack-and-development.md) · [Deutsche Startseite](de-Home.md)

## Verwendete Technik

| Bestandteil | Technik und Aufgabe |
| --- | --- |
| Laufzeit | Node.js ab Version 22, ES-Module |
| Webserver | Node `http`, Authentifizierung und eigene REST-Endpunkte |
| Transport | `ws` für die externe WebSocket-API |
| Oberfläche | HTML, CSS, JavaScript ohne Frontend-Framework |
| Markdown | `marked` zum Rendern, DOMPurify zum Bereinigen |
| Passwortschutz | Node `crypto`, scrypt und zufällige Sitzungstickets |
| Datenhaltung | JSON-Dateien mit atomarem Austausch im Web-Volume |
| Host-Werkzeuge | Python 3 und Git über die native App-Server-API |
| Verpackung | Docker, Node-22-Debian-Slim und Compose |
| Tests | Node-Test-Runner sowie Playwright mit Chromium |
| Veröffentlichung | GitHub Actions, GHCR und Release-Dateien mit SHA-256-Prüfsummen |

Die konkreten npm-Versionen stehen in `package.json` und `package-lock.json`. Es gibt keinen Frontend-Bundler und keine zusätzliche Datenbank.

## Quellcode-Übersicht

| Datei | Verantwortung |
| --- | --- |
| `server.mjs` | HTTP-Server, Anmeldung, Browser-API und Ereignisse |
| `lib/settings.mjs` | Gespeicherte Overrides, ENV-Vorrang und Validierung |
| `lib/message-queue.mjs` | Native Warteschlange und einmalige Startversuche |
| `lib/questions.mjs` | Asynchrone Rückfragen und Versandstatus |
| `public/i18n.js`, `public/locales/en.json` | Oberfläche auf Deutsch und Englisch |
| `lib/bridge.mjs` | Native RPC-Verbindung, Anfragen und Wiederverbindung |
| `lib/auth.mjs` | Passwörter, Sitzungen und Herkunftsprüfung |
| `lib/projects.mjs` | Projekt- und Chatzuordnungen, Vorgaben und Löschschutz |
| `lib/history.mjs` | Verlaufspaginierung |
| `lib/media.mjs` | Galerie und historische Bildauflösung |
| `lib/files.mjs` | Dateiaktionen, Uploads und ZIP |
| `lib/workbench.mjs` | Entwürfe, Pins, Aufgaben und Kontextwerte |
| `lib/search.mjs` | Volltextindex und Markdown-Export |
| `lib/releases.mjs` | Lesende GitHub-Releaseprüfung |
| `lib/work-routes.mjs` | Zusätzliche authentifizierte Endpunkte |
| `public/app.js` | Navigation und vorhandene Chat-/Projektoberfläche |
| `public/features.js` | Anhänge, Suche, Aufgaben und weitere Workbench-Funktionen |
| `public/style.css` | IDE-Darstellung und responsive Layouts |

## Lokal entwickeln

```bash
npm ci
CODEX_WS_URL=ws://codex-host.example:4500 npm start
```

`CODEX_API_TOKEN` bei Bedarf über die eigene Umgebung für die externe API setzen. Private Werte gehören nicht in eingecheckte Beispieldateien.

## Tests

```bash
npm test
npx playwright install chromium
npm run test:browser
npm run check:publication
npm run check:docs
npm run check:i18n
node --check public/app.js
```

Die Browserprüfungen starten einen eigenen mockbasierten Server und temporäre Projektordner. Sie verbrauchen keine Modellanfragen. Tests dürfen keine echten Kontingent-Rücksetzungen ausführen und keine Produktivpasswörter einrichten oder ersetzen. `TEST_BASE_URL` und `TEST_PASSWORD` sind ausschließlich für eine ausdrücklich ausgewählte separate Testinstanz vorgesehen.

## Docker-Build

```bash
docker compose --env-file .env.example config --quiet
docker build -t codex-viewport:dev .
```

Ein Versionstag löst den Release-Workflow aus. Er führt Tests aus und veröffentlicht das Image unter Versions- und `latest`-Tags. Manuelle Release-Downloads enthalten zusätzlich ein Docker-Archiv und Prüfsummen. Das ist von einem Deployment getrennt.

## Dokumentation pflegen – für Mitwirkende

Die Wiki-Quellen liegen unter `docs/wiki/`. `npm run check:docs` prüft interne Seitenlinks. Für ein bereits initialisiertes GitHub-Wiki dessen Git-Repository auschecken und die Seiten exportieren:

```bash
git clone https://github.com/Tweak90/codex-viewport.wiki.git ../codex-viewport.wiki
node scripts/sync-wiki.mjs ../codex-viewport.wiki
git -C ../codex-viewport.wiki add --all
git -C ../codex-viewport.wiki commit -m "Update documentation"
git -C ../codex-viewport.wiki push
```

Das Wiki-Repository muss außerhalb der Anwendung oder in einem ignorierten lokalen Verzeichnis liegen. Das Exportskript entfernt die `.md`-Endung aus internen Wiki-Seitenlinks; im Hauptrepository bleiben sie als normale Dateilinks nutzbar.

README, Changelog und Release-Notizen besitzen englische und deutsche Fassungen. Die Wiki-Startseite verweist auf `en-Home.md` beziehungsweise `de-Home.md`. Beide Sprachen müssen bei Verhaltensänderungen mitgepflegt werden. UI-Übersetzungen betreffen eigene Bedienelemente; Nachrichten, Dateinamen und Projektinhalte werden nicht umgeschrieben.

`lib/agents.mjs` und `public/agents.js` ergänzen projektbezogene Agent-Listen und lesenden Zugriff auf Ausgaben. Die Einstellungen verwenden drei Bereiche mit tastaturbedienbaren Reitern und dauerhaft sichtbaren Aktionen. Auswahloptionen übernehmen die Theme-Farben auch im geöffneten Menü.
