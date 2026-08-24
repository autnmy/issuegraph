/**
 * One JSON renderer, so every data verb writes the same shape.
 *
 * Pretty-printed with a trailing newline: `jq` is indifferent, a terminal is
 * not, and a file that ends without a newline is a nuisance for every line-based
 * tool downstream.
 *
 * It is a function rather than an inline `JSON.stringify` at each call site
 * because the indent and the trailing newline are part of the output contract
 * the process-level tests assert, and a contract spelled at six call sites is a
 * contract that drifts at one of them.
 */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
