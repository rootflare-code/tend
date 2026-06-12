const EMAIL_HEADER_PATTERNS = [
  /^From:\s+\S+/m,
  /^To:\s+\S+/m,
  /^Subject:\s+\S+/m,
];

export function containsFullEmail(text?: string): boolean {
  return Boolean(text && EMAIL_HEADER_PATTERNS.every((pattern) => pattern.test(text)));
}
