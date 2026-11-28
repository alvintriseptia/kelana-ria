const privatePatterns = [
  /\b[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu,
  /\b(?:set-cookie|authorization|cookie|(?:kelana_(?:session|rulebook))|(?:api|access|refresh|auth|session)[ _-]?(?:token|key)|password|room[ _-]?(?:secret|code)|found[ _-]?code)\s*["']?\s*[:=]\s*[^\n]+/gi,
  /\b(?:bearer|basic)\s+[a-z\d_.+/=-]+/gi,
  /\b(?:RB|RC)-[a-f0-9]{6}\b/gi,
  /\b(?:latitude|longitude|lat|lng|lon)\s*["']?\s*[:=]\s*["']?[-+]?\d{1,3}(?:\.\d+)?/gi,
  /[-+]?\d{1,3}\.\d{2,}\s*(?:[,;/]\s*|\s+)[-+]?\d{1,3}\.\d{2,}/g,
  /\d{1,3}\s*°\s*\d{1,2}(?:\.\d+)?\s*['′](?:\s*\d{1,2}(?:\.\d+)?\s*["″])?\s*[NSEW]\b/gi,
  /\beyJ[a-z0-9_-]+(?:\.[a-z0-9_-]+){2}\b/gi,
  /\b[a-z0-9_-]{32,}\b/gi,
  /https?:\/\/[^\s<>]+/gi,
];

export function redactStudioKnowledge(value: string, secrets: readonly string[] = []): string {
  let clean = value.normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "");
  for (const secret of secrets) {
    if (secret.length < 3) continue;
    const literal = secret.normalize("NFKC").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clean = clean.replace(new RegExp(literal, "gi"), " ");
  }
  for (const pattern of privatePatterns) clean = clean.replace(pattern, " ");
  return clean.replace(/[ \t]+\n/g, "\n").trim();
}
