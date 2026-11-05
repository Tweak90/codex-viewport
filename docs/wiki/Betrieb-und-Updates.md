# Betrieb und Updates

[English](en-Operations-and-updates.md) · [Deutsche Startseite](de-Home.md)

## Persistente Daten

Der Web-Container benötigt das Volume `console-data` unter `/data`. Es enthält Anmeldung, Sitzungen, Projektzuordnungen, Nachrichtenentwürfe, Einstellungen, offene Rückfragen und Suchindex. Der tatsächliche Docker-Volumename hängt vom Compose-Projektnamen ab.

Chats und Projektdateien liegen auf dem Codex-Host. Uploads werden dort unter `.codex-web/uploads/` im jeweiligen Projekt gespeichert. Das Schließen des Browsers oder Neustarten des Web-Containers beendet keine Codex-Aufgabe auf diesem Host.

## Fertiges Docker-Image aktualisieren

Für den Container aus der Installationsanleitung zuerst das neue Image laden, dann den Container unter Beibehaltung des Volumes ersetzen:

```bash
docker pull ghcr.io/tweak90/codex-web-ui:latest
docker stop codex-web
docker rm codex-web
docker run -d --name codex-web --restart unless-stopped --init \
  -p 8787:8787 --env-file .env.web \
  -v codex-web-data:/data \
  ghcr.io/tweak90/codex-web-ui:latest
```

Keine Option zum Löschen von Volumes verwenden. `.env.web` und `codex-web-data` müssen dieselben sein wie bei der Einrichtung. Nach dem Start die Browserseite neu laden.

Für Compose:

```bash
docker compose -f compose.image.yml pull
docker compose -f compose.image.yml up -d
```

`latest` ist ein veränderliches Tag. Ein explizites `pull` lädt die aktuelle Fassung; ein laufender Container übernimmt sie erst bei seiner Neuerstellung. Ein festes Versionstag bleibt bei dieser Version. Die Versionsanzeige in Codex-Web prüft Releases und führt selbst keine Updates aus.

Passwort und Einstellungen bleiben im Datenvolume. Werte aus den Einstellungen haben weiterhin Vorrang vor geänderten ENV-Werten, bis das betreffende Feld geleert beziehungsweise auf **ENV verwenden** zurückgesetzt wird.

## Updates aus Quellcode

Im ausgecheckten Projekt:

```bash
git pull --ff-only
docker compose up -d --build
```

Den Gateway nur dann aktualisieren, wenn dessen Änderungen benötigt werden:

```bash
docker compose -f compose.gateway.yml up -d --build
```

Das startet den Gateway neu. Der unabhängig laufende Codex-Daemon wird dadurch nicht ersetzt.

## Sicherungen

Web-Volume und Daten des Codex-Hosts sind getrennt zu sichern. Das Web-Volume kann vertrauliche Nachrichtenentwürfe, Suchindex und Passwortdaten enthalten. Für eine konsistente Dateisicherung den Webserver während des Kopierens anhalten oder eine dafür geeignete Snapshot-Lösung verwenden.

Zum Wiederherstellen die Web-Daten unter demselben Volume-Mount bereitstellen und die passende Host-Konfiguration setzen. Projektpfade müssen auf dem Codex-Host wieder erreichbar sein. Bestehende Zuordnungen enthalten absolute Hostpfade.

Das Löschen des Web-Volumes entfernt unter anderem das eingerichtete Browserpasswort. Ein normaler Image-Pull benötigt diese Löschung nicht.

## Diagnose

```bash
docker compose ps
docker compose logs --tail=100 web
```

Auf dem Codex-Host entsprechend `-f compose.gateway.yml` und den Dienst `gateway` verwenden. Protokolle vor dem Weitergeben auf vertrauliche Inhalte prüfen.

Der öffentliche Web-Endpunkt `/healthz` bestätigt nur den Webserver. Mit einer angemeldeten Sitzung ergänzt er den Verbindungsstatus. Der Gateway-Healthcheck prüft ebenfalls nur seinen eigenen Webserver.

## Release-Artefakte

Releases enthalten Quellcode, ein Docker-Image für Linux/amd64 und `SHA256SUMS`. Prüfsummen vor einem lokalen Image-Import prüfen. Die Tag-Pipeline veröffentlicht außerdem feste Versions- und `latest`-Tags in GHCR.
