function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function keywordMatchesText(
  messageText: string,
  rawKeyword: string,
): boolean {
  const text = messageText.trim().toLowerCase();
  const keyword = rawKeyword.trim().toLowerCase();
  if (!text || !keyword) {
    return false;
  }

  if (/^[a-z0-9_ ]+$/.test(keyword)) {
    const pattern = escapeRegex(keyword).replace(/\s+/g, '\\s+');
    return new RegExp(`(^|[^a-z0-9_])${pattern}($|[^a-z0-9_])`).test(text);
  }

  return text.includes(keyword);
}
