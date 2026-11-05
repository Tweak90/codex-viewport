# Changelog

[English](CHANGELOG.md)

## 1.0.1 — 2026-11-05

- Englisch und sinnvolle Anwendungsvorgaben ohne ENV; klare Herkunftsmarkierung und gespeicherte Overrides.
- Info ersetzt den Optionsdialog; Benachrichtigungen, Hinweiston und Panel-Reset entfallen.
- Updateprüfung öffentlicher GitHub-Releases direkt und ohne Anmeldung vom Web-Container, mit Version und Release-Datum; keine Hostbefehle oder Docker-Zugriffe.
- Kontingent-Kurzanzeige in der Aktivitätsleiste mit verbleibenden Prozentwerten für fünf Stunden und die Woche.
- Einstellungen ausschließlich links über den Kontingenten, gegliedert in Allgemeine Einstellungen, Codex-Einstellungen und Updates.
- Klare Feldbeschreibungen, aufklappbare ENV-Details, Tastaturbedienung und dauerhaft sichtbares Speichern/Abbrechen erhalten Eingaben beim Bereichswechsel.
- Verbindung ausschließlich zur externen WebSocket-API; lokale Anbindung, Host-Startwerkzeuge und zugehörige Konfiguration/Beispiele entfernt. Entfallene gespeicherte Einstellungen werden automatisch bereinigt.
- Projekt-Reiter Agents mit aktiven und bisherigen Agents, archivierten Verläufen, Suche/Statusfilter, übergeordneten Chats und paginierten Ausgaben ohne Auftragsstart.
- Neues blaues Terminal-Logo mit transparentem Hintergrund in Oberfläche, Chat, Favicon und Dokumentation; UI-Verweise aktualisieren zwischengespeicherte Bilder.
- Geöffnete Auswahlmenüs verwenden in beiden Themes lesbare Vorder- und Hintergrundfarben.
- README, Wiki, Architektur und Installation auf Deutsch und Englisch an die externe API-Anbindung angepasst.

## 1.0.0 — 2026-11-05

Erste Veröffentlichung der eigenständigen Codex-Web-Oberfläche.

- Anbindung an eine vorhandene Codex-App-Server-API.
- Passwortanmeldung, echte Projektordner, mehrere Chats, Archiv, Suche und gespeicherte Entwürfe.
- Deutsche und englische Oberfläche, helle/dunkle IDE-Ansicht und Mobilgeräte.
- Zahnrad-Menü mit Vorrang gespeicherter Einstellungen vor ENV, wählbarer Enter-Belegung und Folgenachrichten über Steuern oder Warteschlange.
- Native Warteschlange und Rückfragedialoge mit ausdrücklicher Antwort und Versandstatus.
- Datei-/Bilduploads, Bilder im Chat, Projektgalerien mit SHA-256-Zusammenfassung, Editor, Konsole und ZIP-Downloads.
- Kontingente mit bestätigten Rücksetzungen, Kontext, Projektvorgaben, Aufgaben und optionale Hinweise.
- Reiter kehren im selben Projekt zum geöffneten Chat zurück; ein anderes Projekt zeigt zunächst seine Chatliste.
- Docker-/Compose-Anleitung, persistente Volumes, zweisprachige Wiki-Quellen und Entwicklerdokumentation.
- Veröffentlichtes zweisprachiges GitHub-Wiki mit Sprachauswahl, Logo und direkten Links zu Installation, Benutzung und technischen Details.
- Neutrale Git-Metadaten ohne Autoren-E-Mail-Adressen; Images enthalten keine Build-Ereignis-Provenienz.
