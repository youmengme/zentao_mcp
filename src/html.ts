/**
 * Helpers for ZenTao's rich-text (KindEditor) fields such as bug comments and
 * resolution notes. Those fields store HTML, so plain text with `\n` newlines
 * would collapse into a single line. We convert plain text to safe HTML here.
 */

/** Escape HTML special chars so user text can't break the rich-text markup. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert plain text into HTML for ZenTao rich-text fields.
 * Blank lines separate paragraphs; single newlines become <br/>.
 */
export function textToHtml(text: string): string {
  const html = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  return html || "<p></p>";
}
