// The docs against the tree: links and anchors, the module map, the test-file
// list, the README's command table and the asset byte tables.

import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { source } from "./support/code.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DOCS = [
  "README.md",
  "AGENTS.md",
  "SECURITY.md",
  ...readdirSync(path.join(ROOT, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => "docs/" + name),
];

// A repository text file, with LF line endings.
function read(relative) {
  return source(relative).replace(/\r\n/g, "\n");
}

// Repository files under a folder, recursively, as POSIX paths from the root.
function walk(folder) {
  return readdirSync(path.join(ROOT, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = folder + "/" + entry.name;
    return entry.isDirectory() ? walk(relative) : [relative];
  });
}

// Whether a POSIX path from the root exists with exactly this spelling: GitHub
// matches case, even where the file system does not.
function existsExactly(relative) {
  let folder = ROOT;
  for (const part of relative.split("/").filter(Boolean)) {
    let names;
    try {
      names = readdirSync(folder);
    } catch {
      return false;
    }
    if (!names.includes(part)) return false;
    folder = path.join(folder, part);
  }
  return true;
}

// A file's size in bytes. Text files count with LF endings, which
// .gitattributes keeps in every checkout.
function bytes(relative) {
  const data = readFileSync(path.join(ROOT, relative));
  if (!/\.(txt|svg)$/.test(relative)) return data.length;
  return Buffer.byteLength(data.toString("utf8").replace(/\r\n/g, "\n"));
}

// Markdown with its fenced code blocks blanked.
function withoutFences(markdown) {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^ {0,3}(```|~~~)/.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n");
}

// GitHub's heading ids: lower case, punctuation dropped except - and _, each
// space a -, and a repeated id numbered -1, -2 and so on.
function headingSlugs(markdown) {
  const slugs = new Set(),
    occurrences = new Map();
  for (const [, text] of withoutFences(markdown).matchAll(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*$/gm)) {
    // Inline HTML drops out of the id; strip until nothing is left to strip, so a
    // tag rebuilt by an earlier pass is stripped too.
    let plain = text.replace(/[ \t]+#+$/, "").replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"),
      previous;
    do {
      previous = plain;
      plain = plain.replace(/<[^>]*>/g, "");
    } while (plain !== previous);
    const base = plain
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
      .replace(/ /g, "-");
    let slug = base;
    while (occurrences.has(slug)) {
      occurrences.set(base, occurrences.get(base) + 1);
      slug = base + "-" + occurrences.get(base);
    }
    occurrences.set(slug, 0);
    slugs.add(slug);
  }
  return slugs;
}

// Every link destination outside code: inline links and images, and
// reference definitions.
function linkTargets(markdown) {
  const text = withoutFences(markdown).replace(/``.+?``|`[^`\n]*`/g, "");
  return [
    ...[...text.matchAll(/!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g)],
    ...[...text.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)],
  ].map((match) => match[1]);
}

