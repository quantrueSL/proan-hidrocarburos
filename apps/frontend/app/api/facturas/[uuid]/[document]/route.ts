import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { getFacturaDocument } from "@/lib/facturas-api";
import type { FacturaDocumentType } from "@/types/facturas";

const DOCUMENTS = new Set<FacturaDocumentType>(["metadata", "pdf", "xml"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: { uuid: string; document: string } }) {
  requireSession();
  if (!UUID.test(params.uuid) || !DOCUMENTS.has(params.document as FacturaDocumentType)) {
    return NextResponse.json({ detail: "Solicitud de documento inválida." }, { status: 400 });
  }
  try {
    const response = await getFacturaDocument(params.uuid, params.document as FacturaDocumentType);
    const headers = new Headers();
    headers.set("Content-Type", response.headers.get("Content-Type") || "application/octet-stream");
    const disposition = response.headers.get("Content-Disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
    return new NextResponse(response.body, { status: response.status, headers });
  } catch (cause) {
    return NextResponse.json({ detail: cause instanceof Error ? cause.message : "No se pudo descargar el documento." }, { status: 502 });
  }
}
