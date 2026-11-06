# Prüfung vor einer Veröffentlichung

[English](publication.md)

Lokale Konfiguration gehört in `.env`, Zugangsdaten in die jeweilige Secret-Verwaltung. `.env`, SSH-Schlüssel, Laufzeitdaten, private Audit-Berichte und Testbilder werden weder versioniert noch in Release-Archive aufgenommen. Dokumentation verwendet `.example`-Hostnamen; die API-Zieladresse wird bei der Einrichtung ausdrücklich konfiguriert. Das Codex-Benutzerverzeichnis stammt aus der API-Verbindung.

## Aktueller Dateistand und Historie

```bash
npm run check:publication
node scripts/check-publication.mjs --history
gitleaks git --redact=100 --log-opts="--all"
```

Die erste Prüfung betrachtet den aktuellen Dateistand, die zweite alle über Branches und Tags erreichbaren Git-Blobs sowie Commit- und Tag-Metadaten. Der zusätzliche Secret-Scanner ist ein eigenes Werkzeug; siehe [Gitleaks](https://github.com/gitleaks/gitleaks). Berichte dürfen keine ungeschwärzten Schlüssel enthalten. Der eingebaute Check ist eine Regressionserkennung und ersetzt keine vollständige Prüfung auf Zugangsdaten.

Vor einer Veröffentlichung werden alle Branches und Tags sowie die daraus erzeugten Archive geprüft. Falls ein echter Schlüssel gefunden wird, muss er beim Anbieter widerrufen werden. Berichte und lokale Prüfdateien bleiben außerhalb der versionierten Quellen.

## Weitere Veröffentlichungsflächen

- Release-Beschreibungen, manuell hochgeladene Quellarchive, Docker-Downloads und ihre Prüfsummen prüfen. Sie ändern sich nicht automatisch mit einem neuen Commit oder Tag.
- Bei Docker-Images alle enthaltenen Anwendungsschichten, Image-Konfiguration, Labels und Build-Metadaten prüfen. Das aktuelle Dateisystem allein reicht nicht, wenn ein früherer Layer eine später entfernte Datei enthält.
- GHCR-Versionen, SHA-Tags und Build-Caches gesondert prüfen.
- GitHub-Actions-Protokolle und Artefakte sowie Issues, Pull Requests und weitere Git-Referenzen prüfen.
- GitHub-Repository und Registry-Package besitzen getrennte Zugriffsrechte. Nicht prüfbare Bereiche ausdrücklich im privaten Audit-Bericht nennen.

Projekt-URLs, die GHCR-Paketadresse und öffentliche GitHub-Noreply-Adressen identifizieren das Projekt beziehungsweise seine GitHub-Mitwirkenden. Sie sind keine lokale Installationskonfiguration. Für Forks sind `CODEX_VIEWPORT_IMAGE` und `CODEX_RELEASE_REPOSITORY` vorgesehen.

Das Bereinigen oder Prüfen löst kein Deployment aus. Die Änderung der Repository-Sichtbarkeit ist ein eigener, ausdrücklich freizugebender Schritt.

Build-Metadaten können vollständige GitHub-Ereignisse mit personenbezogenen Pusher-/Profildaten enthalten. Die Release-Pipeline deaktiviert diese Provenienz, Metadaten-Ausgabe, Build-Zusammenfassungen und Build-Aufzeichnungen. Der manuelle Registry-Metadatencheck zeigt ausschließlich Fundstellen; sein Bereinigungsmodus entfernt alte Provenienz-Versionen und erhält ausführbare Plattformen und Tags.

Das Löschen von Referenzen oder Image-Versionen kann alte Commits und Registry-Blobs über ihren Hash weiter abrufbar lassen. Der anonyme Zugriff auf diese alten Objekte muss gesondert geprüft werden. Öffentliche Pakete lassen sich bei GitHub nicht wieder privat stellen; zurückgehaltene Inhalte können das Zurückziehen des Pakets und eine Bereinigung durch den Anbieter erfordern. Eine dauerhafte Löschung darf nicht allein aus einer Versionslöschung abgeleitet werden.

`PUBLISH_CONTAINER=false` als Repository-Variable pausiert die Container-Veröffentlichung. Quellen und Release-Downloads bleiben davon unabhängig. Nach dem Zurückziehen eines Pakets müssen die alten Objekt-URLs erneut geprüft werden; ein späterer öffentlicher Neustart benötigt eine neue Prüfung von Historie, Caches und Registry-Namensräumen.
