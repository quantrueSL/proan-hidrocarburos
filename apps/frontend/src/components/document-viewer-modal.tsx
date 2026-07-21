"use client";

import { useEffect, useRef, useState } from "react";

export type DocumentViewerTarget = {
  title: string;
  url: string;
  type: "pdf" | "docx" | "xlsx" | "unsupported";
};

type DocumentViewerModalProps = {
  onClose: () => void;
  target: DocumentViewerTarget | null;
};

async function importOptionalModule<TModule>(specifier: string): Promise<TModule> {
  return new Function("s", "return import(s)")(specifier) as Promise<TModule>;
}

// ── PDF ───────────────────────────────────────────────────────────────────────

function PdfViewer({ url, title }: { url: string; title: string }) {
  return <iframe className="pdf-viewer-frame" src={`${url}#page=1`} title={title} />;
}

// ── DOCX ──────────────────────────────────────────────────────────────────────

function DocxViewer({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const buffer = await res.arrayBuffer();

        const mammoth = await importOptionalModule<{
          convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
        }>("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        if (!cancelled) setHtml(result.value);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar el documento.");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!html) return <p className="muted doc-viewer-loading">Cargando documento…</p>;

  return (
    <div
      className="docx-viewer-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── XLSX ──────────────────────────────────────────────────────────────────────

type SheetData = { name: string; html: string };

function XlsxViewer({ url }: { url: string }) {
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const buffer = await res.arrayBuffer();

        const XLSX = await importOptionalModule<{
          read: (data: Uint8Array, options: { type: "array" }) => {
            SheetNames: string[];
            Sheets: Record<string, unknown>;
          };
          utils: {
            sheet_to_html: (sheet: unknown, options: { editable: false }) => string;
          };
        }>("xlsx");
        const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });

        const parsed: SheetData[] = workbook.SheetNames.map((name) => ({
          name,
          html: XLSX.utils.sheet_to_html(workbook.Sheets[name], { editable: false })
        }));

        if (!cancelled) {
          setSheets(parsed);
          setActiveSheet(0);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar el archivo Excel.");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!sheets) return <p className="muted doc-viewer-loading">Cargando hoja de cálculo…</p>;

  return (
    <div className="xlsx-viewer">
      {sheets.length > 1 && (
        <div className="xlsx-sheet-tabs">
          {sheets.map((sheet, i) => (
            <button
              className={`xlsx-sheet-tab${i === activeSheet ? " xlsx-sheet-tab-active" : ""}`}
              key={sheet.name}
              onClick={() => setActiveSheet(i)}
              type="button"
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
      <div
        className="xlsx-viewer-content"
        dangerouslySetInnerHTML={{ __html: sheets[activeSheet]?.html ?? "" }}
      />
    </div>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<DocumentViewerTarget["type"], string> = {
  pdf: "PDF",
  docx: "Word",
  xlsx: "Excel",
  unsupported: "Archivo"
};

export function DocumentViewerModal({ onClose, target }: DocumentViewerModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  if (!target) return null;

  const label = TYPE_LABELS[target.type];

  function renderViewer() {
    if (!target) return null;
    switch (target.type) {
      case "pdf":
        return <PdfViewer title={target.title} url={target.url} />;
      case "docx":
        return <DocxViewer url={target.url} />;
      case "xlsx":
        return <XlsxViewer url={target.url} />;
      default:
        return (
          <div className="doc-viewer-unsupported">
            <p className="muted">Vista previa no disponible para este tipo de archivo.</p>
          </div>
        );
    }
  }

  return (
    <div
      className="pdf-viewer-backdrop"
      onClick={onClose}
      ref={backdropRef}
    >
      <section
        aria-label={`Visor ${label}: ${target.title}`}
        aria-modal="true"
        className="pdf-viewer-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <header className="pdf-viewer-header">
          <div>
            <span className="eyebrow">{label}</span>
            <h2>{target.title}</h2>
          </div>
          <div className="pdf-viewer-actions">
            <button
              aria-label={`Cerrar visor ${label}`}
              className="profile-modal-close pdf-viewer-close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        <div className="doc-viewer-body">
          {renderViewer()}
        </div>
      </section>
    </div>
  );
}
