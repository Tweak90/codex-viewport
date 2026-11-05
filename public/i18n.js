"use strict";
globalThis.I18N = (() => {
  let language = localStorage.getItem("codex.language") === "de" ? "de" : "en";
  let english = {};
  const texts = [], attributes = [], capturedTexts = new WeakSet(), capturedElements = new WeakSet();
  const t = (text) => {
    if (language !== "en" || typeof text !== "string") return text;
    const translated = english[text] ?? english[text.replace(/\s+/g, " ").trim()];
    return translated === undefined ? text : text.match(/^\s*/)[0] + translated + text.match(/\s*$/)[0];
  };
  function capture(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!capturedTexts.has(node) && !node.parentElement?.closest("script,style,pre,code,textarea")) {
        capturedTexts.add(node);
        const original = node.textContent;
        texts.push({ node, original });
      }
    }
    for (const element of root.querySelectorAll("[title],[placeholder],[aria-label],[alt]")) {
      if (capturedElements.has(element)) continue;
      capturedElements.add(element);
      for (const name of ["title", "placeholder", "aria-label", "alt"])
        if (element.hasAttribute(name)) attributes.push({ element, name, original: element.getAttribute(name) });
    }
  }
  function apply() {
    document.documentElement.lang = language;
    for (const { node, original } of texts) if (node.isConnected) {
      const key = original.trim();
      node.textContent = key ? original.replace(key, t(key)) : original;
    }
    for (const { element, name, original } of attributes)
      if (element.isConnected) element.setAttribute(name, t(original));
  }
  function html(value) {
    // This helper is only for the saved static welcome markup, never user messages.
    const template = document.createElement("template");
    template.innerHTML = value;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const original = node.textContent, key = original.trim();
      if (key) node.textContent = original.replace(key, t(key));
    }
    return template.innerHTML;
  }
  capture(document.body);
  const ready = fetch("/locales/en.json").then(async (response) => {
    if (!response.ok) throw new Error("Translation catalog unavailable.");
    english = await response.json();
  });
  return {
    t, html, capture, ready,
    get language() { return language; },
    get locale() { return language === "en" ? "en-GB" : "de-DE"; },
    async setLanguage(value) {
      await ready;
      language = value === "en" ? "en" : "de";
      localStorage.setItem("codex.language", language);
      apply();
    },
  };
})();
