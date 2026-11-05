# Fehlerbehebung

[English](en-Troubleshooting.md) · [Deutsche Startseite](de-Home.md)

## Oberfläche erreichbar, Codex offline

1. `CODEX_WS_URL` auf dem Web-Host prüfen. Ein Gateway braucht eine `ws://`- oder `wss://`-Adresse, keinen Dateipfad.
2. Erreichbarkeit des API-Ports vom Web-Container zum Codex-Host prüfen.
3. `CODEX_API_TOKEN` auf beiden Seiten vergleichen, ohne ihn in Protokolle oder Tickets zu kopieren.
4. Auf dem Codex-Host den Daemon und Socket kontrollieren:

```bash
codex app-server daemon version
readlink -f "$HOME/.codex/app-server-control/app-server-control.sock"
```

Der Gateway kann gesund sein, obwohl der Codex-Socket nicht erreichbar ist. Die angemeldete Oberfläche zeigt den tatsächlichen Verbindungszustand.

## Socket fehlt oder Zugriff verweigert

`CODEX_SOCKET_DIR` muss das Socket-Verzeichnis treffen. Bei einem absoluten Symlink zusätzlich den echten Zielpfad in `CODEX_RUNTIME_SOCKET_DIR` eintragen. UID/GID des Gateways müssen zum Codex-Benutzer und den Socket-Berechtigungen passen. Ein nicht vorhandenes Verzeichnis wird für diese Bind-Mounts nicht automatisch erstellt.

## Anmeldung funktioniert nicht

Beim ersten Start muss ein Passwort gesetzt werden. Nach einem Update muss dasselbe persistente Datenvolume verwendet werden. Eine veraltete Browsersitzung durch Neuladen beziehungsweise erneutes Anmelden ersetzen. Das App-Passwort ist unabhängig von Codex-Anmeldung und Gateway-Token.

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

## Keine Browserbenachrichtigungen

HTTPS oder localhost verwenden, Browserberechtigung prüfen und Hinweise in **Optionen & Version** aktivieren. Die Oberfläche muss geöffnet bleiben. Der Hinweiston benötigt eine Benutzerinteraktion; Hinweise in der App benötigen keine Desktop-Browserberechtigung.

## Versionsprüfung nicht verfügbar

Auf dem Codex-Host muss `gh` angemeldet sein. Alternativ einen lesenden `CODEX_GITHUB_TOKEN` für den Web-Container setzen. Bei einem Fork `CODEX_RELEASE_REPOSITORY` prüfen. Diese Prüfung liest nur Release-Metadaten und zieht keine Images.

## Verbindung hinter einem Proxy bricht ab

WebSocket-Upgrades, Host-Weitergabe und Verbindungszeitlimits des Proxys kontrollieren. Der Client baut Verbindungen erneut auf, wiederholt aber keine bereits gesendeten Aufträge. Einen unklar abgeschlossenen Auftrag zuerst im Verlauf prüfen, bevor er nochmals manuell gesendet wird.
