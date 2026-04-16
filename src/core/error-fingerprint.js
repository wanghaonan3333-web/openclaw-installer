const VERSION_RE = /\b\d+\.\d+(?:\.\d+)?(?:[-+._a-zA-Z0-9]*)?\b/g;
const PATH_RE = /([A-Za-z]:\\[^\s:]+|\/[^\s:]+)/g;
const LINE_RE = /\bline\s+\d+\b/gi;
const TIMESTAMP_RE =
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g;

function normalizeLine(line) {
  return line
    .replace(PATH_RE, "<path>")
    .replace(TIMESTAMP_RE, "<time>")
    .replace(LINE_RE, "line <n>")
    .replace(VERSION_RE, "<version>")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildErrorFingerprint(text = "") {
  const lines = String(text)
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .slice(0, 3);

  return lines.join(" | ").slice(0, 500);
}
