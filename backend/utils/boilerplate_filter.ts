const BOILERPLATE_PATTERNS: RegExp[] = [
  /^\s*translate\s*$/i,
  /^\s*(thanks|thank you|thx|ty)\s*[.!]*\s*$/i,
  /^\s*(solved|resolved|fixed)\s*[.!]*\s*$/i,
  /^\s*(following|same issue|same problem)\s*[.!]*\s*$/i
];

export function isBoilerplateMessage(content: string): boolean {
  const normalized = content
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return true;
  }
  if (normalized.length <= 12) {
    return true;
  }
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(normalized));
}
