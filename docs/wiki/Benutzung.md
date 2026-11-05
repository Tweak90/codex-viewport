# Benutzung

[English](en-Usage.md) · [Deutsche Startseite](de-Home.md)

## Oberfläche

Die Seitenleiste enthält Projekte, Archiv, Kontingente und die Chatsuche. **Neuer Chat** steht unter der Chatsuche. In der Mitte wechseln die Reiter **Übersicht**, **Chat** und **Bilder** die Projektansicht.

- **Übersicht**: Projektinformationen, Chatliste und Bildvorschau.
- **Chat**: Chatliste mit **Neuen Chat starten** oberhalb der vorhandenen Chats. Der Reiter legt keinen Chat an. Beim Wechsel zwischen Übersicht, Bildern und Chat innerhalb desselben Projekts kehrt er zum zuletzt geöffneten Chat zurück. Ein Projektwechsel setzt diese Rückkehr zurück.
- **Bilder**: Galerie des ausgewählten Projekts.

Die obere Aktionsleiste bietet Kontext, Darstellungswechsel und Abmelden. Dateien, lesende Git-Ansicht und Konsole sind in der Werkzeugleiste erreichbar; auf Mobilgeräten im aufklappbaren Seitenmenü. Das Zahnrad unter den Kontingent-Prozentwerten der schmalen Aktivitätsleiste öffnet **Einstellungen** mit Sprache, Eingabeverhalten und Anwendungskonfiguration. Der Info-Dialog mit Versionsinformationen ist von dort sowie über die Versionsanzeige erreichbar.

## Projekte

Über das Plus bei **Projekte** ein Projekt anlegen:

| Aktion | Verhalten auf dem Codex-Host |
| --- | --- |
| Nur lokal anlegen | Erstellt Ordner einschließlich fehlender Elternordner |
| Git erstellen | Erstellt zusätzlich ein Git-Repository |
| Git klonen | Klont ein Repository mit den Git-Zugängen des Codex-Benutzers |
| Vorhandenes Verzeichnis | Verwendet einen bestehenden Ordner |

Projektmenüs bieten Umbenennen, Galerie, Vorgaben und Löschen. Der Ordner bleibt beim Löschen standardmäßig erhalten. Das ausdrückliche Mitlöschen erfordert eine Namensbestätigung. Laufende Aufgaben, geschützte Pfade und enthaltene separat verwaltete Projekte verhindern die Ordnerlöschung.

Projektvorgaben legen Modell, Denkaufwand und zusätzliche Anweisungen fest. Modell und Denkaufwand sind Vorgaben für neue Chats. Projektanweisungen ergänzen beim Start oder erneuten Öffnen die vorhandenen Codex-Vorgaben.

## Chats und Eingabe

Einen vorhandenen Chat aus der Liste auswählen oder ausdrücklich einen neuen starten. Neue leere Chats bleiben zunächst Entwürfe; erst das Senden startet einen nativen Codex-Verlauf.

| Taste | Aktion |
| --- | --- |
| Enter | Zeilenumbruch, standardmäßig |
| Shift+Enter | Nachricht senden, standardmäßig |
| Strg/Cmd+K | Neuen Chat starten |
| Strg/Cmd+Shift+F | Volltextsuche |
| Strg/Cmd+S | Geöffnete Datei speichern |

Die Enter-Belegung kann im Zahnrad-Menü umgekehrt werden: Enter sendet dann, Shift+Enter fügt eine neue Zeile ein. Deutsch und Englisch stehen dort ebenfalls zur Auswahl.

Ungesendeter Text und Anhänge bleiben beim Chatwechsel und Neuladen gespeichert. Die Nachricht kann auch über **Senden** abgeschickt werden. Für Folgenachrichten während der Arbeit lässt sich im Zahnrad-Menü **Steuern** oder **Warteschlange** wählen. Die native Codex-Warteschlange bleibt beim Schließen des Browsers erhalten und wird oberhalb der Eingabe angezeigt. Nach einem fehlgeschlagenen oder gestoppten Auftrag pausiert der automatische Start, bis ein neuer Auftrag beginnt. Rückfrageantworten werden unabhängig von dieser Auswahl direkt übertragen. Während Codex arbeitet, lassen sich weitere Anweisungen senden; **Stoppen** unterbricht den laufenden Auftrag.

Chats öffnen zunächst mit den neuesten 20 Einträgen. Hochscrollen oder **Ältere Nachrichten laden** lädt weitere Seiten und hält die Leseposition. Lange Befehle und Ausgaben sind aufklappbar.

Rechtsklick oder **⋯** öffnet Chataktionen wie Umbenennen, Projektzuordnung, Anpinnen, Export und Archivieren. **Weitere Chataktionen** enthält unter anderem das Abzweigen eines Verlaufs. Rückfragen öffnen einen Dialog mit Auswahloptionen und Freitext. Eigener Text hat Vorrang vor einer Auswahl. **Später beantworten** schließt den Dialog; **Rückfragen** links öffnet offene Fragen erneut. Antworten werden erst durch **Antwort senden** übertragen und der ursprünglichen Frage zugeordnet. Beantwortete Fragen bleiben nach Neuladen als beantwortet erkennbar. Bei unbestätigtem Versand erfolgt keine automatische Wiederholung; zuerst den Chatverlauf prüfen. Freigaben erscheinen weiterhin im Chat; unbekannte Rückfragetypen können eine JSON-Antwort erfordern.

