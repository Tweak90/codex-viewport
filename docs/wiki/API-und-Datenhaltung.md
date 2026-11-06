# API und Datenhaltung

[English](en-API-and-data.md) · [Deutsche Startseite](de-Home.md)

## Zwei Schnittstellenebenen

Die Browser-API von Codex Viewport und das native App-Server-Protokoll sind getrennt. Der Webserver prüft Browseranmeldung und CSRF-Schutz, verwaltet eigene Metadaten und übersetzt Benutzeraktionen in erlaubte native RPC-Aufrufe.

| Browser-Endpunkt | Aufgabe |
| --- | --- |
| `/api/auth/*` | Einrichtung, Anmeldung, Sitzung und Abmeldung |
| `/api/settings` | Geschützte Instanzeinstellungen und ENV-Overrides |
| `/api/state` | Verbindungs- und Projektzustand |
| `/api/rpc` | Freigegebene native Methoden |
| `/api/projects` | Projektverwaltung |
| `/api/projects/:id/agents`, `/agents/:agentId` | Projektbezogene Agent-Liste und paginierte Ausgaben zum Lesen |
| `/api/projects/:id/files`, `/uploads`, `/download`, `/media` | Dateien, Anhänge und Galerie |
| `/api/chats/:id/questions` | Asynchrone Rückfragen und einmalige Antworten |
| `/api/chats/:id/history` | Paginierter Verlauf |
| `/api/chats/:id/composer`, `/context`, `/export` | Entwurf, Kontext und Markdown-Export |
| `/api/workbench`, `/api/pins` | Einstellungen und angepinnte Chats |
| `/api/search`, `/api/tasks`, `/api/version` | Suche, Aufgaben und Release-Metadaten |
| `/api/usage`, `/api/usage/reset` | Kontingente und bestätigte Rücksetzungen |
| `/events` | Ereignis-WebSocket zum Browser |
| `/healthz` | Öffentlicher Webserverstatus; angemeldet zusätzlicher Verbindungsstatus |

Die Tabelle zeigt Funktionsgruppen. Konkrete HTTP-Methoden, Eingaben und Prüfungen sind in `server.mjs` und `lib/work-routes.mjs` definiert.

## Native Codex-Kommunikation

Die Bridge initialisiert die Verbindung und verwendet die vom App Server gelieferten Modelle, Threads, Kontingente und Ereignisse. Anfragen enthalten Methode, Parameter und ID; Ereignisse können ohne ID eintreffen. Rückfragen behalten ihre native ID. Der Webserver besitzt eine explizite Liste erlaubter Methoden.

Wichtige Gruppen sind `thread/*`, `turn/*`, `account/*`, `fs/*` und `command/exec`. Projektdaten werden nicht über einen zusätzlichen Dateiserver bereitgestellt. Native Kommandos werden als Argumentlisten übergeben, damit Dateinamen nicht als Shell-Code interpretiert werden.

Eine Kontingent-Rücksetzung besitzt einen Idempotenzschlüssel und erfordert eine Bestätigung. Mutierende Aufträge werden nach einem Verbindungsabbruch nicht automatisch wiederholt.

## Speicherorte

| Ort | Inhalt |
| --- | --- |
| Web-Volume: `auth.json` | Gesalzener scrypt-Passwort-Hash |
| Web-Volume: `sessions.json` | Gehashte Sitzungstickets und Sitzungsdaten |
| Web-Volume: `settings.json` | Einstellungs-Overrides, einschließlich gesetzter API-/GitHub-Token |
| Web-Volume: `message-queue.json` | Zuständigkeit für Warteschlangeneinträge, Pausen und Startversuche |
| Web-Volume: `questions.json` | Rückfragetexte, Optionen und Versandstatus; Antworten liegen im nativen Verlauf |
| Web-Volume: `projects.json` | Projekt-IDs, Pfade, Zuordnungen, Vorgaben und Chat-Entwürfe |
| Web-Volume: `workbench.json` | Pins, Eingabeentwürfe, beobachtete Aufgaben und Kontextwerte |
| Web-Volume: `search-index.json` | Durchsuchbare Textinhalte und Fundstellen |
| Codex-Host | Native Chats, Anmeldung, Werkzeuge und Projektdateien |
| Projekt: `.codex-viewport/uploads/` | Hochgeladene Anhänge |
| Browser-Speicher | Darstellungswahl, Panelbreiten, Navigation und zwischengespeicherte Eingaben |

Die Web-Daten werden als JSON mit atomarem Dateiaustausch geschrieben. Schreibwarteschlangen verhindern, dass parallele Aktualisierungen dieselbe Datei unkontrolliert überschreiben. Die Ersteinrichtung des Passworts verwendet eine exklusive Dateianlage.

## Suche und Kontext

Der Suchindex wird aus paginierten Einträgen erstellt. Er speichert Text und Cursor der Fundstelle, keine großen binären Bildinhalte. Archivstatus und ausdrückliche Projektzuordnung werden berücksichtigt. Die erstmalige Indexierung läuft im Hintergrund und kann Zeit benötigen.

Kontextwerte stammen aus nativen Tokenmeldungen. Für bestehende Chats kann der zuletzt gespeicherte Tokenstand aus dem nativen Verlauf gelesen werden. Fehlende Werte bleiben unbekannt; sie werden nicht aus einer Modellannahme geschätzt.

## Geschützte Daten

Das Web-Volume enthält auch vertrauliche Eingaben und Suchtexte. Es gehört nicht in ein Release-Archiv. `.env`, lokale Schlüssel, Uploads und Testbilder sind ebenfalls ausgeschlossen. Hinweise zur Prüfung stehen unter [Sicherheit und Grenzen](Sicherheit-und-Grenzen.md).

## Asynchrone Rückfragen

Codex 0.166.0 liefert asynchrone Fragen in `agentMessage.questions`. Sie sind von synchronen `item/tool/requestUserInput`-Anfragen getrennt. Die Antwort wird mit ursprünglicher Call-ID und Fragenindex als strukturierte Benutzernachricht gesendet. Der Versandstatus wird vor dem mutierenden Aufruf reserviert. Bei Verbindungsabbruch bleibt er unbestätigt und blockiert erneutes automatisches Senden. Die Rückfragenansicht lädt Metadaten im Hintergrund in begrenzten Seiten.

Folgenachrichten verwenden optional `thread/queue/add` und `thread/queue/list`. Der Webserver startet ausschließlich eigene wartende Einträge über `thread/queue/start`, wenn der Chat frei ist. Fremde Einträge bleiben beim jeweiligen Client. Startversuche werden vor dem mutierenden Aufruf gespeichert; bei unklarem Ergebnis werden sie nicht wiederholt.
