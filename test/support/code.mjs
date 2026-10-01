import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);

// A repository file's text, by its path from the repository root.
export function source(path) {
  return readFileSync(new URL(path, ROOT), "utf8");
}

// Formatting-neutral source: comment lines go, whitespace runs become one
// space with none just inside brackets, and trailing commas go, so a check
// reads the same however Prettier wraps the code.
export function flat(code) {
  return code
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/,(\s*[)\]}])/g, "$1")
    .replace(/([([]) | ([)\]])/g, "$1$2");
}
