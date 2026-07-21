"use client";

import type { PdfViewerTarget } from "@/components/pdf-viewer-modal";
import type { ReactNode } from "react";

type PdfLinkedMessageProps = {
  content: string;
  onOpenPdf: (target: PdfViewerTarget) => void;
};

const TEMP_UUID_PATTERN =
  /^temp_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(.+)$/i;

function parsePage(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseTempPdfId(pdfId: string): { filename: string; sessionId: string } | null {
  const uuidMatch = pdfId.match(TEMP_UUID_PATTERN);

  if (uuidMatch) {
    return {
      filename: decodeURIComponent(uuidMatch[2]),
      sessionId: uuidMatch[1]
    };
  }

  if (!pdfId.startsWith("temp_")) {
    return null;
  }

  const parts = pdfId.slice(5).split("_");

  for (let index = 1; index < parts.length; index += 1) {
    if (/^\d{10,}$/.test(parts[index])) {
      return {
        filename: decodeURIComponent(parts.slice(index + 1).join("_")),
        sessionId: parts.slice(0, index + 1).join("_")
      };
    }
  }

  return null;
}

function buildPdfTarget(label: string, href: string): PdfViewerTarget | null {
  let url: URL;

  try {
    url = new URL(href, "http://aitor.local");
  } catch {
    return null;
  }

  if (!url.pathname.endsWith("/pdf_viewer")) {
    return null;
  }

  const page = parsePage(url.searchParams.get("page"));
  const pdfSrc = url.searchParams.get("pdf_src");

  if (pdfSrc?.startsWith("_temp_/")) {
    const rest = pdfSrc.slice("_temp_/".length);
    const separatorIndex = rest.indexOf("/");

    if (separatorIndex <= 0) {
      return null;
    }

    const sessionId = rest.slice(0, separatorIndex);
    const filename = rest.slice(separatorIndex + 1);
    const targetUrl = new URL("/api/pdf/temp", "http://aitor.local");
    targetUrl.searchParams.set("session_id", sessionId);
    targetUrl.searchParams.set("filename", filename);

    return {
      page,
      title: label,
      url: `${targetUrl.pathname}${targetUrl.search}`
    };
  }

  if (pdfSrc) {
    const targetUrl = new URL("/api/pdf/source", "http://aitor.local");
    targetUrl.searchParams.set("pdf_src", pdfSrc);

    return {
      page,
      title: label,
      url: `${targetUrl.pathname}${targetUrl.search}`
    };
  }

  const pdfId = url.searchParams.get("pdf_ind");
  const tempPdf = pdfId ? parseTempPdfId(pdfId) : null;

  if (tempPdf) {
    const targetUrl = new URL("/api/pdf/temp", "http://aitor.local");
    targetUrl.searchParams.set("session_id", tempPdf.sessionId);
    targetUrl.searchParams.set("filename", tempPdf.filename);

    return {
      page,
      title: label,
      url: `${targetUrl.pathname}${targetUrl.search}`
    };
  }

  return null;
}

export function PdfLinkedMessage({ content, onOpenPdf }: PdfLinkedMessageProps) {
  return (
    <div className="markdown-content">
      {renderMarkdown(content, onOpenPdf)}
    </div>
  );
}

// ── Lightweight markdown renderer ────────────────────────────────────────────

function renderInline(
  text: string,
  onOpenPdf: (target: PdfViewerTarget) => void,
  keyPrefix: string
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]*)\]\(([^)]*)\))/gs;

  let cursor = 0;
  let idx = 0;

  for (const m of text.matchAll(pattern)) {
    const start = m.index ?? 0;
    if (start > cursor) {
      nodes.push(text.slice(cursor, start));
    }

    const key = `${keyPrefix}-${idx++}`;

    if (m[2]) {
      nodes.push(<strong key={key}><em>{m[2]}</em></strong>);
    } else if (m[3]) {
      nodes.push(<strong key={key}>{m[3]}</strong>);
    } else if (m[4]) {
      nodes.push(<em key={key}>{m[4]}</em>);
    } else if (m[5]) {
      nodes.push(<code key={key}>{m[5]}</code>);
    } else if (m[6] !== undefined && m[7] !== undefined) {
      const label = m[6];
      const href = m[7];
      const target = buildPdfTarget(label, href);
      if (target) {
        nodes.push(
          <button
            className="pdf-citation-link"
            key={key}
            onClick={() => onOpenPdf(target)}
            type="button"
          >
            {label}
          </button>
        );
      } else {
        nodes.push(
          <a href={href} key={key} rel="noopener noreferrer" target="_blank">
            {label}
          </a>
        );
      }
    }

    cursor = start + m[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

type TableBlock = {
  type: "table";
  headers: string[];
  rows: string[][];
};

type BlockNode =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "code"; lang: string; text: string }
  | { type: "blockquote"; text: string }
  | { type: "hr" }
  | { type: "paragraph"; text: string }
  | TableBlock;

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|?[\s\-:|]+(\|[\s\-:|]+)*\|?$/.test(line) && line.includes("-");
}

