// Build-time compaction of the scene's GLSL. esbuild minifies JavaScript but
// keeps template literal text verbatim, so every shader ships with its source
// indentation and comments. Inside template literals that hold GLSL only (a
// literal whose text names gl_FragColor, void main, #include, #ifdef or #endif,
// or declares a uniform, varying, float, vec or mat), each line loses its leading whitespace and any // comment
// that ends inside the same text run, and blank lines are dropped. Newlines stay,
// so preprocessor directives still start their lines. ${} expressions, strings,
// comments and regular expressions in the JavaScript around them pass through.

const GLSL_MARKER =
  /gl_FragColor|#include|#ifn?def|#endif|void main|\b(?:uniform|varying|float|vec[234]|mat[234])\s/;
// A "/" after one of these starts a regular expression, not a division.
const REGEX_AFTER = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
const REGEX_AFTER_WORD = new Set([
  "return",
  "typeof",
  "case",
  "do",
  "else",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "yield",
  "await",
]);

// Spaces beside GLSL punctuation carry no meaning, except where removing them
// would join two tokens: "- -", "+ +", "/ /", "/ *" and "* /" keep theirs.
// Spaces at the edge of a text run touch a ${} expression and always stay.
const PUNCTUATION = /[=+\-*/<>!&|?:,;(){}[\]]/;
function collapseSpaces(line) {
  return line.replace(/[ \t]+/g, (space, offset) => {
    const left = line[offset - 1],
      right = line[offset + space.length];
    if (left === undefined || right === undefined) return space;
    if (!PUNCTUATION.test(left) && !PUNCTUATION.test(right)) return space;
    if ("+-".includes(left) && "+-".includes(right)) return space;
    if ((left === "/" && "/*".includes(right)) || (left === "*" && right === "/")) return space;
    return "";
  });
}

function compactText(parts) {
  return parts.map((part, index) => {
    if (typeof part !== "string") return part;
    const lines = part.split("\n");
    const kept = [];
    lines.forEach((line, j) => {
      const closed = j < lines.length - 1; // a newline follows in this run
      // A run's first line continues after a ${} expression: its indentation
      // is not leading whitespace.
      let text = j > 0 || index === 0 ? line.replace(/^[ \t]+/, "") : line;
      if (closed) text = text.replace(/[ \t]*\/\/.*$/, "");
      if (!text.startsWith("#")) text = collapseSpaces(text);
      // Drop lines left empty, but never the run's first or last piece: they
      // join the text to the expressions around it.
      if (text === "" && j > 0 && closed) return;
      kept.push(text);
    });
    // Join lines too. A run's first and last newline stay: beside them sits the
    // literal's edge or a ${} expression, which may end in a directive. So does
    // every newline that touches a preprocessor line or follows a "\".
    let body = kept[0];
    for (let k = 1; k < kept.length; k++) {
      const before = kept[k - 1],
        after = kept[k];
      const keep =
        k === 1 ||
        k === kept.length - 1 ||
        before.startsWith("#") ||
        after.startsWith("#") ||
        before.endsWith("\\");
      if (keep) body += "\n" + after;
      else
        body += (PUNCTUATION.test(before.at(-1)) || PUNCTUATION.test(after[0]) ? "" : " ") + after;
    }
    return body;
  });
}

export function compactShaderSource(source) {
  const n = source.length;
  let i = 0;

  function previousWord(out) {
    const match = /([A-Za-z_$][\w$]*)\s*$/.exec(out);
    return match ? match[1] : "";
  }
  function regexAllowed(out) {
    const trimmed = out.trimEnd();
    if (!trimmed) return true;
    const last = trimmed[trimmed.length - 1];
    if (REGEX_AFTER.has(last)) return true;
    return /[\w$]/.test(last) && REGEX_AFTER_WORD.has(previousWord(trimmed));
  }

  // Copies code up to the "}" that closes a ${} expression (or the end), and
  // returns it.
  function code(inExpression) {
    // sig is out without comments: what decides whether a "/" opens a regex.
    let out = "",
      sig = "",
      depth = 0;
    while (i < n) {
      const c = source[i],
        next = source[i + 1];
      if (c === "/" && next === "/") {
        const end = source.indexOf("\n", i);
        const stop = end < 0 ? n : end;
        out += source.slice(i, stop);
        i = stop;
      } else if (c === "/" && next === "*") {
        const end = source.indexOf("*/", i + 2);
        const stop = end < 0 ? n : end + 2;
        out += source.slice(i, stop);
        i = stop;
      } else if (c === '"' || c === "'") {
        const start = i++;
        while (i < n && source[i] !== c) i += source[i] === "\\" ? 2 : 1;
        i++;
        out += source.slice(start, i);
        sig += '""';
      } else if (c === "`") {
        out += template();
        sig += '""';
      } else if (c === "/" && regexAllowed(sig)) {
        const start = i++;
        let inClass = false;
        while (i < n) {
          const d = source[i];
          if (d === "\\") i += 2;
          else if (d === "\n")
            throw new Error(`compactShaderSource: unterminated regular expression at ${start}`);
          else {
            if (d === "[") inClass = true;
            else if (d === "]") inClass = false;
            else if (d === "/" && !inClass) break;
            i++;
          }
        }
        i++;
        while (i < n && /[a-z]/i.test(source[i])) i++;
        out += source.slice(start, i);
        sig += "/re/";
      } else {
        if (c === "{") depth++;
        else if (c === "}") {
          if (inExpression && depth === 0) return out;
          depth--;
        }
        out += c;
        sig += c;
        i++;
      }
    }
    if (inExpression) throw new Error("compactShaderSource: unterminated template expression");
    return out;
  }

  // Reads the template literal at source[i] ("`") and returns it, compacted
  // when it holds GLSL.
  function template() {
    i++;
    const parts = [];
    let text = "";
    while (i < n) {
      const c = source[i];
      if (c === "\\") {
        text += source.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        i++;
        parts.push(text);
        const glsl = parts.some((part) => typeof part === "string" && GLSL_MARKER.test(part));
        const body = (glsl ? compactText(parts) : parts)
          .map((part) => (typeof part === "string" ? part : "${" + part.expression + "}"))
          .join("");
        return "`" + body + "`";
      } else if (c === "$" && source[i + 1] === "{") {
        parts.push(text);
        text = "";
        i += 2;
        parts.push({ expression: code(true) });
        i++; // the closing "}"
      } else {
        text += c;
        i++;
      }
    }
    throw new Error("compactShaderSource: unterminated template literal");
  }

  return code(false);
}
