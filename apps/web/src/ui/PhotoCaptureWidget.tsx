import { formatPhotoSizeKb, type PreparedPhoto } from "../photo-capture";
import "../photo-capture.css";

export function PhotoCaptureWidget({
  inputId,
  targetAttrName,
  targetId,
  prepared,
  processing = false,
  disabled = false,
  hintText,
  previewAlt = "Pratinjau foto siap unggah",
  onSelectFile,
  onClear,
}: {
  inputId?: string;
  targetAttrName: "data-cg-photo" | "data-sg-photo";
  targetId: string;
  prepared?: PreparedPhoto | null;
  processing?: boolean;
  disabled?: boolean;
  hintText?: string;
  previewAlt?: string;
  onSelectFile: (file: File | undefined) => void;
  onClear: () => void;
}) {
  const targetAttr = { [targetAttrName]: targetId };
  const fileInput = (
    <input
      id={inputId}
      class="photo-capture-input"
      {...targetAttr}
      type="file"
      accept="image/*"
      capture="environment"
      disabled={disabled}
      onChange={(event) => {
        onSelectFile(event.currentTarget.files?.[0]);
      }}
    />
  );

  if (processing) {
    return (
      <div class="photo-capture-widget" data-photo-widget={targetId}>
        {hintText && <small class="photo-capture-hint">{hintText}</small>}
        <div class="photo-capture-status" role="status" data-testid="photo-processing-status">
          ⏳ Memproses foto…
        </div>
        <label class="photo-capture-btn photo-capture-btn--muted" aria-disabled={true}>
          <span aria-hidden="true">📷</span> Ambil Foto
          {fileInput}
        </label>
      </div>
    );
  }

  if (prepared) {
    return (
      <div class="photo-capture-widget photo-capture-widget--ready" data-photo-widget={targetId}>
        <div class="photo-preview-frame">
          <img
            class="photo-preview-img"
            data-testid="photo-preview-img"
            src={prepared.dataUrl}
            alt={previewAlt}
          />
          <span class="photo-ready-badge" data-testid="photo-size-badge" role="status">
            ✓ Siap unggah · {formatPhotoSizeKb(prepared.byteLength)}
          </span>
        </div>
        <div class="photo-capture-actions">
          <label class="photo-capture-btn photo-capture-btn--retake" data-testid="photo-retake-btn">
            <span aria-hidden="true">📷</span> Ambil Ulang
            {fileInput}
          </label>
          <button
            type="button"
            class="secondary photo-clear-btn"
            data-photo-clear={targetId}
            data-testid="photo-clear-btn"
            disabled={disabled}
            onClick={onClear}
          >
            Hapus
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="photo-capture-widget" data-photo-widget={targetId}>
      {hintText && <small class="photo-capture-hint">{hintText}</small>}
      <label class="photo-capture-btn" data-testid="photo-capture-btn">
        <span aria-hidden="true">📷</span> Ambil Foto
        {fileInput}
      </label>
    </div>
  );
}
