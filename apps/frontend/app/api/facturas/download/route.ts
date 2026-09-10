import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getFacturaDocument } from "@/lib/facturas-api";
import type { FacturaDocumentType } from "@/types/facturas";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCUMENTS = new Set<FacturaDocumentType>(["metadata", "pdf", "xml"]);
const MAX_FACTURAS = 100;

type DownloadItem = { uuid: string; pdf_name?: string; xml_name?: string };
type DownloadRequest = { items?: DownloadItem[]; documents?: FacturaDocumentType[] };

function filename(value: string | undefined, fallback: string, extension: string): string {
  const cleaned = (value || fallback)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 140) || fallback;
  const withoutExtension = cleaned.replace(new RegExp(`${extension.replace(".", "\\.")}$`, "i"), "");
  return `${withoutExtension || fallback}${extension}`;
}

async function appendDocument(archive: archiver.Archiver, item: DownloadItem, document: FacturaDocumentType): Promise<void> {
  const response = await getFacturaDocument(item.uuid, document);
  if (!response.body) throw new Error("La API devolvió un documento vacío.");

  const base = item.uuid;
  const name = document === "pdf"
    ? filename(item.pdf_name, base, ".pdf")
    : document === "xml"
      ? filename(item.xml_name, base, ".xml")
      : filename(undefined, base, ".json");

  await new Promise<void>((resolve, reject) => {
    const source = Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream);
    source.once("error", reject);
    archive.once("entry", () => resolve());
    archive.append(source, { name });
  });
}

export async function POST(request: Request) {
  requireSession();
  let body: DownloadRequest;
  try {
    body = await request.json() as DownloadRequest;
  } catch {
    return NextResponse.json({ detail: "Solicitud de descarga inválida." }, { status: 400 });
  }

  const documents = [...new Set((body.documents || []).filter((value): value is FacturaDocumentType => DOCUMENTS.has(value)))];
  const items = [...new Map((body.items || []).filter((item) => UUID.test(item.uuid)).map((item) => [item.uuid, item])).values()];
  if (!documents.length || !items.length) {
    return NextResponse.json({ detail: "Selecciona al menos una factura y un tipo de documento." }, { status: 400 });
  }
  if (items.length > MAX_FACTURAS) {
    return NextResponse.json({ detail: `La descarga está limitada a ${MAX_FACTURAS} facturas. Acota los filtros o divide la selección.` }, { status: 400 });
  }

  const archive = archiver("zip", { zlib: { level: 6 } });
  const output = new PassThrough();
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);

  void (async () => {
    try {
      for (const item of items) {
        for (const document of documents) await appendDocument(archive, item, document);
      }
      await archive.finalize();
    } catch (error) {
      output.destroy(error instanceof Error ? error : new Error("No se pudo generar el ZIP."));
    }
  })();

  return new NextResponse(Readable.toWeb(output) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="facturas.zip"'
    }
  });
}
