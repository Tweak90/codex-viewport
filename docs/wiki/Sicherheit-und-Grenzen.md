# Sicherheit und Grenzen

[English](en-Security-and-limitations.md) · [Deutsche Startseite](de-Home.md)

> **Dieses Projekt wurde vollständig mit KI entwickelt. Die Nutzung erfolgt auf eigene Gefahr.**

## Zugriff und Berechtigungen

Das Browserpasswort schützt die Steuerungs-API, Bilder und Ereignisse. Es wird als gesalzener scrypt-Hash gespeichert. Sitzungen verwenden zufällige Tickets; serverseitig liegen ihre Hashes. Mutierende Browseraufrufe benötigen einen CSRF-Token und werden auf Herkunft geprüft.

Die externe Codex-API kann einen eigenen Bearer-Token verlangen. Eine App-Sitzung und der API-Token sind unterschiedliche Zugänge.

Gespeicherte API-Token und GitHub-Token stehen nur in `settings.json` im geschützten Web-Volume und werden in API-Antworten nicht offengelegt. Wer das Webpasswort kennt, kann die gemeinsamen Instanzeinstellungen ändern.

Die Oberfläche kann Codex-Aufträge und Host-Werkzeuge ausführen. Die dort gewählten Codex-Berechtigungen und Freigaben sind zu beachten; insbesondere Verwaltungsbefehle auf dem Host besitzen reale Dateisystemwirkung. Web-Passwort und Pfadprüfungen sind keine zusätzliche isolierte VM. Netzwerkzugang, TLS und Zugriff auf den Codex-Endpunkt gehören zur Betriebsumgebung.

## Dateien und Löschung

Dateiaktionen prüfen den kanonischen Projektpfad und verhindern das Verlassen des Projekts. Separat verwaltete Unterprojekte bleiben geschützt. Projektordner werden nur mit ausdrücklicher Option und Bestätigung gelöscht; Systempfade und laufende Aufgaben werden berücksichtigt.

Die endgültige Löschung hat keinen Papierkorb. Das Entfernen eines Anhangs aus einer Nachricht löscht dagegen die Datei nicht.

## Funktions- und Größenlimits

| Funktion | Grenze oder Bedingung |
| --- | --- |
| Verlauf | Zunächst 20 gespeicherte Einträge pro Seite |
| Anhänge | Höchstens 20 pro Nachricht |
| Datei-Upload | Höchstens 25 MB pro Datei |
| Datei-/ZIP-Download | Höchstens 50 MB |
| ZIP-Erstellung | Höchstens 5.000 Dateien und 100 MB unkomprimierter Inhalt |
| Galerie | Höchstens 2.000 Bilder pro Projekt |
| Suchergebnisse | Höchstens 100 angezeigte Treffer; Gesamtzahl und Indexfortschritt werden angezeigt |
| App-Server-Kompatibilität | Verifiziert mit Codex 0.166.0 |

Modellverfügbarkeit, Kontingente und Rücksetzungsrechte stammen aus der vorhandenen Codex-Anmeldung. Die Oberfläche erfindet keine fehlenden Kontingentwerte. Bestimmte Freigaben können weiterhin an den Client gebunden sein, der den Auftrag ursprünglich gestartet hat.

Eingebettete Plugin-Oberflächen und Computer-Use-Ansichten der offiziellen App sind nicht vollständig nachgebildet. Zusätzliche Git-Commit-/Push-/Branch-Bedienung, Git-Worktrees und ein Papierkorb gehören nicht zum Funktionsumfang. Die lesende Git-Ansicht und Git-Optionen bei der Projektanlage sind enthalten.

## Veröffentlichung und vertrauliche Daten

Persönliche Pfade, private Netzadressen, Schlüssel, `.env`, Runtime-Daten, Uploads und Testbilder gehören nicht ins Repository oder in Release-Archive. Die Prüfungen untersuchen den Dateistand und auf Wunsch die erreichbare Historie; ein Muster-Scan kann unbekannte oder verschlüsselte Zugangsdaten nicht sicher ausschließen. Bei einem echten Schlüsselfund ist der Schlüssel beim Anbieter zu widerrufen.

Die [Veröffentlichungsprüfung im Repository](https://github.com/Tweak90/codex-viewport/blob/main/docs/publication.md) beschreibt die zusätzlichen Artefakt- und Historienprüfungen. Unbekannte Prüfbereiche müssen als solche dokumentiert werden.
