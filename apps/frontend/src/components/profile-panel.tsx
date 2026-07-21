"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { clientConfig } from "../../client.config";
import type {
  AllowedSchemasResponse,
  PermanentDocumentRead,
  UserRead
} from "@/types/gateway";

type DocumentViewerTarget = {
  title: string;
  url: string;
  type: "pdf" | "docx" | "xlsx" | "unsupported";
};

const ProfileDocumentViewerModal = clientConfig.features.profile.documentPreview
  ? dynamic(
      () =>
        import("@/components/document-viewer-modal").then(
          (module) => module.DocumentViewerModal
        ),
      { ssr: false }
    )
  : null;

// ── Document folder tree ──────────────────────────────────────────────────────

type FileEntry = {
  displayName: string;
  resumen: string;
  rutaCompleta: string;
};

type FolderNode = {
  files: FileEntry[];
  subfolders: Record<string, FolderNode>;
};

function buildDocumentTree(documents: PermanentDocumentRead[]): {
  folders: Record<string, FolderNode>;
  rootFiles: FileEntry[];
} {
  const rootFiles: FileEntry[] = [];
  const folders: Record<string, FolderNode> = {};

  for (const doc of documents) {
    const rawPath = doc.ruta_completa?.trim() || doc.nombre;
    const parts = rawPath.split("/").map((p) => p.trim()).filter(Boolean);

    if (parts.length === 0) {
      continue;
    }

    const fileEntry: FileEntry = {
      displayName: parts[parts.length - 1],
      resumen: doc.resumen || "",
      rutaCompleta: rawPath
    };

    if (parts.length === 1) {
      rootFiles.push(fileEntry);
      continue;
    }

    let currentNode: FolderNode | null = null;

    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];

      if (i === 0) {
        if (!folders[folderName]) {
          folders[folderName] = { files: [], subfolders: {} };
        }

        currentNode = folders[folderName];
      } else {
        if (!currentNode!.subfolders[folderName]) {
          currentNode!.subfolders[folderName] = { files: [], subfolders: {} };
        }

        currentNode = currentNode!.subfolders[folderName];
      }
    }

    currentNode!.files.push(fileEntry);
  }

  return { folders, rootFiles };
}

function countFilesRecursive(node: FolderNode): number {
  let count = node.files.length;

  for (const sub of Object.values(node.subfolders)) {
    count += countFilesRecursive(sub);
  }

  return count;
}

type DocFolderProps = {
  name: string;
  node: FolderNode;
  onOpenFile: (entry: FileEntry) => void;
};

