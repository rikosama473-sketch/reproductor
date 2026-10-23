import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.ok(!app.includes("\\nfunction render() {"), "The app must not contain a literal escaped newline before render()");
assert.match(app, /function render\(\)\s*\{/, "The main render function must parse as real JavaScript");
assert.match(app, /\}\)\);\s*\}\s*function renderTrackList\(/, "Delegated handlers must close before the next top-level renderer");
assert.match(app, /function setMobileMenuOpen\(open\)/, "Mobile drawer state must be controlled in one place");
assert.match(app, /setMobileMenuOpen\(false\)/, "The mobile drawer must close after choosing a section");
assert.match(app, /mobile-more-toggle/, "Every mobile section must remain reachable through the More tab");
assert.match(app, /window\.__ritmoAppReady = true/, "The app must report successful startup");
assert.match(html, /id="app-boot-error"/, "A startup syntax/load failure must display a visible recovery message");
assert.match(html, /id="app-boot-reload"/, "The startup error view must provide a reload action");
assert.match(html, /id="character-companion"/, "The animated character companion must be present on mobile");
assert.match(css, /\.character-companion\{[^}]*pointer-events:none/s, "The character must not block touch interactions");
assert.match(css, /\.character-companion\{[^}]*bottom:calc\(var\(--player\) \+ var\(--mobile-nav-height\)/s, "The companion must sit above the mobile player and navigation");
assert.match(html, /id="mobile-bottom-nav"/, "The HTML must include touch-first bottom navigation");
assert.match(html, /data-view="library"/, "The mobile bar must open the library");
assert.match(html, /data-view="favorites"/, "The mobile bar must open favorites");
assert.match(html, /id="mobile-more-toggle"/, "The mobile bar must provide access to secondary views");
assert.match(css, /touch-action:\s*manipulation/, "Tap controls must have touch-friendly action handling");
assert.match(css, /\.mobile-bottom-nav\s*\{[^}]*position:\s*fixed/s, "Mobile navigation must remain available at the bottom of the viewport");
assert.match(css, /\.mobile-sidebar-scrim:not\(\[hidden\]\)/, "The open drawer must have a functional touch backdrop");
assert.match(sw, /ritmo-shell-v83/, "The PWA must replace the shell cache after this fix");
console.log("Mobile touch, startup recovery and render-syntax regression checks passed.");
