# Architektur

[English](architecture.md)

## Komponenten

```mermaid
flowchart LR
    B[Browser] -->|Angemeldete HTTP-Aufrufe| W[Webserver]
    W -->|Ereignisse via /events| B
    W -->|JSON-RPC über WebSocket| C[Externer Codex App Server]
    C --> F[Projektdateien und Werkzeuge]
    W --> D[Web-Datenvolume]
```

`server.mjs` liefert HTML, JavaScript und CSS aus. Steuerungsanfragen laufen authentifiziert über den Webserver. Der Browser verbindet sich nicht direkt mit dem Codex-Host und hält keine OpenAI-Anmeldedaten.

`lib/bridge.mjs` hält die gemeinsame Verbindung zur externen Codex-App-Server-API über `ws://` oder `wss://`. Ein konfigurierter Bearer-Token wird beim Verbindungsaufbau übertragen. Der Web-Container enthält nur den Webclient, keinen Codex-Prozess und keine Projektdatei- oder Docker-Mounts.

## Ein Auftrag vom Browser bis zum Modell

1. Der Benutzer öffnet oder erstellt einen Chat innerhalb eines Projekts.
2. Ein leerer Chat wird zunächst als Web-Entwurf gespeichert.
3. Beim ersten Senden wird über `thread/start` der native Verlauf angelegt.
4. `turn/start` übermittelt Text und gegebenenfalls Bildpfade; weitere Anweisungen verwenden je nach Einstellung `turn/steer` oder die native Warteschlange.
5. Ereignisse aktualisieren Nachrichten, Aktivitäten, Aufgaben und Rückfragen.
6. Freigaben und Antworten werden mit der ursprünglichen Anfrage-ID zurückgeschickt.
7. Abschließende Ereignisse ergänzen Verlauf und Status.

Der Browser kann geschlossen werden, während Codex auf dem Host weiterarbeitet.

## Verbindung und Fehler

RPC-Antworten werden anhand ihrer IDs zugeordnet. Jede Transportverbindung besitzt eine Generation; verspätete Antworten älterer Verbindungen werden verworfen. WebSocket-Pings erkennen unterbrochene Verbindungen. Offene Aufrufe werden bei einem Abbruch abgewiesen, nicht erneut abgesendet. Nach der Wiederverbindung werden beobachtete Chats erneut abonniert.

Das ist kein automatisches Wiederholen eines Arbeitsauftrags. Bei einem unklaren Ergebnis muss zunächst der bestehende Verlauf geprüft werden.

## Große Verläufe und Bilder

`lib/history.mjs` liefert höchstens 20 gespeicherte Einträge pro Seite. `thread/items/list` liest Einträge, `thread/turns/list` ergänzt begrenzte Status-Metadaten. Ein Kompatibilitätsweg liest bei älteren Speichern einzelne Arbeitsdurchläufe statt des gesamten Chats.

Generierte Bilddaten werden aus diesen Seiten entfernt und gesondert über den authentifizierten Bild-Endpunkt geladen. Im Browser bleiben bereits angezeigte Bilder bei weiteren Ausgaben erhalten. Anfragen sind an die jeweilige Ansicht gebunden; verspätete Ergebnisse ersetzen keinen inzwischen ausgewählten Chat oder ein anderes Projekt.

## Datei- und Projektaktionen

Native Dateischnittstellen übernehmen Lesen und Schreiben. Verzeichnis-, Git-, ZIP- und Verwaltungsaktionen verwenden zusätzlich `command/exec` auf dem Codex-Host. Python prüft kanonische Projektpfade und schützt separat verwaltete Unterprojekte. Größere Dateiübertragungen laufen in Blöcken unterhalb der Nachrichtengrenzen. Temporäre ZIP- und Upload-Dateien werden nach Abschluss entfernt.

## Herkunft und Kompatibilität

Das Projekt wurde vollständig mit KI entwickelt. Oberfläche, Bridge, Tests und Konfiguration wurden für dieses Projekt erstellt. Zur Recherche wurden die offizielle API-Dokumentation und Protokollschemata der installierten Codex-Version verwendet. Die Architektur eines anderen öffentlichen Codex Viewport-Projekts wurde zur Einordnung gelesen; daraus wurden keine Quellcodedateien oder UI-Assets übernommen. Das aktuelle Logo wurde vom Nutzer bereitgestellt; Details stehen in der Branding-Dokumentation des Repositorys.

Verifiziert ist Codex 0.166.0. Änderungen am App-Server-Protokoll erfordern eine erneute Kompatibilitätsprüfung. Die [offizielle Dokumentation](https://learn.chatgpt.com/docs/app-server) beschreibt den App Server und seine Transportschnittstellen.

Gespeicherte Einstellungen überschreiben ENV-Werte, solange sie nicht leer sind. Rückfrageantworten und Warteschlangenstarts speichern den Versandstatus vor dem Aufruf. Unbestätigte mutierende Aufrufe werden nicht erneut gesendet. Die Galerie fasst identische Dateien per SHA-256 zusammen und lässt interne Runtime-/Audit-Verzeichnisse aus.

## Projekt-Agents

`lib/agents.mjs` listet native Unteragenten des gewählten Projekts über `thread/list`, einschließlich archivierter Verläufe. Ihr Arbeitsverzeichnis muss zum Projekt passen. Ausgaben verwenden dieselben Verlaufsseiten mit 20 Einträgen wie Chats; beim Lesen wird kein Agent fortgesetzt oder gestartet. `public/agents.js` ergänzt Filter, Verknüpfungen zum übergeordneten Chat und regelmäßige Aktualisierung von Status und Ausgaben während der Anzeige. Der Laufzeitstatus wird unverändert dargestellt; ein nicht geladener Agent gilt nicht automatisch als abgeschlossen.
