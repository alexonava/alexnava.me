import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const categories = ["profile", "experience", "contact"];

test("three distinct transparent paper vignettes share the 200 KiB section-paper budget", async () => {
  let total = 0;
  for (const name of ["paper-grain.webp", "paper-edge.webp"]) {
    total += (await readFile(new URL(`images/${name}`, root))).length;
  }
  const hashes = new Set();
  for (const category of categories) {
    const bytes = await readFile(new URL(`images/paper-vignette-${category}.webp`, root));
    total += bytes.length;
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.equal(bytes.toString("ascii", 12, 16), "VP8X");
    assert.ok(bytes[20] & 0x10, `${category} must preserve transparency`);
    assert.equal(bytes.readUIntLE(24, 3) + 1, 420);
    assert.equal(bytes.readUIntLE(27, 3) + 1, 420);
    hashes.add(createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal(hashes.size, 3, "each category must have its own illustration");
  assert.ok(total <= 200 * 1024, `shared paper and vignettes use ${total} bytes`);
});

test("each child dialog owns one decorative noninteractive vignette without changing menu destinations", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  for (const category of categories) {
    const start = html.indexOf(`id="panel-${category}"`);
    const next = html.indexOf('class="panel-overlay"', start + 1);
    const panel = html.slice(start, next === -1 ? undefined : next);
    const decoration = panel.match(/<div class="panel-vignette [^"]+"[^>]*>/g) || [];
    assert.equal(decoration.length, 1, `${category} requires one decorative illustration`);
    assert.ok(decoration[0].includes(`panel-vignette--${category}`));
    assert.ok(decoration[0].includes('aria-hidden="true"'));
    assert.doesNotMatch(decoration[0], /tabindex|role=|data-panel|aria-label/);
    assert.ok(panel.includes('aria-label="Back to About"'));
    assert.ok(panel.includes(`id="panel-${category}-title"`));
  }
  const menu = html.match(/<nav class="estate-destinations"[\s\S]*?<\/nav>/)[0];
  assert.deepEqual(
    [...menu.matchAll(/data-panel="([^"]+)"/g)].map((match) => match[1]),
    categories,
  );
  assert.doesNotMatch(menu, /panel-vignette|<img|<canvas/);
});
