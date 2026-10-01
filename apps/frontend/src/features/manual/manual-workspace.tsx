"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatCount, formatPercent, type ManualStats } from "@/lib/manual-stats";

const workflow = [
  {
    number: "01",
    title: "Clasificación",
    summary: "Identifica facturas de gas y mixtas.",
    objective: "Localizar y entender la factura",
    href: "/hidrocarburos",
    instructions: [
      "Acota el periodo y utiliza los filtros de proveedor, centro, clave SAT o clasificación.",
      "Revisa el material, la cantidad, el importe de gas y las claves SAT detectadas.",
      "Una factura puede tener muchas líneas (conceptos). Se leen todas, pero solo las de gas suman al importe de gas.",
      "Abre una fila para consultar el detalle: cada concepto de gas con su clave SAT, cantidad e importe.",
      "En una factura mixta, toma como referencia el importe de los conceptos clasificados como gas, no el total del CFDI."
    ],
    check: "Confirma que el importe de gas y la clasificación sean coherentes antes de continuar: en una factura mixta, el importe de gas es menor que el total del CFDI."
  },
  {
    number: "02",
    title: "Compras",
    summary: "Comprueba SAP, MSEG, CECO y centro.",
    objective: "Realizar la validación operativa",
    href: "/compras",
    instructions: [
      "Selecciona una factura pendiente y revisa su correspondencia con SAP.",
      "Comprueba la evidencia MSEG, el pedido y la recepción cuando estén disponibles.",
      "Si la factura incluye varias entregas, el detalle muestra una fila por ticket (cantidad, importe, CECO y núcleo) y cuántos tickets casan exacto con la recepción.",
      "Confirma o corrige el CECO y el centro. Si el gasto se reparte entre varios CECO, indica el CECO de cada grupo de tickets.",
      "Usa el filtro «CECO sugerido» para aislar las facturas sin sugerencia, cuyo CECO se captura a mano.",
      "Valida la factura para enviarla a Gerencia o recházala indicando el motivo."
    ],
    check: "Un estado «Sin match», una evidencia MSEG media o tickets que no casan exacto requieren una revisión especialmente cuidadosa."
  },
  {
    number: "03",
    title: "Aprobación",
    summary: "Gerencia toma la decisión final.",
    objective: "Aprobar o rechazar con trazabilidad",
    href: "/aprobacion",
    instructions: [
      "Revisa los datos fiscales y la validación realizada por Compras.",
      "Comprueba el importe de gas, el CECO (o el reparto por ticket, si lo hay), el núcleo, el centro y los comentarios previos.",
      "Aprueba la factura o recházala dejando una justificación clara.",
      "Utiliza el historial para consultar la trazabilidad y reabrir un caso cuando corresponda."
    ],
    check: "No apruebes una factura si existe una diferencia sin explicar."
  },
  {
    number: "04",
    title: "Dashboard",
    summary: "Supervisa estados, importes y cobertura.",
    objective: "Dar seguimiento al proceso",
    href: "/dashboard",
    instructions: [
      "Selecciona el periodo y los filtros que quieras analizar.",
      "Consulta los indicadores de importe, clasificación y estado de aprobación.",
      "Revisa por separado la cobertura de SAP, SAT y MSEG.",
      "Analiza el gasto por proveedor, centro, CECO y núcleo. Si una factura reparte su gasto entre varios CECO confirmados, su importe se divide proporcionalmente entre ellos.",
      "Usa los gráficos para detectar facturas sin coincidencia, sin evidencia o pendientes."
    ],
    check: "Combina los filtros para investigar los indicadores que requieran atención."
  }
];

type WorkflowStep = (typeof workflow)[number];
type ReconciliationTopic = "sap" | "mseg" | "sitio";

const updatedFormatter = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });

