import type { AuthMeReply, AuthUser } from "@kelana-ria/contracts";

function userInitial(user: AuthUser): string {
  const source = (user.displayName || user.email || "P").trim();
  return (source[0] || "P").toUpperCase();
}

export function AccountChip({
  auth,
  onOpenAccount,
  onOpenAuth,
}: {
  auth: AuthMeReply | null;
  onOpenAccount: () => void;
  onOpenAuth: () => void;
}) {
  if (auth?.authenticated && auth.user) {
    return (
      <button
        type="button"
        class="secondary auth-chip auth-chip--signed"
        data-auth-action="open-account"
        data-testid="auth-chip-account"
        aria-label={`Akun ${auth.user.displayName}`}
        onClick={onOpenAccount}
      >
        <span class="auth-avatar" aria-hidden="true">
          {userInitial(auth.user)}
        </span>
        <span class="auth-chip-name">{auth.user.displayName}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      class="secondary auth-chip"
      data-auth-action="open-auth"
      data-testid="auth-chip-signin"
      onClick={onOpenAuth}
    >
      Masuk
    </button>
  );
}
