// Formatting-neutral markup, so a check reads the same however Prettier wraps
// it: whitespace runs become one space, with none just inside parentheses or
// brackets or beside a tag's angle brackets.
export function flat(html) {
  return html
    .replace(/\s+/g, " ")
    .replace(/([([]) | ([)\]])/g, "$1$2")
    .replace(/ ?([<>]) ?/g, "$1");
}
