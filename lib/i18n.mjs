import { readFile } from "node:fs/promises";
const english = JSON.parse(await readFile(new URL("../public/locales/en.json", import.meta.url), "utf8"));
export const translate = (text, language) => language === "en" && typeof text === "string" ? english[text] ?? english[text.replace(/\s+/g, " ").trim()] ?? text : text;
