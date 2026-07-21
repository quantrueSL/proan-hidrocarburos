"use client";

export type PdfViewerTarget = {
  page: number;
  title: string;
  url: string;
};

type PdfViewerModalProps = {
  onClose: () => void;
  target: PdfViewerTarget | null;
};

export function PdfViewerModal({ onClose, target }: PdfViewerModalProps) {
  if (!target) {
    return null;
  }

  const viewerUrl = `${target.url}#page=${target.page}`;

  return (
    <div className="pdf-viewer-backdrop" onClick={onClose}>
      <section
        aria-label={`Visor PDF: ${target.title}`}
        aria-modal="true"
        className="pdf-viewer-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="pdf-viewer-header">
          <div>
            <span className="eyebrow">PDF</span>
            <h2>{target.title}</h2>
          </div>

          <div className="pdf-viewer-actions">
            <a
              className="btn btn-secondary pdf-viewer-open"
              href={viewerUrl}
              rel="noreferrer"
              target="_blank"
            >
              Abrir
            </a>
            <button
              aria-label="Cerrar visor PDF"
              className="profile-modal-close pdf-viewer-close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        <iframe className="pdf-viewer-frame" src={viewerUrl} title={target.title} />
      </section>
    </div>
  );
}