function DocFolder({ name, node, onOpenFile }: DocFolderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const fileCount = countFilesRecursive(node);

  return (
    <li className="doc-folder">
      <button
        className="doc-folder-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        type="button"
      >
        <span className="doc-folder-arrow">{isOpen ? "▼" : "▶"}</span>
        <span className="doc-folder-icon">📂</span>
        <span className="doc-folder-name">{name}</span>
        <span className="doc-folder-count muted">({fileCount})</span>
      </button>

      {isOpen ? (
        <ul className="doc-folder-contents">
          {Object.entries(node.subfolders).sort(([a], [b]) => a.localeCompare(b)).map(([subName, subNode]) => (
            <DocFolder key={subName} name={subName} node={subNode} onOpenFile={onOpenFile} />
          ))}
          {node.files.map((file) => (
            <li className="doc-file" key={file.rutaCompleta}>
              <button
                className="profile-resource-link doc-file-link"
                onClick={() => onOpenFile(file)}
                type="button"
              >
                <span className="doc-file-icon">📄</span>
                {file.displayName}
              </button>
              {file.resumen && file.resumen !== "Sin resumen disponible" ? (
                <span className="muted doc-file-summary">{file.resumen}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type ProfilePanelProps = {
  apps: string[];
  email: string;
  initialUser: UserRead | null;
  isOpen: boolean;
  onClose: () => void;
};

type ApiErrorPayload = {
  detail?: string;
};

type LoadableState<T> = {
  data: T;
  error: string | null;
  hasLoaded: boolean;
  isLoading: boolean;
};

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    return payload.detail ?? fallback;
  } catch {
    return fallback;
  }
}

export function ProfilePanel({
  apps,
  email,
  initialUser,
  isOpen,
  onClose
}: ProfilePanelProps) {
  const profileFeatures = clientConfig.features.profile;
  const isMinimalProfile =
    !profileFeatures.instructions &&
    !profileFeatures.accessibleSchemas &&
    !profileFeatures.persistentDocuments;
  const [user, setUser] = useState(initialUser);
  const [instructionsValue, setInstructionsValue] = useState(
    initialUser?.user_instructions ?? ""
  );
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);
  const [instructionsError, setInstructionsError] = useState<string | null>(null);
  const [instructionsSuccess, setInstructionsSuccess] = useState<string | null>(null);
  const [schemasState, setSchemasState] = useState<LoadableState<AllowedSchemasResponse | null>>({
    data: null,
    error: null,
    hasLoaded: false,
    isLoading: false
  });
  const [documentsState, setDocumentsState] = useState<LoadableState<PermanentDocumentRead[]>>({
    data: [],
    error: null,
    hasLoaded: false,
    isLoading: false
  });
  const [docViewerTarget, setDocViewerTarget] = useState<DocumentViewerTarget | null>(null);

  useEffect(() => {
    setUser(initialUser);
    setInstructionsValue(initialUser?.user_instructions ?? "");
    setInstructionsError(null);
    setInstructionsSuccess(null);
  }, [initialUser]);

  useEffect(() => {
    if (
      !isOpen ||
      !profileFeatures.accessibleSchemas ||
      !apps.includes("chatbi") ||
      schemasState.hasLoaded ||
      schemasState.isLoading
    ) {
      return;
    }

    let cancelled = false;

    async function loadSchemas() {
      setSchemasState((current) => ({
        ...current,
        error: null,
        isLoading: true
      }));

      try {
        const response = await fetch("/api/profile/accessible-schemas", {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(
            await readErrorMessage(
              response,
              "No se pudieron cargar los esquemas accesibles."
            )
          );
        }

        const payload = (await response.json()) as AllowedSchemasResponse;

        if (cancelled) {
          return;
        }

        setSchemasState({
          data: payload,
          error: null,
          hasLoaded: true,
          isLoading: false
        });
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setSchemasState({
          data: null,
          error:
            loadError instanceof Error
              ? loadError.message
              : "No se pudieron cargar los esquemas accesibles.",
          hasLoaded: true,
          isLoading: false
        });
      }
    }

    void loadSchemas();

    return () => {
      cancelled = true;
    };
  }, [
    apps,
    isOpen,
    profileFeatures.accessibleSchemas,
    schemasState.hasLoaded,
    schemasState.isLoading
  ]);

  useEffect(() => {
    if (
      !isOpen ||
      !profileFeatures.persistentDocuments ||
      documentsState.hasLoaded ||
      documentsState.isLoading
    ) {
      return;
    }

    let cancelled = false;

    async function loadDocuments() {
      setDocumentsState((current) => ({
        ...current,
        error: null,
        isLoading: true
      }));

      try {
        const response = await fetch("/api/profile/permanent-documents", {
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error(
            await readErrorMessage(
              response,
              "No se pudieron cargar los documentos permanentes."
            )
          );
        }

        const payload = (await response.json()) as PermanentDocumentRead[];

        if (cancelled) {
          return;
        }

        setDocumentsState({
          data: payload,
          error: null,
          hasLoaded: true,
          isLoading: false
        });
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setDocumentsState({
          data: [],
          error:
            loadError instanceof Error
              ? loadError.message
              : "No se pudieron cargar los documentos permanentes.",
          hasLoaded: true,
          isLoading: false
        });
      }
    }

    void loadDocuments();

    return () => {
      cancelled = true;
    };
  }, [
    documentsState.hasLoaded,
    documentsState.isLoading,
    isOpen,
    profileFeatures.persistentDocuments
  ]);

  const normalizedCurrentInstructions = user?.user_instructions ?? "";
  const normalizedDraftInstructions = instructionsValue.trim();
  const hasInstructionsChanges =
    normalizedDraftInstructions !== normalizedCurrentInstructions;
  const accessibleSchemas = schemasState.data?.schemas ?? [];
  const permanentDocuments = documentsState.data;

  async function saveInstructions() {
    if (!user || isSavingInstructions || !hasInstructionsChanges) {
      return;
    }

    setIsSavingInstructions(true);
    setInstructionsError(null);
    setInstructionsSuccess(null);

    try {
      const response = await fetch("/api/users/me/instructions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_instructions: normalizedDraftInstructions || null
        })
      });

      if (!response.ok) {
        throw new Error(
          await readErrorMessage(
            response,
            "No se pudieron guardar las instrucciones del usuario."
          )
        );
      }

      const updatedUser = (await response.json()) as UserRead;
      setUser(updatedUser);
      setInstructionsValue(updatedUser.user_instructions ?? "");
      setInstructionsSuccess("Preferencias guardadas.");
    } catch (saveError) {
      setInstructionsError(
        saveError instanceof Error
          ? saveError.message
          : "Error de red al guardar las instrucciones del usuario."
      );
    } finally {
      setIsSavingInstructions(false);
    }
  }

  function openPermanentDocument(document: PermanentDocumentRead) {
    if (!profileFeatures.documentPreview) {
      return;
    }

    const docSrc = document.ruta_completa?.trim() || document.nombre;
    const ext = docSrc.split(".").pop()?.toLowerCase() ?? "";

    type DocType = DocumentViewerTarget["type"];
    const EXT_MAP: Record<string, DocType> = {
      pdf: "pdf",
      docx: "docx",
      doc: "docx",
      xlsx: "xlsx",
      xls: "xlsx"
    };
    const docType: DocType = EXT_MAP[ext] ?? "unsupported";

    const targetUrl = new URL("/api/documents/source", "http://aitor.local");
    targetUrl.searchParams.set("doc_src", docSrc);

    setDocViewerTarget({
      title: document.nombre,
      type: docType,
      url: `${targetUrl.pathname}${targetUrl.search}`
    });
  }

  if (!isOpen) {
    return null;
  }

  return (
    <>
      {profileFeatures.documentPreview && ProfileDocumentViewerModal ? (
        <ProfileDocumentViewerModal
          onClose={() => setDocViewerTarget(null)}
          target={docViewerTarget}
        />
      ) : null}
      <div
        aria-hidden={!isOpen}
        className="profile-modal-backdrop"
        onClick={onClose}
      >
        <div
          aria-labelledby="profile-panel-title"
          aria-modal="true"
          className={`profile-modal${isMinimalProfile ? " profile-modal-minimal" : ""}`}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
        >
          <div className="profile-modal-header">
          <div>
            <span className="eyebrow">Mi Perfil</span>
            <h2 id="profile-panel-title">Perfil de usuario</h2>
          </div>

          <button
            aria-label="Cerrar Mi Perfil"
            className="profile-modal-close"
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
          </div>

          <section className="profile-section profile-section-identity">
          <p className="muted">Usuario autenticado</p>
          <p className="profile-identity-email">{email}</p>
          </section>

          {!isMinimalProfile ? <div className="profile-section-grid">
          {profileFeatures.instructions ? <section className="profile-section">
            <h3>Instrucciones del agente</h3>
            <p className="muted user-instructions-hint">
              Define como quieres que responda el agente en tus chats.
            </p>

            <textarea
              className="user-instructions-textarea"
              disabled={!user || isSavingInstructions}
              onChange={(event) => {
                setInstructionsValue(event.target.value);
                setInstructionsError(null);
                setInstructionsSuccess(null);
              }}
              placeholder="e.j: Responde siempre en espanol. Se conciso."
              rows={5}
              value={instructionsValue}
            />

            {instructionsError ? (
              <div className="banner banner-error">{instructionsError}</div>
            ) : null}

            {instructionsSuccess ? (
              <div className="banner banner-success">{instructionsSuccess}</div>
            ) : null}

            <div className="user-instructions-actions">
              <button
                className="btn btn-secondary"
                disabled={!user || isSavingInstructions || !hasInstructionsChanges}
                onClick={() => void saveInstructions()}
                type="button"
              >
                {isSavingInstructions ? "Guardando..." : "Guardar preferencias"}
              </button>
              <span className="muted user-instructions-meta">
                {normalizedDraftInstructions.length} caracteres
              </span>
            </div>
          </section> : null}

          {profileFeatures.accessibleSchemas && apps.includes("chatbi") ? <section className="profile-section">
            <h3>Esquemas accesibles</h3>
            <p className="muted">
              Listado personal de esquemas visibles desde ChatBI. Puede no estar
              disponible en este entorno o para usuarios sin acceso LDAP/RBAC.
            </p>

            <div className="profile-section-scrollable">
              {schemasState.isLoading ? (
                <p className="muted">
                  Cargando esquemas accesibles. Si este usuario no tiene acceso, la
                  lista puede no llegar a mostrarse.
                </p>
              ) : null}

              {!schemasState.isLoading && schemasState.error ? (
                <div className="banner banner-error">{schemasState.error}</div>
              ) : null}

              {!schemasState.isLoading &&
              !schemasState.error &&
              schemasState.hasLoaded &&
              accessibleSchemas.length === 0 ? (
                <p className="muted">
                  No hay esquemas accesibles visibles para este usuario en el
                  entorno actual.
                </p>
              ) : null}

              {!schemasState.isLoading && !schemasState.error && accessibleSchemas.length > 0 ? (
                <ul className="profile-resource-list">
                  {accessibleSchemas.map((schema) => (
                    <li className="profile-resource-item" key={schema.schema}>
                      <strong>{schema.schema}</strong>
                      <span className="muted">
                        {schema.descripcion?.trim() || "Sin descripcion disponible"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </section> : null}

          {profileFeatures.persistentDocuments ? <section className="profile-section">
            <h3>Documentos permanentes</h3>
            <p className="muted">
              Biblioteca personal accesible desde ChatDocs, solo en modo listado.
              Puede no estar disponible en este entorno o para usuarios sin acceso
              LDAP/RBAC.
            </p>

            <div className="profile-section-scrollable">
              {documentsState.isLoading ? (
                <p className="muted">
                  Cargando documentos permanentes. Si este usuario no tiene acceso,
                  la biblioteca puede no llegar a mostrarse.
                </p>
              ) : null}

              {!documentsState.isLoading && documentsState.error ? (
                <div className="banner banner-error">{documentsState.error}</div>
              ) : null}

              {!documentsState.isLoading &&
              !documentsState.error &&
              documentsState.hasLoaded &&
              permanentDocuments.length === 0 ? (
                <p className="muted">
                  No hay documentos permanentes visibles para este usuario en el
                  entorno actual.
                </p>
              ) : null}

              {!documentsState.isLoading &&
              !documentsState.error &&
              permanentDocuments.length > 0 ? (() => {
                const { folders, rootFiles } = buildDocumentTree(permanentDocuments);
                const hasTree = Object.keys(folders).length > 0 || rootFiles.length > 0;

                if (!hasTree) {
                  return null;
                }

                return (
                  <ul className="doc-tree">
                    {Object.entries(folders).sort(([a], [b]) => a.localeCompare(b)).map(([name, node]) => (
                      <DocFolder
                        key={name}
                        name={name}
                        node={node}
                        onOpenFile={(entry) => openPermanentDocument({
                          nombre: entry.displayName,
                          resumen: entry.resumen,
                          ruta_completa: entry.rutaCompleta
                        })}
                      />
                    ))}
                    {rootFiles.map((file) => (
                      <li className="doc-file" key={file.rutaCompleta}>
                        <button
                          className="profile-resource-link doc-file-link"
                          onClick={() => openPermanentDocument({
                            nombre: file.displayName,
                            resumen: file.resumen,
                            ruta_completa: file.rutaCompleta
                          })}
                          type="button"
                        >
                          <span className="doc-file-icon">📄</span>
                          {file.displayName}
                        </button>
                        {file.resumen && file.resumen !== "Sin resumen disponible" ? (
                          <span className="muted doc-file-summary">{file.resumen}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                );
              })() : null}
            </div>
          </section> : null}
          </div> : null}
        </div>
      </div>
    </>
  );
}