// The lines of a section, from its heading to the next heading of its level
// or above.
function section(markdown, heading) {
  const lines = markdown.split("\n");
  const level = heading.match(/^#+/)[0].length;
  const start = lines.indexOf(heading);
  assert.ok(start >= 0, `no "${heading}" heading`);
  const end = lines.findIndex(
    (line, index) => index > start && new RegExp(`^#{1,${level}} `).test(line),
  );
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

// The Markdown tables among some lines: each one's header cells and rows' cells.
function tables(lines) {
  const found = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith("|")) continue;
    const block = [];
    while (index < lines.length && lines[index].startsWith("|")) block.push(lines[index++]);
    index--;
    const [header, , ...rows] = block.map((row) =>
      row
        .replace(/^\||\|$/g, "")
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
    found.push({ header, rows });
  }
  return found;
}

// 1234567 as 1,234,567.
function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

test("every relative link in the docs resolves, and every #anchor names a heading there", () => {
  const failures = [],
    slugs = new Map();
  for (const doc of DOCS) {
    const markdown = read(doc);
    for (const target of linkTargets(markdown)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      const hash = target.indexOf("#");
      const file = decodeURIComponent(hash < 0 ? target : target.slice(0, hash));
      const anchor = hash < 0 ? null : decodeURIComponent(target.slice(hash + 1));
      const resolved = file
        ? path.posix.normalize(path.posix.join(path.posix.dirname(doc), file))
        : doc;
      if (!file && anchor === null) {
        failures.push(`${doc}: an empty link`);
        continue;
      }
      if (resolved.startsWith("../") || !existsExactly(resolved)) {
        failures.push(`${doc}: ${target} names no file (${resolved})`);
        continue;
      }
      if (anchor === null) continue;
      if (resolved.endsWith(".md")) {
        if (!slugs.has(resolved)) slugs.set(resolved, headingSlugs(read(resolved)));
        if (!slugs.get(resolved).has(anchor))
          failures.push(`${doc}: ${target} names no heading in ${resolved}`);
      } else if (!/^L\d+(C\d+)?(-L\d+(C\d+)?)?$/.test(anchor)) {
        failures.push(`${doc}: ${target} anchors into a file that is not Markdown`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("the module map in Architecture lists exactly the scripts in src/", () => {
  const listed = [];
  let base = "";
  for (const line of section(read("docs/ARCHITECTURE.md"), "## Module map")) {
    // Each table's bold label names its folder, or none for the repository root.
    if (/^\*\*.+\*\*$/.test(line)) base = line.match(/`([^`]+\/)`/)?.[1] ?? "";
    const file = line.match(/^\| `([^`]+)` +\|/)?.[1];
    if (file) listed.push(path.posix.normalize(path.posix.join(base, file)));
  }
  assert.equal(new Set(listed).size, listed.length, "a file listed twice");
  for (const file of listed) assert.ok(existsExactly(file), `${file} does not exist`);
  assert.deepEqual(
    listed.filter((file) => file.endsWith(".js")).sort(),
    walk("src")
      .filter((file) => file.endsWith(".js"))
      .sort(),
  );
});

test("the test-file table in Testing lists exactly the test files", () => {
  const [table] = tables(section(read("docs/TESTING.md"), "## Test files"));
  assert.deepEqual(table.header, ["File", "Guards"]);
  const listed = table.rows.map(([cell]) => {
    const [, label, file] = cell.match(/^\[([^\]]+)\]\(\.\.\/test\/([^)]+)\)$/) ?? [];
    assert.ok(file, `${cell} is not a link to a test file`);
    assert.equal(label + ".test.mjs", file, `${cell}: the label names another file`);
    return file;
  });
  assert.deepEqual(
    listed.sort(),
    readdirSync(path.join(ROOT, "test"))
      .filter((name) => name.endsWith(".test.mjs"))
      .sort(),
  );
});

test("the README's command table lists exactly the package.json scripts", () => {
  const { scripts } = JSON.parse(read("package.json"));
  const [table] = tables(section(read("README.md"), "## Work locally"));
  assert.deepEqual(table.header, ["Command", "Purpose"]);
  const listed = table.rows.map(([cell]) => {
    const [, run, lifecycle] = cell.match(/^`npm (?:run ([\w:-]+)|(test|start))`$/) ?? [];
    assert.ok(run || lifecycle, `${cell} is not an npm script command`);
    return run ?? lifecycle;
  });
  assert.equal(new Set(listed).size, listed.length, "a script listed twice");
  assert.deepEqual(listed.sort(), Object.keys(scripts).sort());
  // Elsewhere, every `npm run NAME` names a script, and "`npm …` runs `…`" its command.
  for (const doc of DOCS) {
    const markdown = withoutFences(read(doc));
    for (const [, name] of markdown.matchAll(/`npm run ([\w:-]+)[^`]*`/g))
      assert.ok(name in scripts, `${doc}: npm run ${name} is not a script`);
    for (const [, run, lifecycle, command] of markdown.matchAll(
      /`npm (?:run ([\w:-]+)|(test|start))` runs `([^`]+)`/g,
    ))
      assert.equal(
        command,
        scripts[run ?? lifecycle],
        `${doc}: ${run ?? lifecycle} runs another command`,
      );
  }
});

test("the byte tables in Assets match the files they list", () => {
  const markdown = read("docs/ASSETS.md");
  const sizes = new Map();
  for (const heading of markdown.match(/^## .+$/gm)) {
    const lines = section(markdown, heading);
    for (const { header, rows } of tables(lines)) {
      const column = header.indexOf("Bytes");
      if (column < 0) continue;
      // The section opens with its folder (or a file in it) in backticks.
      const opening = lines.find((line) => line.trim()).match(/^`([^`]+)`/)?.[1];
      assert.ok(opening, `${heading}: the byte table's section names no folder`);
      const folder = opening.endsWith("/") ? opening.slice(0, -1) : path.posix.dirname(opening);
      for (const row of rows) {
        const file = folder + "/" + row[0].match(/^`([^`]+)`$/)?.[1];
        assert.ok(existsExactly(file), `${heading}: ${row[0]} is not in ${folder}/`);
        assert.equal(row[column], grouped(bytes(file)), `${file} bytes`);
        sizes.set(file, bytes(file));
      }
    }
  }
  // Files named in the text with their size, "`path` (N bytes".
  for (const [, file, size] of withoutFences(markdown).matchAll(/`([^`]+)` \(([\d,]+) bytes/g)) {
    assert.ok(existsExactly(file), `${file} does not exist`);
    assert.equal(size, grouped(bytes(file)), `${file} bytes`);
    sizes.set(file, bytes(file));
  }
  // Every image, model, map and font the repository holds is listed.
  for (const file of [
    ...walk("images"),
    ...walk("fonts"),
    ...walk("public").filter((name) => /\.(png|ico|svg|webp|jpe?g)$/.test(name)),
  ])
    assert.ok(sizes.has(file), `${file} is in no byte table`);

  // The budgets: each limit's bytes, and each current total from the files.
  const [budgets] = tables(section(markdown, "## Budgets"));
  const [limit, now] = ["Limit", "Now"].map((name) => budgets.header.indexOf(name));
  const sum = (files) => files.reduce((total, file) => total + sizes.get(file), 0);
  const models = (tier) => [...sizes.keys()].filter((file) => file.endsWith(`-${tier}.glb`));
  const [slateTable] = tables(section(markdown, "## Slate maps"));
  const tierColumn = slateTable.header.indexOf("Tier");
  const slateTier = new Map(
    slateTable.rows.map((row) => [
      "images/materials/" + row[0].replaceAll("`", ""),
      row[tierColumn],
    ]),
  );
  const slates = (tier) =>
    [...slateTier].filter(([, own]) => own === tier || own === "both").map(([file]) => file);
  const largest = (tier) => {
    const file = models(tier).sort((a, b) => sizes.get(b) - sizes.get(a))[0];
    return `${grouped(sizes.get(file))} (${path.posix.basename(file, `-${tier}.glb`)})`;
  };
  const current = [
    [/^Any one model, (high|balanced)$/, (tier) => largest(tier)],
    [
      /^Complete scene, (high|balanced)\b/,
      (tier) => grouped(sum([...models(tier), ...slates(tier)])),
    ],
    [
      /^Paper grain, paper edge and the three vignettes$/,
      () => grouped(sum([...sizes.keys()].filter((file) => /^images\/paper-/.test(file)))),
    ],
    [
      /^Both estate maps$/,
      () => grouped(sum([...sizes.keys()].filter((file) => /^images\/estate-map-/.test(file)))),
    ],
    [/^`public\/og\.png`$/, () => grouped(sizes.get("public/og.png"))],
  ];
  for (const row of budgets.rows) {
    const units = row[limit].match(/^(\d+) (KiB|MiB) \(([\d,]+)\)/);
    if (units)
      assert.equal(
        units[3],
        grouped(Number(units[1]) * (units[2] === "KiB" ? 1024 : 1024 * 1024)),
        `${row[0]}: limit bytes`,
      );
    if (!row[now]) continue;
    const rule = current.find(([pattern]) => pattern.test(row[0]));
    assert.ok(rule, `${row[0]}: no rule here derives its current size`);
    assert.equal(row[now], rule[1](row[0].match(rule[0])[1]), `${row[0]}: now`);
  }
});
