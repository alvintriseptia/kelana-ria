import type { RulebookFormat } from "@kelana-ria/contracts";
import { useEffect, useState } from "preact/hooks";
import { getCachedAuth, onAuthChange } from "../auth-modal";

export function DraftStudioLink({
  format,
  pass,
  menu = false,
}: {
  format: RulebookFormat;
  pass: { packId: string; version: number };
  menu?: boolean;
}) {
  const adminPlaytest = new URLSearchParams(location.search).get("adminPlaytest") === "1";
  const [isAdmin, setIsAdmin] = useState(() => getCachedAuth()?.user?.role === "admin");

  useEffect(() => {
    if (!adminPlaytest) return;
    const unsubscribe = onAuthChange(auth => setIsAdmin(auth.user?.role === "admin"));
    setIsAdmin(getCachedAuth()?.user?.role === "admin");
    return unsubscribe;
  }, [adminPlaytest]);

  const returnToAdmin = adminPlaytest && isAdmin;
  const href = returnToAdmin
    ? "/?play=rulebook-studio&studio=review"
    : `/?play=rulebook-studio&studio=editor&format=${format}&draft=${encodeURIComponent(pass.packId)}&version=${pass.version}`;

  return (
    <a
      class={menu ? "cg-menu-link" : "cg-back-studio-link"}
      data-testid={menu ? "menu-back-to-studio" : "back-to-studio-btn"}
      href={href}
    >
      {returnToAdmin ? "← Kembali ke Panel Admin" : "← Kembali ke Studio"}
    </a>
  );
}