export function ManualWorkspace({ stats }: { stats: ManualStats | null }) {
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
  const [isLifecycleOpen, setIsLifecycleOpen] = useState(false);
  const [isReconciliationOpen, setIsReconciliationOpen] = useState(false);
  const [reconciliationTopic, setReconciliationTopic] = useState<ReconciliationTopic>("sap");
  const [isCecoOpen, setIsCecoOpen] = useState(false);

  useEffect(() => {
    if (!selectedStep && !isLifecycleOpen && !isReconciliationOpen && !isCecoOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedStep(null);
        setIsLifecycleOpen(false);
        setIsReconciliationOpen(false);
        setIsCecoOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isCecoOpen, isLifecycleOpen, isReconciliationOpen, selectedStep]);

  return (
    <main className="manual-page">
      <section className="manual-hero">
        <div>
          <p className="manual-eyebrow">Centro de ayuda</p>
          <h1>Manual de usuario</h1>
          <p className="manual-intro">
            Clasifica facturas de hidrocarburos, valida su información y da seguimiento a su aprobación.
          </p>
        </div>
        <div className="manual-update">
          <span aria-hidden="true" />
          <p><strong>Actualización diaria</strong>{stats?.updatedAt ? ` · Datos del ${updatedFormatter.format(new Date(stats.updatedAt))}` : ""} · Las acciones dependen de tu perfil.</p>
        </div>
      </section>

      <section className="manual-workspace" aria-labelledby="manual-flow-title">
        <div className="manual-main-card">
          <div className="manual-section-heading">
            <div>
              <p>Flujo de trabajo</p>
              <h2 id="manual-flow-title">Selecciona un paso para ver cómo se utiliza</h2>
            </div>
            <span>4 pasos</span>
          </div>

          <div className="manual-flow">
            {workflow.map((step) => (
              <div className="manual-step-row" key={step.number}>
                <button
                  className="manual-step"
                  onClick={() => setSelectedStep(step)}
                  type="button"
                >
                  <span className="manual-step-number">{step.number}</span>
                  <span className="manual-step-copy">
                    <strong>{step.title}</strong>
                    <small>{step.summary}</small>
                  </span>
                  <span className="manual-step-action">Ver instrucciones</span>
                </button>
              </div>
            ))}
          </div>

          <button
            className="manual-lifecycle-trigger"
            onClick={() => setIsLifecycleOpen(true)}
            type="button"
          >
            <span>
              <strong>Ciclo de vida de una factura</strong>
              <small>Abre el esquema completo de estados y decisiones</small>
            </span>
            <i aria-hidden="true">↗</i>
          </button>
        </div>

        <aside className="manual-reconciliation-placeholder manual-reconciliation-panel">
          <p className="manual-eyebrow">Cómo se valida</p>
          <h2>Resumen de conciliación</h2>

          <div className="manual-reconciliation-stats" aria-label={stats ? `Resultados de conciliación (universo actual: ${formatCount(stats.total)} facturas)` : "Resultados de conciliación (no disponibles)"}>
            <div><span>Cobertura SAP</span><strong>{formatPercent(stats?.validadasSap, stats?.total)}</strong></div>
            <div><span>Confianza MSEG alta</span><strong>{formatPercent(stats?.msegAlta, stats?.total)}</strong></div>
            <div><span>Centro detectado</span><strong>{formatPercent(stats?.conSitio, stats?.total)}</strong></div>
            <div className="is-attention"><span>CECO con varias opciones</span><strong>{formatCount(stats?.cecoVariasOpciones)}</strong></div>
          </div>
          <p className="manual-reconciliation-note" role={stats ? undefined : "status"}>
            {stats
              ? `Sobre ${formatCount(stats.total)} facturas de gas. Cifras calculadas con los datos actuales.`
              : "No se pudieron cargar las cifras en este momento. Recarga la página para volver a intentarlo."}
          </p>

          <div className="manual-reconciliation-actions" aria-label="Explicaciones de conciliación">
            <button
              onClick={() => {
                setReconciliationTopic("sap");
                setIsReconciliationOpen(true);
              }}
              type="button"
            >
              <span><strong>SAP</strong><small>Coincidencia contable</small></span>
              <i aria-hidden="true">↗</i>
            </button>
            <button
              onClick={() => {
                setReconciliationTopic("mseg");
                setIsReconciliationOpen(true);
              }}
              type="button"
            >
              <span><strong>MSEG</strong><small>Recepción física</small></span>
              <i aria-hidden="true">↗</i>
            </button>
            <button
              onClick={() => {
                setReconciliationTopic("sitio");
                setIsReconciliationOpen(true);
              }}
              type="button"
            >
              <span><strong>Centro</strong><small>Planta de consumo</small></span>
              <i aria-hidden="true">↗</i>
            </button>
          </div>

          <button
            className="manual-lifecycle-trigger manual-ceco-trigger"
            onClick={() => setIsCecoOpen(true)}
            type="button"
          >
            <span>
              <strong>El problema del CECO</strong>
              <small>Por qué salen varios centros de costo candidatos</small>
            </span>
            <i aria-hidden="true">↗</i>
          </button>
        </aside>
      </section>

      {selectedStep ? (
        <div
          aria-labelledby="manual-modal-title"
          aria-modal="true"
          className="manual-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedStep(null);
          }}
          role="dialog"
        >
          <article className="manual-modal">
            <header>
              <div>
                <span className="manual-step-number">{selectedStep.number}</span>
                <div>
                  <p>{selectedStep.title}</p>
                  <h2 id="manual-modal-title">{selectedStep.objective}</h2>
                </div>
              </div>
              <button aria-label="Cerrar instrucciones" onClick={() => setSelectedStep(null)} type="button">×</button>
            </header>
            <ol>
              {selectedStep.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
            </ol>
            <div className="manual-modal-check">
              <span aria-hidden="true">✓</span>
              <p><strong>Antes de continuar</strong>{selectedStep.check}</p>
            </div>
            <footer>
              <button onClick={() => setSelectedStep(null)} type="button">Cerrar</button>
              <Link href={selectedStep.href} prefetch={false}>Ir a {selectedStep.title} <span aria-hidden="true">→</span></Link>
            </footer>
          </article>
        </div>
      ) : null}

      {isLifecycleOpen ? (
        <div
          aria-labelledby="manual-lifecycle-title"
          aria-modal="true"
          className="manual-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setIsLifecycleOpen(false);
          }}
          role="dialog"
        >
          <article className="manual-lifecycle-modal">
            <header>
              <div>
                <p>Guía visual</p>
                <h2 id="manual-lifecycle-title">Ciclo de vida de una factura</h2>
                <span>Qué ocurre desde que se clasifica hasta que se aprueba, rechaza o reabre.</span>
              </div>
              <button aria-label="Cerrar esquema" onClick={() => setIsLifecycleOpen(false)} type="button">×</button>
            </header>

            <div className="manual-lifecycle-scroll">
              <div className="manual-lifecycle-canvas">
                <svg aria-hidden="true" className="manual-lifecycle-lines" preserveAspectRatio="none" viewBox="0 0 1000 540">
                  <defs>
                    <marker id="manual-arrow-purple" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                      <path d="M0,0 L8,4 L0,8 Z" fill="#55559a" />
                    </marker>
                    <marker id="manual-arrow-red" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                      <path d="M0,0 L8,4 L0,8 Z" fill="#a65b4c" />
                    </marker>
                  </defs>
                  <path className="is-main" d="M500 62 C500 105 360 92 360 137" />
                  <path className="is-main" d="M360 194 L360 274" />
                  <path className="is-main" d="M360 331 C360 374 260 367 260 410" />
                  <path className="is-reject" d="M480 302 C600 302 615 410 690 438" />
                  <path className="is-return" d="M238 302 C110 302 110 164 232 164" />
                  <path className="is-coverage" d="M605 49 L650 49" />
                </svg>

                <span className="manual-diagram-action is-start-review">Comenzar revisión</span>
                <span className="manual-diagram-action is-validate">Compras valida</span>
                <span className="manual-diagram-action is-approve">Gerencia aprueba</span>
                <span className="manual-diagram-action is-reject">Gerencia rechaza</span>
                <span className="manual-diagram-action is-reopen">Reabrir · vuelve a Compras</span>

                <div className="manual-diagram-node is-classified">
                  <span>Inicio</span><strong>Factura clasificada</strong><small>Lista para revisar</small>
                </div>
                <div className="manual-diagram-node is-purchases">
                  <span>Paso 1</span><strong>Revisión de Compras</strong><small>Comprueba los datos y confirma CECO y centro</small>
                </div>
                <div className="manual-diagram-node is-management">
                  <span>Paso 2</span><strong>Revisión de Gerencia</strong><small>Evalúa la información preparada por Compras</small>
                </div>
                <div className="manual-diagram-node is-approved">
                  <span>Resultado</span><strong>Aprobada</strong><small>La revisión finaliza correctamente</small>
                </div>
                <div className="manual-diagram-node is-rejected">
                  <span>Decisión de Gerencia</span><strong>Rechazada</strong><small>Gerencia rechaza la factura e indica el motivo</small>
                </div>
                <div className="manual-diagram-coverage">
                  <span>Cobertura disponible</span>
                  <strong>Puede tener cobertura SAP, MSEG o ambas</strong>
                  <div><i>SAP</i><i>MSEG</i></div>
                </div>
              </div>
            </div>

            <footer>
              <span><i className="is-review" /> Revisión</span>
              <span><i className="is-approved" /> Aprobación</span>
              <span><i className="is-rejected" /> Rechazo</span>
              <button onClick={() => setIsLifecycleOpen(false)} type="button">Cerrar esquema</button>
            </footer>
          </article>
        </div>
      ) : null}

      {isReconciliationOpen ? (
        <div
          aria-labelledby="manual-reconciliation-title"
          aria-modal="true"
          className="manual-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setIsReconciliationOpen(false);
          }}
          role="dialog"
        >
          <article className="manual-reconciliation-modal">
            <header>
              <div>
                <p>Cómo se valida</p>
                <h2 id="manual-reconciliation-title">
                  {reconciliationTopic === "sap"
                    ? "Cobertura SAP"
                    : reconciliationTopic === "mseg"
                      ? "Confianza MSEG"
                      : "Centro detectado"}
                </h2>
                <span>
                  {reconciliationTopic === "sap"
                    ? "Cómo se comprueba la coincidencia contable de la factura."
                    : reconciliationTopic === "mseg"
                      ? "Cómo se mide la evidencia física de recepción."
                      : "Cómo se identifica la planta donde se consumió el gas."}
                </span>
              </div>
              <button aria-label="Cerrar resumen" onClick={() => setIsReconciliationOpen(false)} type="button">×</button>
            </header>

            <div className="manual-reconciliation-scroll">
              <div className="manual-reconciliation-topic-detail">
                {reconciliationTopic === "sap" ? (
                  <>
                    <p className="manual-reconciliation-intro">
                      La herramienta busca el folio de la factura en los registros contables de SAP.
                    </p>
                    <ol className="manual-reconciliation-steps">
                      <li><strong>Busca el folio</strong><span>en el asiento contable y en las partidas del proveedor.</span></li>
                      <li><strong>Contrasta la coincidencia</strong><span>con partidas abiertas o pagadas.</span></li>
                      <li><strong>Asigna el resultado</strong><span>como Validada SAP o Sin match SAP.</span></li>
                    </ol>
                  </>
                ) : reconciliationTopic === "mseg" ? (
                  <>
                    <p className="manual-reconciliation-intro">
                      Compara la factura con la recepción de mercancía registrada en SAP: la evidencia de que el gas
                      llegó físicamente a la planta.
                    </p>
                    <p className="manual-reconciliation-intro">
                      Una factura puede incluir varias líneas de entrega (tickets). Cada ticket de gas se compara por
                      importe con una línea de la recepción, y la factura se compara también con el documento completo.
                      Solo cuentan las líneas de gas.
                    </p>
                    <ul className="manual-reconciliation-levels">
                      <li>
                        <span className="manual-reconciliation-dot is-alta" aria-hidden="true" />
                        <span>
                          <strong>Alta</strong> — folio e importe coinciden con el documento (con una tolerancia mínima de redondeo), o todos los tickets de la
                          factura casan con su propia línea de la recepción, aunque el documento de SAP agrupe otras
                          entregas.
                        </span>
                      </li>
                      <li>
                        <span className="manual-reconciliation-dot is-media" aria-hidden="true" />
                        <span>
                          <strong>Media</strong> — el folio coincide, pero el importe no cuadra con el documento (por
                          ejemplo, porque SAP agrupa varias entregas) y los tickets no se pueden casar uno a uno.
                        </span>
                      </li>
                      <li>
                        <span className="manual-reconciliation-dot is-sin" aria-hidden="true" />
                        <span><strong>Sin evidencia</strong> — no se encontró una recepción asociada al folio.</span>
                      </li>
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="manual-reconciliation-intro">
                      La herramienta sigue el folio hasta el pedido de compra para identificar la planta donde se
                      recibió y consumió el gas.
                    </p>
                    <ol className="manual-reconciliation-steps">
                      <li><strong>Localiza la factura</strong><span>y recupera el pedido relacionado.</span></li>
                      <li><strong>Consulta la recepción</strong><span>para obtener la planta de destino.</span></li>
                      <li><strong>Propone el centro</strong><span>y permite que Compras lo corrija si es necesario.</span></li>
                    </ol>
                  </>
                )}
              </div>
            </div>

            <footer>
              <div className="manual-modal-check">
                <span aria-hidden="true">✓</span>
                <p>
                  <strong>Antes de continuar</strong>
                  {reconciliationTopic === "sap"
                    ? "Sin match SAP requiere revisión, pero no bloquea la validación."
                    : reconciliationTopic === "mseg"
                      ? "Una confianza media o sin evidencia requiere revisar el detalle antes de decidir."
                      : "Si no se detecta el centro, Compras puede seleccionarlo manualmente."}
                </p>
              </div>
            </footer>
          </article>
        </div>
      ) : null}

      {isCecoOpen ? (
        <div
          aria-labelledby="manual-ceco-title"
          aria-modal="true"
          className="manual-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setIsCecoOpen(false);
          }}
          role="dialog"
        >
          <article className="manual-reconciliation-modal">
            <header>
              <div>
                <p>Por qué pasa</p>
                <h2 id="manual-ceco-title">El problema del CECO</h2>
                <span>Por qué una misma factura puede tener varios centros de costo candidatos.</span>
              </div>
              <button aria-label="Cerrar explicación" onClick={() => setIsCecoOpen(false)} type="button">×</button>
            </header>

            <div className="manual-reconciliation-scroll">
              <p className="manual-reconciliation-intro">
                El CECO no viene ligado a la factura de gas en ningún sistema de origen — se sugiere a partir de otra
                evidencia, y por eso a veces sale un único candidato claro y otras veces varios.
              </p>

              <div className="manual-reconciliation-grid">
                <div className="manual-reconciliation-card manual-reconciliation-card--wide">
                  <h3>Por qué no existe un CECO exacto</h3>
                  <p>
                    Para cargar el gasto al centro de costo correcto automáticamente haría falta que el pedido de
                    compra o el asiento contable trajeran esa imputación. Para estos proveedores de gas, ese dato no
                    está disponible en los sistemas de origen hoy — es una limitación de los datos, no algo que la
                    herramienta pueda calcular mejor.
                  </p>
                </div>

                <div className="manual-reconciliation-card manual-reconciliation-card--wide">
                  <h3>De dónde sale entonces la sugerencia</h3>
                  <p>
                    Se aplican tres reglas en este orden y gana la primera que encuentra datos: el desglose por
                    ticket (cuando todos los tickets de la factura coinciden con la recepción), el proveedor que
                    entrega casi siempre al mismo centro de costo y, por último, el documento de recepción física que
                    da la evidencia MSEG: cuando el gas llega a planta, SAP registra a qué centro (o centros) de costo
                    se repartió esa entrega.
                  </p>
                </div>

                <div className="manual-reconciliation-card manual-reconciliation-card--wide">
                  <h3>Por qué a veces salen varios</h3>
                  <p>
                    Cuando una entrega se repartió entre varias plantas o departamentos al recibirla, el documento de
                    SAP trae más de un centro de costo — y no hay ninguna pista adicional en la factura para saber
                    cuál corresponde.{" "}
                    {stats ? (
                      <>
                        Le pasa hoy a <strong>{formatCount(stats.cecoVariasOpciones)} de las {formatCount(stats.total)} facturas ({formatPercent(stats.cecoVariasOpciones, stats.total)})</strong>
                      </>
                    ) : (
                      "Le pasa a una parte de las facturas"
                    )}
                    : en esos casos, Compras elige con criterio entre las opciones que se muestran.
                  </p>
                </div>

                <div className="manual-reconciliation-card">
                  <h3>Reparto por ticket</h3>
                  <p>
                    Si todos los tickets de la factura coinciden con la recepción, el reparto entre centros de costo
                    viene respaldado línea a línea y no hay nada que elegir — <strong>{formatCount(stats?.cecoTicket)} facturas</strong> hoy.
                  </p>
                </div>

                <div className="manual-reconciliation-card">
                  <h3>Sugerencia por proveedor</h3>
                  <p>
                    Si un proveedor entrega casi siempre al mismo centro de costo, se le sugiere ese a todas sus
                    facturas que no se resolvieron por ticket — <strong>{formatCount(stats?.cecoProveedor)} facturas</strong> hoy.
                  </p>
                </div>

                <div className="manual-reconciliation-card">
                  <h3>Sugerencia por documento</h3>
                  <p>
                    Si la entrega de esta factura en particular no se repartió, el documento trae un único centro de
                    costo y no hay ambigüedad — <strong>{formatCount(stats?.cecoDocumento)} facturas</strong> hoy.
                  </p>
                </div>

                <div className="manual-reconciliation-card">
                  <h3>Sin sugerencia</h3>
                  <p>
                    Si ninguna regla encuentra un centro de costo, la factura queda sin sugerencia y Compras lo
                    captura a mano — <strong>{formatCount(stats?.cecoSinSugerencia)} facturas</strong> hoy.
                  </p>
                </div>
              </div>
            </div>

            <footer>
              <div className="manual-modal-check">
                <span aria-hidden="true">✓</span>
                <p>
                  <strong>Antes de continuar</strong>
                  El CECO sugerido nunca bloquea la aprobación — Compras puede editarlo siempre, tenga sugerencia o no. Si el gasto se reparte entre varios CECO, Compras confirma uno por cada grupo de tickets.
                </p>
              </div>
            </footer>
          </article>
        </div>
      ) : null}
    </main>
  );
}
