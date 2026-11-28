import { InlineAlert } from "./InlineAlert";

export function RestoreRulebookRoom({ error, onBack }: { error?: string; onBack: () => void }) {
  return (
    <section class="rb-shell">
      <div class="rb-card">
        <h1>Membuka ruang</h1>
        {error ? (
          <>
            <InlineAlert message={error} />
            <div class="rb-actions">
              <button type="button" class="primary" onClick={() => location.reload()}>Coba Lagi</button>
              <button type="button" class="secondary" onClick={onBack}>Kembali ke Katalog</button>
            </div>
          </>
        ) : <p role="status">Memuat ruang permainan…</p>}
      </div>
    </section>
  );
}