## Dateien und Anhänge

Die Büroklammer, Drag-and-drop oder Bild-Paste laden Anhänge in das Projekt. Höchstens 20 Anhänge je Nachricht und 25 MB je Datei. Bilder werden als native Bildeingabe übergeben, andere Dateien mit ihrem Pfad auf dem Codex-Host. Das Entfernen eines Anhangs aus der Nachricht löscht die hochgeladene Datei nicht.

Im Dateiexplorer lassen sich Dateien und Ordner erstellen, umbenennen, verschieben, herunterladen und nach Namensbestätigung endgültig löschen. Der Editor prüft beim Speichern auf zwischenzeitliche Änderungen. Ordnerdownloads werden als ZIP erzeugt; Grenzen stehen unter [Sicherheit und Grenzen](Sicherheit-und-Grenzen.md).

## Bilder und Archiv

Die Galerie zeigt Bilder des ausgewählten Projekts sowie generierte Bilder und Screenshots seiner Chats. Ausdrückliche Chat-Zuordnungen haben Vorrang vor dem ursprünglichen Arbeitsverzeichnis. Verschachtelte, eigenständig verwaltete Projekte besitzen eigene Galerien. Fehlgeschlagene Chatbilder bieten einen erneuten Abruf. Hochgeladene Bilder erscheinen ohne zusätzlichen `[Bild]`-Platzhalter. Identische Bilddateien werden projektbezogen anhand von SHA-256 zusammengefasst, auch unter unterschiedlichen Namen. Interne Runtime-, Cache- und Audit-Verzeichnisse werden beim Ordnerscan ausgelassen.

Im Archiv lassen sich Chats lesen, gesammelt wiederherstellen oder endgültig löschen. Lesen setzt sie nicht automatisch fort. Wurde der Projektordner entfernt, muss vor dem Wiederherstellen ein passendes Projekt zugeordnet werden.

## Suche, Aufgaben und Kontingente

Die Volltextsuche erfasst Nachrichten und Aktivitäten einschließlich Archiv, wahlweise mit Projektfilter. Die erste Indexierung läuft im Hintergrund. Ein Treffer öffnet und markiert die passende Verlaufsstelle.

**Aufgaben** zeigt laufende und zuletzt bearbeitete Chats mit Status, Laufzeit, Fehlern und Stoppen. Optionale Hinweise und Ton gelten bei geöffneter Oberfläche.

**Kontingente** zeigt die von Codex gelieferten Nutzungsfenster und verfügbaren Rücksetzungen. Eine Rücksetzung wird nur nach ausdrücklicher Bestätigung angefordert. Die Kontextanzeige beschreibt dagegen Tokens im Chatkontext und beobachtete Komprimierungen; sie ist kein Kontingentmesser.

## Agents

Der Reiter **Agents** zeigt aktive und bisherige Unteragenten des ausgewählten Projekts. Statusfilter und Suche grenzen Name, Rolle und Auftrag ein. Ein Agent öffnet seine Ausgaben, Befehle und Werkzeugergebnisse. Zunächst werden die letzten 20 Einträge geladen; **Ältere Ausgaben laden** zeigt den früheren Verlauf. **Übergeordneten Chat öffnen** führt zur Unterhaltung, die den Agent gestartet hat. Status und gespeicherte Ausgaben werden während der Anzeige aktualisiert. Beim Lesen wird kein Auftrag gestartet oder fortgesetzt.

**Nicht geladen** ist ein nativer Laufzeitstatus und kein Nachweis eines erfolgreichen Abschlusses. Archivierte Agents bleiben mit gespeichertem Verlauf lesbar. Agents mit dem Arbeitsverzeichnis eines anderen Projekts werden getrennt angezeigt.

## Info und Kontingent-Kurzanzeige

**Info** zeigt die installierte Version. **Nach Updates suchen** liest nur GitHub-Releases; eine neue Version wird mit Versionsnummer und Veröffentlichungsdatum angezeigt. Docker-Zugriff und Installation sind dafür nicht nötig. Benachrichtigungen, Hinweiston und eine Schaltfläche zum Zurücksetzen der Panelgrößen gehören nicht zum Dialog.

Unter dem Kontingent-Symbol der schmalen Aktivitätsleiste zeigt der obere Prozentwert das verbleibende 5-Stunden-Kontingent, der untere das verbleibende Wochenkontingent. Fehlende Daten erscheinen als Strich; Werte werden nicht erfunden. Ein Klick öffnet die vollständige Kontingentanzeige.

Einstellungen und Kontingente besitzen keine eigenen Einträge im breiten Projektmenü. Auf Mobilgeräten sind die beiden Funktionen als kompakte Symbole im geöffneten Menü erreichbar.
