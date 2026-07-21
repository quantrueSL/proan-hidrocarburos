"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// ── SQL syntax highlighter ────────────────────────────────────────────────────

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "FULL",
  "CROSS", "NATURAL", "ON", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET",
  "AS", "AND", "OR", "NOT", "IN", "LIKE", "ILIKE", "BETWEEN", "IS", "NULL",
  "DISTINCT", "UNION", "ALL", "EXCEPT", "INTERSECT", "CASE", "WHEN", "THEN",
  "ELSE", "END", "WITH", "OVER", "PARTITION", "ROWS", "RANGE", "UNBOUNDED",
  "PRECEDING", "FOLLOWING", "CURRENT", "ROW", "CREATE", "TABLE", "INSERT",
  "INTO", "VALUES", "UPDATE", "SET", "DELETE", "DROP", "ALTER", "EXISTS",
  "FETCH", "FIRST", "NEXT", "ONLY", "ASC", "DESC", "USING", "TRUE", "FALSE",
  "SOME", "ANY", "NULLS", "LAST", "RECURSIVE", "LATERAL", "TABLESAMPLE",
]);

const SQL_FUNCTIONS = new Set([
  "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CAST", "CONVERT",
  "TRIM", "UPPER", "LOWER", "LENGTH", "SUBSTR", "SUBSTRING", "REPLACE", "CONCAT",
  "DATE", "TIMESTAMP", "EXTRACT", "DATE_TRUNC", "DATETRUNC", "FORMAT_DATE",
  "ROUND", "FLOOR", "CEIL", "CEILING", "ABS", "MOD", "POWER", "SQRT",
  "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE",
  "NTH_VALUE", "NTILE", "CUME_DIST", "PERCENT_RANK",
  "STRING_AGG", "ARRAY_AGG", "ARRAY_LENGTH", "APPROX_COUNT_DISTINCT",
  "SAFE_DIVIDE", "IF", "IIF", "IFNULL", "ISNULL", "NVL",
  "GENERATE_DATE_ARRAY", "GENERATE_ARRAY", "UNNEST", "STRUCT",
  "TO_DATE", "TO_TIMESTAMP", "TO_CHAR", "TO_NUMBER", "PARSE_DATE",
  "DATE_ADD", "DATE_SUB", "DATE_DIFF", "DATETIME_ADD", "DATETIME_SUB",
  "TIMESTAMP_ADD", "TIMESTAMP_SUB", "TIMESTAMP_DIFF",
  "REGEXP_CONTAINS", "REGEXP_EXTRACT", "REGEXP_REPLACE",
  "JSON_VALUE", "JSON_QUERY", "PARSE_JSON", "TO_JSON_STRING",
]);

// Tokens: comment, block-comment, string, backtick-id, quoted-id, number, word, ws/other
const TOKEN_RE = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\]|\\.)*'|`[^`]*`|"[^"]*"|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[A-Za-z_]\w*|\s+|.)/g;

type SqlToken = { text: string; cls: string };

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(sql)) !== null) {
    const text = match[0];

    if (text.startsWith("--") || text.startsWith("/*")) {
      tokens.push({ text, cls: "sq-comment" });
    } else if (text.startsWith("'")) {
      tokens.push({ text, cls: "sq-string" });
    } else if (text.startsWith("`") || text.startsWith('"')) {
      tokens.push({ text, cls: "sq-ident" });
    } else if (/^\d/.test(text)) {
      tokens.push({ text, cls: "sq-number" });
    } else if (/^[A-Za-z_]\w*$/.test(text)) {
      const upper = text.toUpperCase();
      if (SQL_KEYWORDS.has(upper)) {
        tokens.push({ text, cls: "sq-keyword" });
      } else if (SQL_FUNCTIONS.has(upper)) {
        tokens.push({ text, cls: "sq-function" });
      } else {
        tokens.push({ text, cls: "" });
      }
    } else {
      tokens.push({ text, cls: "" });
    }
  }

  return tokens;
}

// ── Modal component ───────────────────────────────────────────────────────────

type ChatbiDataModalProps = {
  type: "table" | "sql";
  records?: unknown[] | null;
  sqlQuery?: string | null;
  rowCount?: number;
  onClose: () => void;
};

function formatCellValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(value);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
      }).format(parsed);
    }
  }

  return value === null || value === undefined ? "" : String(value);
}

export function ChatbiDataModal({
  type,
  records,
  sqlQuery,
  rowCount,
  onClose,
}: ChatbiDataModalProps) {
  // Mount flag to avoid SSR mismatch — portal target is only available in the browser
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const cols =
    type === "table" && records && (records as Record<string, unknown>[]).length > 0
      ? Object.keys((records as Record<string, unknown>[])[0])
      : [];

  const sqlTokens = type === "sql" && sqlQuery ? tokenizeSql(sqlQuery) : [];

  if (!mounted) return null;

  const content = (
    <div className="chatbi-modal-backdrop" onClick={onClose}>
      <div
        className="chatbi-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chatbi-modal-title"
      >
        <div className="chatbi-modal-header">
          <div>
            <span className="eyebrow">ChatBI</span>
            <h2 id="chatbi-modal-title">
              {type === "table"
                ? `Datos${rowCount !== undefined ? ` — ${rowCount} filas` : ""}`
                : "Consulta SQL"}
            </h2>
          </div>
          <button
            aria-label="Cerrar"
            className="chatbi-modal-close"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="chatbi-modal-body">
          {type === "table" && records && cols.length > 0 ? (
            <div className="chatbi-table-scroll">
              <table className="chatbi-table">
                <thead>
                  <tr>
                    {cols.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(records as Record<string, unknown>[]).map((row, i) => (
                    <tr key={i}>
                      {cols.map((col, j) => (
                        <td key={j}>
                          {formatCellValue(row[col])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {type === "sql" && sqlTokens.length > 0 ? (
            <pre className="chatbi-sql-block">
              <code>
                {sqlTokens.map((tok, i) =>
                  tok.cls ? (
                    <span key={i} className={tok.cls}>
                      {tok.text}
                    </span>
                  ) : (
                    tok.text
                  )
                )}
              </code>
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
