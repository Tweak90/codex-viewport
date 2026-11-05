import { readFile } from "node:fs/promises";
const dictionary = JSON.parse(await readFile(new URL("../public/locales/en.json", import.meta.url), "utf8"));
const normalize = (text) => text.replace(/\s+/g, " ").trim();
let references = 0;
const missing = new Set();
for (const file of ["app.js", "features.js", "settings.js", "questions.js", "queue.js", "agents.js"]) {
  const source = await readFile(new URL(`../public/${file}`, import.meta.url), "utf8");
  for (const match of source.matchAll(/I18N\.t\(("(?:[^"\\]|\\.)*")\)/g)) {
    references++;
    const key = normalize(JSON.parse(match[1]));
    if (!dictionary[key]?.trim()) missing.add(key);
  }
}
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const texts = [...html.matchAll(/>([^<>]+)</g)].map((match) => normalize(match[1]));
const attributes = [...html.matchAll(/(?:title|placeholder|aria-label|alt)="([^"]+)"/g)].map((match) => normalize(match[1]));
for (const text of [...texts, ...attributes])
  if (/[äöüßÄÖÜ]|\b(?:Projekt|Projekte|Passwort|Datei|Dateien|Speichern|Abbrechen|Nachricht|Verbindung|Kontingente|Senden|Anmelden|Abmelden|Bilder|Nur|Kein|Dein|DEIN|DEINE|Antwort|Aktualisieren|Konsole|Bestätigen|Denkaufwand|Angezeigte|Verzeichnis|Werkzeuge|Einstellungen)\b/.test(text) && !dictionary[text]) missing.add(text);
for (const key of Object.keys(dictionary)) if (!dictionary[key]?.trim()) missing.add(key);
for (const key of missing) console.error(`Missing English translation: ${key}`);
console.log(`${Object.keys(dictionary).length} translations, ${references} UI references, ${missing.size} missing.`);
process.exitCode = missing.size ? 1 : 0;
