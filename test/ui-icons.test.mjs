import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
test("the scene opens About through the text button and keeps Contact inside the estate", async () => {
  const html = flatHtml(await readFile(new URL("index.html", root), "utf8"));
  const entry = html.match(/<button[^>]*class="[^"]*scene-entry"[\s\S]*?<\/button>/)[0];
  assert.match(entry, /data-panel="about"/);
  assert.match(entry, /aria-controls="panel-about"/);
  assert.match(entry, /aria-label="About"/);
  assert.match(entry, / hidden>/);
  assert.match(entry, /<span class="about-link__label">About<\/span>/);
  assert.doesNotMatch(entry, /<img|<canvas/);
  assert.match(html, /href="#about-text"[^>]*data-scene-fallback>[\s\S]*?about-link__label/);
  const primary = html.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)[0];
  assert.doesNotMatch(primary, /data-panel="contact"|nav-contact/);
  for (const name of ["profile", "experience", "contact"]) {
    assert.ok(html.includes(`aria-controls="panel-${name}"`));
  }
});

test("estate destinations are labeled HTML buttons in keyboard order without floating icons", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const map = html.match(/<nav class="estate-destinations"[\s\S]*?<\/nav>/)[0];
  const destinations = [...map.matchAll(/data-panel="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(destinations, ["profile", "experience", "contact"]);
  assert.doesNotMatch(map, /<img|<canvas/);
  for (const name of destinations) {
    assert.ok(map.includes(`aria-controls="panel-${name}"`));
    assert.ok(map.includes(`<span>${name[0].toUpperCase() + name.slice(1)}</span>`));
  }
});

// Formatting-neutral markup, so a check reads the same before and after
// Prettier: whitespace runs become one space, and none sits beside a tag's
// angle brackets.
function flatHtml(text) {
  return text.replace(/\s+/g, " ").replace(/ ?([<>]) ?/g, "$1");
}
