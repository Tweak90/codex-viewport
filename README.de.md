<p align="center"><img src="public/assets/logo.png?v=blue-terminal" width="120" alt="Codex-Web Logo"></p>

# Codex-Web

**Codex im Browser: Projekte verwalten, Chats führen und auf einem eigenen Codex-Host arbeiten.**

[English](README.md) · [Wiki](https://github.com/Tweak90/codex-web/wiki) · [Dokumentation](docs/wiki/de-Home.md) · [Releases](https://github.com/Tweak90/codex-web/releases) · [Changelog](CHANGELOG.de.md)

Codex-Web ist eine selbstgehostete Oberfläche für einen vorhandenen Codex App Server. Der Web-Container verbindet sich ausschließlich über WebSocket mit einer externen Codex-API. Anmeldung, Werkzeuge und Projektdateien bleiben auf dem Codex-Host.

> **Dieses Projekt wurde vollständig mit KI entwickelt. Die Nutzung erfolgt auf eigene Gefahr.**

## Funktionen

- Echte Projektordner mit mehreren Chats, Projektvorgaben und Kontextmenüs.
- Live-Chats, Freigabe- und Rückfragedialoge, Archiv, Suche und gespeicherte Entwürfe.
- Projekt-Reiter **Agents** mit aktiven/bisherigen Agents und paginierten Ausgaben zum Nachlesen.
- Datei- und Bilduploads, Zwischenablage und Projektgalerien mit inhaltsbasierter Zusammenfassung identischer Bilder.
- Dateiexplorer, Editor, ZIP-Downloads, lesende Git-Ansicht und Konsole.
- Aufgabenübersicht, Kontext- und Kontingentanzeige.
- Helle und dunkle IDE-Ansicht, Desktop und Mobilgeräte, Deutsch und Englisch.
- Zahnrad-Menü mit Einstellungen, deren Vorrang gegenüber ENV-Werten klar angezeigt wird.

Standardmäßig fügt **Enter einen Zeilenumbruch** ein und **Shift+Enter sendet**. Diese Belegung lässt sich umkehren. Der Chat-Reiter zeigt die Chatliste; nach einem Reiterwechsel im selben Projekt kehrt er zum geöffneten Chat zurück.

Während der Erstellung eines neuen Chats gewählte Anhänge warten auf diesen Chat und bleiben ihm zugeordnet.

## Voraussetzungen

Ein angemeldeter, laufender Codex App Server (verifiziert mit **0.166.0**), Docker auf dem Web-Host und Netzwerkzugang zur Codex-API. Für die Projekt- und Dateiwerkzeuge werden Python 3 und Git auf dem Codex-Host benötigt.

## Fertiges Docker-Image starten

Das fertige Image `ghcr.io/tweak90/codex-web-ui:latest` für Linux/amd64 benötigt weder Git-Checkout noch eigenen Build. Öffentliche Pakete erfordern keine Registry-Anmeldung. Für eingeschränkte Pakete zuerst mit einem leseberechtigten Konto `docker login ghcr.io` ausführen.

Eine Datei `.env.web` anlegen:

```dotenv
CODEX_WS_URL=ws://codex-host.example:4500
CODEX_API_TOKEN=replace-with-your-api-token
HOST_LABEL=Codex-Host
```

```bash
docker volume create codex-web-data
docker pull ghcr.io/tweak90/codex-web-ui:latest
docker run -d --name codex-web --restart unless-stopped --init \
  -p 8787:8787 --env-file .env.web \
  -v codex-web-data:/data \
  ghcr.io/tweak90/codex-web-ui:latest
```

Beispielhostnamen und Token ersetzen (Token leer lassen, falls die API keinen verlangt), `http://web-host.example:8787` öffnen und ein Passwort mit mindestens vier Zeichen festlegen. Das Datenvolume bei Updates beibehalten.

Compose beschreibt die [Installationsanleitung](docs/wiki/Installation.md). [compose.image.yml](compose.image.yml) verwendet das fertige Image; [compose.yml](compose.yml) baut aus dem Quellcode.

## Updates und Einstellungen

`latest` neu laden und den Container mit derselben Umgebungsdatei und demselben Volume ersetzen. Die [Update-Anleitung](docs/wiki/Betrieb-und-Updates.md) enthält die vollständigen Docker-Befehle. Updates führt der Betreiber aus.

**Einstellungen** öffnet das Zahnrad in der schmalen Aktivitätsleiste unter den beiden Kontingent-Prozentwerten. Der Dialog gliedert sich in **Allgemeine Einstellungen**, **Codex-Einstellungen** und **Updates**. ENV-Details sind pro Feld aufklappbar; Speichern und Abbrechen bleiben sichtbar. **Leeres Feld: ENV gilt. Ausgefülltes Feld: Einstellung hat Vorrang.** Geheime Werte bleiben verborgen; **Standard verwenden** entfernt einen gespeicherten Override. Ports, Mounts und Image-Auswahl werden in Docker/Compose eingerichtet. Siehe [Konfiguration](docs/wiki/Konfiguration.md).

Ohne ENV und gespeicherte Overrides gelten Englisch, Shift+Enter zum Senden, steuernde Folgenachrichten und der Name `Codex-Host`. Das Release-Repository ist dieses Projekt. Vorhandene ENV-Werte werden in den Einstellungen markiert und können dort überschrieben werden. Die externe API-Adresse wird über ENV oder Einstellungen gesetzt; Zugangstoken bleiben optional, wenn die API keinen verlangt.

**Info → Nach Updates suchen** liest GitHub-Releases direkt über HTTPS, standardmäßig ohne Anmeldung. Angezeigt werden Updateverfügbarkeit, Versionsnummer und Release-Datum. Docker-Zugriff und Installation finden dabei nicht statt. Unter dem Kontingent-Symbol stehen zwei Prozentwerte für das verbleibende 5-Stunden- und Wochenkontingent.

## Dokumentation und Entwicklung

Das [Wiki](https://github.com/Tweak90/codex-web/wiki) beginnt mit einer Sprachauswahl. Es behandelt Einrichtung, Benutzung, Fehlerbehebung, Architektur, APIs, Datenhaltung und Techstack. Alle Seiten sind auch [direkt im Repository](docs/wiki/Home.md) auf Deutsch und Englisch verfügbar.

```bash
npm ci
CODEX_WS_URL=ws://codex-host.example:4500 npm start
npm test
npx playwright install chromium
npm run test:browser
npm run check:docs
npm run check:i18n
npm run check:publication
```

Für lokale Entwicklung ist Node.js ab Version 22 nötig. Weitere Informationen: [Techstack und Entwicklung](docs/wiki/Techstack-und-Entwicklung.md). Die Oberfläche ist ein eigenständiges Projekt und kein offizielles OpenAI-Produkt.
