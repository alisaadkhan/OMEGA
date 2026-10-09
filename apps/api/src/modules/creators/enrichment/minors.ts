// Signs that a creator may be under 18 (SRS §5.2, §5.5). Flagging errs on the safe side; only staff can clear a flag.
const PATTERNS: RegExp[] = [
  /\b(1[0-7])\s*(?:y\/o|yo|yrs?\s*old|years?\s*old)\b/i,
  /\bage[:\s]+(1[0-7])\b/i,
  /\b(?:class|grade)\s*(?:[6-9]|1[0-2])(?:th)?\b(?:\s+student)?/i,
  /\b(?:[6-9]|1[0-2])th\s+(?:class|grade)\b/i,
  /\b(?:matric|o[\s-]?levels?)\s+student\b/i,
];
// Teachers and tutors mention classes too.
const TEACHING = /\b(?:teach(?:er|ing|es)?|tutor(?:ing)?|coach(?:ing)?|academy|tuition)\b[^.\n]{0,25}$/i;
const BORN = /\bborn\s+(?:in\s+)?((?:19|20)\d{2})\b/i;

/** The matching phrase (for staff) or null. */
export function minorByRules(texts: string[], now: Date): string | null {
  for (const text of texts) {
    for (const re of PATTERNS) {
      const m = re.exec(text);
      if (!m || m.index === undefined) continue;
      if (TEACHING.test(text.slice(0, m.index))) continue;
      return `Text says "${m[0].trim()}"`;
    }
    const born = BORN.exec(text);
    if (born?.[1]) {
      const age = now.getUTCFullYear() - Number(born[1]);
      if (age >= 0 && age < 18) return `Text says "${born[0].trim()}"`;
    }
  }
  return null;
}