function parseBlocks(raw: string): BlockNode[] {
  const lines = raw.split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trimStart(); // trim for pattern matching; preserve original for code blocks

    // Blank line — skip
    if (t === "") {
      i += 1;
      continue;
    }

    // Fenced code block (must start at column 0 or minimal indent)
    if (/^```/.test(t)) {
      const lang = t.slice(3).trim();
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trimStart())) {
        codeLines.push(lines[i]);
        i += 1;
      }
      blocks.push({ type: "code", lang, text: codeLines.join("\n") });
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(t)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // ATX heading
    const headingMatch = t.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2]
      });
      i += 1;
      continue;
    }

    // GFM table: header row | separator row | data rows
    if (t.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1].trimStart())) {
      const headers = parseTableRow(t);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trimStart().includes("|")) {
        rows.push(parseTableRow(lines[i].trimStart()));
        i += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(t)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trimStart())) {
        quoteLines.push(lines[i].trimStart().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    // Unordered list — handles leading indent and multiple spaces after marker
    if (/^[\-\*\+]\s/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*\+]\s/.test(lines[i].trimStart())) {
        items.push(lines[i].trimStart().replace(/^[\-\*\+]\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list — handles leading indent
    if (/^\d+\.\s/.test(t)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trimStart())) {
        items.push(lines[i].trimStart().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Paragraph: accumulate until blank line or block-level marker
    const paraLines: string[] = [];
    while (i < lines.length) {
      const pt = lines[i].trimStart();
      if (pt === "") break;
      if (/^(#{1,6}\s|```|>\s?|[\-\*\+]\s|\d+\.\s|[-*_]{3,}\s*$)/.test(pt)) break;
      if (pt.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1].trimStart())) break;
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join(" ") });
    }
  }

  return blocks;
}

function renderMarkdown(
  raw: string,
  onOpenPdf: (target: PdfViewerTarget) => void
): ReactNode[] {
  const blocks = parseBlocks(raw);

  return blocks.map((block, bi) => {
    const key = `block-${bi}`;

    switch (block.type) {
      case "heading": {
        const inline = renderInline(block.text, onOpenPdf, key);
        const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
        return <Tag key={key}>{inline}</Tag>;
      }
      case "ul":
        return (
          <ul key={key}>
            {block.items.map((item, ii) => (
              <li key={`${key}-${ii}`}>{renderInline(item, onOpenPdf, `${key}-${ii}`)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={key}>
            {block.items.map((item, ii) => (
              <li key={`${key}-${ii}`}>{renderInline(item, onOpenPdf, `${key}-${ii}`)}</li>
            ))}
          </ol>
        );
      case "code":
        return (
          <pre key={key}>
            <code className={block.lang ? `language-${block.lang}` : undefined}>
              {block.text}
            </code>
          </pre>
        );
      case "blockquote":
        return (
          <blockquote key={key}>
            {renderInline(block.text, onOpenPdf, key)}
          </blockquote>
        );
      case "hr":
        return <hr key={key} />;
      case "table":
        return (
          <div key={key} style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {block.headers.map((h, hi) => (
                    <th key={hi}>{renderInline(h, onOpenPdf, `${key}-h${hi}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci}>{renderInline(cell, onOpenPdf, `${key}-r${ri}c${ci}`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "paragraph":
        return <p key={key}>{renderInline(block.text, onOpenPdf, key)}</p>;
    }
  });
}
