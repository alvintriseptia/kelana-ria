const GUEST_NAME_KEY = "kelana-guest-nickname";

export function readRememberedGuestName(): string {
  try {
    return (localStorage.getItem(GUEST_NAME_KEY) ?? "").trim().slice(0, 32);
  } catch {
    return "";
  }
}

export function saveRememberedGuestName(raw: string): void {
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 32);
  if (!cleaned) return;
  try {
    localStorage.setItem(GUEST_NAME_KEY, cleaned);
  } catch {
    // Ignore storage quota / privacy mode failures.
  }
}

export function resolveDefaultPlayerName(signedInDisplayName?: string | null, fallback = "Pemain"): string {
  const accountName = signedInDisplayName?.trim().slice(0, 32);
  if (accountName) return accountName;
  const remembered = readRememberedGuestName();
  return remembered || fallback;
}
