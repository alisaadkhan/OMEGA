/**
 * One CSV cell for files staff open in a spreadsheet: quoted, and a formula neutralised with an apostrophe (a leading
 * = + - @, also after spaces or in full-width form, tab or carriage return). Mirrors the API's export cell.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[\s]*[=+\-@\uff1d\uff0b\uff0d\uff20]|^[\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
