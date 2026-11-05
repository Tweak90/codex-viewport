# Architektur

## Aufteilung

`server.mjs` liefert die eigene Browseroberfläche aus. Er hält eine gemeinsame Verbindung zum Codex-Dienst; Browser erhalten dessen Ereignisse über `/events` und senden API-Aufträge über `/api/rpc`. Projektverknüpfungen liegen als JSON im Docker-Volume. Browser halten keine OpenAI-Anmeldedaten.

`lib/bridge.mjs` implementiert das dokumentierte JSON-RPC-Protokoll. Antworten werden anhand ihrer IDs dem Aufruf zugeordnet. Freigabeanfragen von Codex behalten ihre ursprüngliche ID. Aufträge werden bei Verbindungsfehlern abgewiesen und **nicht wiederholt**. Jede Verbindung hat eine eigene Generation; verspätete Nachrichten einer alten Verbindung werden verworfen. Nach einem Neuaufbau werden beobachtete Chats vor dem Bereitschaftssignal wieder abonniert. WebSocket-Pings erkennen Verbindungsabbrüche.

`GET /api/chats/:id/history` liefert über `lib/history.mjs` höchstens 20 gespeicherte Einträge je Seite. Die native Abfrage `thread/items/list` läuft absteigend mit einem Fortsetzungs-Cursor; `thread/turns/list` mit `itemsView: notLoaded` ergänzt nur Status-Metadaten. Diese werden begrenzt zwischengespeichert. Generierte Bildinhalte bleiben im Codex-Speicher und werden über den Bild-Endpunkt abgerufen. Für Speicher ohne Item-Paginierung wird jeweils ein einzelner Arbeitsdurchlauf geladen und innerhalb seiner Einträge weitergeblättert; `thread/read` mit vollständigem Verlauf wird nicht verwendet. Die nativen Methoden beschreibt die [offizielle OpenAI-Dokumentation](https://learn.chatgpt.com/docs/app-server).

Der Browser öffnet Chat-Metadaten lesend und zeigt die erste Verlaufsseite unabhängig von `thread/resume`. Die Verbindung für Live-Ereignisse wird parallel hergestellt; Senden wartet auf deren Erfolg. Archivierte Chats werden nicht fortgesetzt. Ein Anfrage- und Ansichtswechselzähler verwirft verspätete Seiten. Beim Voranstellen älterer Einträge wird ein sichtbarer Eintrag als Scrollanker erhalten; Seiten desselben Arbeitsdurchlaufs werden anhand ihrer Item-IDs zusammengeführt.

`gateway.mjs` läuft auf der KI-VM und überträgt WebSocket-Nachrichten unverändert zum Control-Socket des bereits laufenden Codex-Daemons. Es führt selbst keine Projektbefehle aus. Der optionale Bearer-Token wird beim WebSocket-Handshake geprüft. Ein Docker-Image enthält beide Rollen; Compose startet jeweils den passenden Einstiegspunkt.

Alle Projektpfade beziehen sich auf die KI-VM. Der Dateibrowser benutzt `fs/readDirectory`, `fs/readFile` und `fs/writeFile`; Git und Konsole benutzen `command/exec`. So bleiben die Projektverzeichnisse ausschließlich auf dem Codex-Host.

## Laufzeiten und Grenzen

Eine Passwortanmeldung schützt alle Steuerungs-APIs, Bilddateien und den Ereignis-WebSocket. `auth.json` enthält einen gesalzenen scrypt-Hash; Sitzungen werden über zufällige HttpOnly-Cookies identifiziert, serverseitig nur gehasht gespeichert und bei mutierenden Aufrufen durch einen CSRF-Token ergänzt. Die Ersteinrichtung setzt kein Standardpasswort.

`lib/projects.mjs` verwaltet stabile Projekt-IDs, Projektpfade, Chat-Zuordnungen und leere Chat-Entwürfe. Historische Desktop-Chats werden beim Auflisten anhand ihres Arbeitsverzeichnisses zugeordnet. Ein gelöschtes Projekt taucht durch alte Chats nicht automatisch wieder auf. Die Ordnerlöschung läuft erst nach Namensbestätigung und Prüfung auf laufende Aufgaben, geschützte Pfade und enthaltene weitere Projekte.

`lib/media.mjs` indexiert Bilddateien im Projekt, im Codex-Verzeichnis für generierte Bilder und anhand der gespeicherten Bildpfade aus Chatverläufen. Bilddaten werden über die authentifizierte Weboberfläche vom App-Server gelesen. Es wird kein zusätzlicher Dateiserver auf der KI-VM benötigt.

Der Codex-Daemon lebt unabhängig von Browser, Web-Container und Gateway. Ein geschlossener Browser stoppt keine Agentenaufgabe. Beim Neustart des Web-Containers bleiben Chatdaten und Aufgaben auf der KI-VM erhalten; der Browser öffnet den betreffenden Chat erneut. Verbindungsspezifische Freigaben können nach einem vollständigen Verbindungswechsel vom ursprünglichen Client abhängen. Standalone-Konsolenbefehle haben ein Zeitlimit von zehn Minuten und sind keine dauerhaften Hintergrundjobs.

Die Weboberfläche bietet die implementierten API-Funktionen, keine vollständige Nachbildung aller Ansichten der offiziellen Codex-App. Computer-Use-Ansichten und eingebettete MCP-Plugin-Oberflächen sind nicht enthalten. Für unbekannte Rückfragetypen steht ein JSON-Antwortfeld zur Verfügung.

## Technische Recherche

Als Grundlage dient die [offizielle App-Server-Dokumentation](https://learn.chatgpt.com/docs/app-server) zusammen mit den aus der installierten Codex-Version generierten Protokollschemata.

Ergänzend wurden die README und Architekturbeschreibung von [0-99/codex-web-docker](https://github.com/0-99/codex-web-docker) gelesen. Nützliche Themen im Vergleich waren die Trennung von Web-Frontend und langlebigem App-Server, Verbindungsgenerationen, die Behandlung offener Requests und explizite Versionskompatibilität. Es wurden keine Quelldateien, Patches, Desktop-Bundles oder UI-Assets daraus übernommen. Unsere Oberfläche, Bridge, Gateway, Tests und Docker-Konfiguration wurden eigenständig implementiert.

## Workbench-Daten

`lib/workbench.mjs` speichert Pins, Nachrichtenentwürfe, Benachrichtigungseinstellungen, beobachtete Aufgaben und Kontextwerte atomar in `workbench.json`. `lib/search.mjs` baut beim Suchen einen dauerhaften Index aus paginierten Chat-Einträgen auf; Treffer enthalten den Cursor der passenden Verlaufsseite. Binäre Bilddaten werden nicht indexiert. Archivstatus und ausdrückliche Projektzuordnungen werden bei der Suche berücksichtigt.

`lib/files.mjs` führt Dateiaktionen und ZIP-Erstellung auf der KI-VM aus. Pfade werden gegen den kanonischen Projektpfad geprüft; separat verwaltete Unterprojekte bleiben geschützt. Uploads nutzen binäre HTTP-Anfragen und die native Dateischnittstelle. Download-ZIPs werden temporär erstellt und anschließend entfernt.

`lib/work-routes.mjs` bündelt die authentifizierten Workbench-Endpunkte. `public/features.js` ergänzt Entwürfe, Uploads, Suche, Aufgaben, Kontextwerte, Projektvorgaben und Versionsinformationen, ohne die bisherigen Chat-Ansichten zu ersetzen. GitHub-Releases werden lesend über die vorhandene gh-Anmeldung auf der KI-VM oder einen optionalen serverseitigen Token geprüft. Der Web-Container bekommt keinen Docker-Socket und löst keine Deployments aus.
