// Formatting-neutral styles, so a check reads the same however Prettier wraps
// them: whitespace runs become one space, with none just inside parentheses
// or brackets.
export function flat(css) {
  return css.replace(/\s+/g, " ").replace(/([([]) | ([)\]])/g, "$1$2");
}

// The first standalone rule for a selector, not one listed after a comma.
export function rule(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`(?:^|[}/{])\\s*${escaped}\\s*\\{([^}]*)\\}`))?.[1] || "";
}

// Every innermost rule, top level or nested in an at-rule, whose selector
// (comments removed) passes the test: [{ selector, body }].
export function rules(styles, matches) {
  return [...styles.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, selector, body]) => ({ selector: selector.trim(), body }))
    .filter(({ selector }) => matches(selector));
}

// Every block for a media query, joined in source order.
export function mediaBlock(styles, query) {
  const blocks = [];
  for (
    let start = styles.indexOf(`@media ${query} {`);
    start >= 0;
    start = styles.indexOf(`@media ${query} {`, start + 1)
  ) {
    let depth = 0;
    for (let index = styles.indexOf("{", start); index < styles.length; index += 1) {
      if (styles[index] === "{") depth += 1;
      if (styles[index] === "}" && --depth === 0) {
        blocks.push(styles.slice(start, index + 1));
        break;
      }
    }
  }
  return blocks.join("\n");
}

// The WCAG contrast ratio of two #rrggbb colours.
export function contrast(foreground, background) {
  const luminance = (hex) => {
    const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((part) => {
      const channel = parseInt(part, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
