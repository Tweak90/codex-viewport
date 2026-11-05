# Fehlerbehebung

[English](en-Troubleshooting.md) · [Deutsche Startseite](de-Home.md)

## Oberfläche erreichbar, Codex offline

1. `CODEX_WS_URL` auf die externe API-Adresse mit `ws://` oder `wss://` setzen.
2. DNS, Routing, Firewallfreigabe und API-Port vom Web-Container aus prüfen.
3. Falls die API eine Anmeldung verlangt, `CODEX_API_TOKEN` mit deren Konfiguration abgleichen.
4. Prüfen, ob der externe App Server läuft und ein Proxy WebSocket-Upgrades weiterleitet. Bei `wss://` zusätzlich Zertifikat und Hostname kontrollieren.

Die angemeldete Oberfläche zeigt den tatsächlichen API-Verbindungszustand. Ein gesunder Web-Container allein bestätigt noch nicht die Erreichbarkeit seiner externen API.

## Anmeldung funktioniert nicht

Beim ersten Start muss ein Passwort gesetzt werden. Nach einem Update muss dasselbe persistente Datenvolume verwendet werden. Eine veraltete Browsersitzung durch Neuladen beziehungsweise erneutes Anmelden ersetzen. Das App-Passwort ist unabhängig von Codex-Anmeldung und API-Token.

Das Entfernen des Datenvolumes setzt mehr als das Passwort zurück und ist kein normaler Update-Schritt.

## Projekt kann nicht angelegt werden

Der Zielpfad bezieht sich auf den Codex-Host. Der dortige Codex-Benutzer muss schreiben dürfen. Ohne gemeldetes Codex-Benutzerverzeichnis wird kein Standardpfad geraten. Bei Git-Importen müssen Git und Repository-Zugang auf diesem Host funktionieren.

## Chats fehlen in einer Liste

Projektzuordnung, Chatsuche und Archivfilter prüfen. Bei langen Listen weitere Chats nachladen. Leere Chats sind gespeicherte Entwürfe und können sich von bereits gestarteten Codex-Verläufen unterscheiden. Der Reiter **Chat** öffnet die Liste; einen Verlauf ausdrücklich auswählen.

## Bilder fehlen

Den Bildabruf über **Erneut laden** wiederholen. Prüfen, ob die Datei auf dem Codex-Host noch existiert oder Bildinhalt im Codex-Verlauf gespeichert ist. Die Galerie ist projektbezogen; eine geänderte Chat-Zuordnung kann auch die Bildzuordnung ändern. Die erste Erfassung großer Verläufe kann dauern.

Das Web-Logo wird direkt über `/assets/logo.png` geladen. Es ist keine Datei auf dem Codex-Host und wird deshalb nicht über `/api/media?path=…` abgerufen. Nach einem Update die Seite neu laden, damit die aktuelle Bildauflösung verwendet wird.

## Kontingente oder Kontext fehlen

Nur vom App Server verfügbare Angaben werden angezeigt. Browserpasswort, API-Verbindung und Codex-Anmeldung zuerst prüfen. Fehlende Werte werden nicht aus geschätzten Kontingenten ersetzt. Kontextwerte stammen aus Tokenmeldungen oder dem gespeicherten Codex-Verlauf.

## Versionsprüfung nicht verfügbar

Die Prüfung fragt GitHub standardmäßig direkt vom Web-Container ohne Anmeldung über HTTPS ab. Ein optionaler lesender `CODEX_GITHUB_TOKEN` unterstützt private Repositorys oder ein höheres Anfragelimit. Bei einem Fork `CODEX_RELEASE_REPOSITORY` prüfen. Diese Prüfung liest nur Release-Metadaten und zieht keine Images.

## Verbindung hinter einem Proxy bricht ab

WebSocket-Upgrades, Host-Weitergabe und Verbindungszeitlimits des Proxys kontrollieren. Der Client baut Verbindungen erneut auf, wiederholt aber keine bereits gesendeten Aufträge. Einen unklar abgeschlossenen Auftrag zuerst im Verlauf prüfen, bevor er nochmals manuell gesendet wird.

## Agent-Liste ist leer

Agents sind native Unteragenten mit dem Arbeitsverzeichnis des ausgewählten Projekts. Projekt, Such- und Statusfilter prüfen und weitere Einträge nachladen. Gelöschte oder nie gespeicherte Agent-Verläufe lassen sich nicht rekonstruieren. **Nicht geladen** beschreibt den nativen Laufzeitstatus und kein Abschlussresultat.
