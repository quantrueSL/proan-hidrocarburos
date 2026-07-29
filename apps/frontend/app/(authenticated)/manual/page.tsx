"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const workflow = [
  {
    number: "01",
    title: "Clasificación",
    summary: "Identifica facturas de gas y mixtas.",
    objective: "Localizar y entender la factura",
    href: "/hidrocarburos",
    instructions: [
      "Acota el periodo y utiliza los filtros de proveedor, sitio, clave SAT o clasificación.",
      "Revisa el material, la cantidad, el importe de gas y las claves SAT detectadas.",
      "Abre una fila para consultar el detalle completo de la factura.",
      "En una factura mixta, toma como referencia el importe de los conceptos clasificados como gas."
    ],
    check: "Confirma que el importe de gas y la clasificación sean coherentes antes de continuar."
  },
  {
    number: "02",
    title: "Compras",
    summary: "Comprueba SAP, MSEG, CECO y sitio.",
    objective: "Realizar la validación operativa",
    href: "/compras",
    instructions: [
      "Selecciona una factura pendiente y revisa su correspondencia con SAP.",
      "Comprueba la evidencia MSEG, el pedido y la recepción cuando estén disponibles.",
      "Confirma o corrige el CECO y el sitio; añade un comentario si aporta contexto.",
      "Valida la factura para enviarla a Gerencia o recházala indicando el motivo."
    ],
    check: "Un estado «Sin match» o una evidencia MSEG media requieren una revisión especialmente cuidadosa."
  },
  {
    number: "03",
    title: "Aprobación",
    summary: "Gerencia toma la decisión final.",
    objective: "Aprobar o rechazar con trazabilidad",
    href: "/aprobacion",
    instructions: [
      "Revisa los datos fiscales y la validación realizada por Compras.",
      "Comprueba el importe de gas, el CECO, el sitio y los comentarios previos.",
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
      "Usa los gráficos para detectar facturas sin coincidencia, sin evidencia o pendientes."
    ],
    check: "Combina los filtros para investigar los indicadores que requieran atención."
  }
];

type WorkflowStep = (typeof workflow)[number];
type ReconciliationTopic = "sap" | "mseg" | "sitio";

export default function ManualPage() {
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
          <p><strong>Actualización diaria</strong> · Las acciones dependen de tu perfil.</p>
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

          <div className="manual-reconciliation-stats" aria-label="Resultados de conciliación (universo actual: 547 facturas)">
            <div><span>Cobertura SAP</span><strong>91,2%</strong></div>
            <div><span>Confianza MSEG alta</span><strong>81,4%</strong></div>
            <div><span>Sitio detectado</span><strong>70,4%</strong></div>
            <div className="is-attention"><span>CECO con varias opciones</span><strong>250</strong></div>
          </div>

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
              <span><strong>Sitio</strong><small>Planta de consumo</small></span>
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
                  <span>Paso 1</span><strong>Revisión de Compras</strong><small>Comprueba los datos y confirma CECO y sitio</small>
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
                      : "Sitio detectado"}
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
                    <ul className="manual-reconciliation-levels">
                      <li>
                        <span className="manual-reconciliation-dot is-alta" aria-hidden="true" />
                        <span><strong>Alta</strong> — folio y monto coinciden de forma exacta.</span>
                      </li>
                      <li>
                        <span className="manual-reconciliation-dot is-media" aria-hidden="true" />
                        <span><strong>Media</strong> — el folio coincide, pero SAP agrupa varias entregas.</span>
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
                      <li><strong>Propone el sitio</strong><span>y permite que Compras lo corrija si es necesario.</span></li>
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
                      : "Si no se detecta el sitio, Compras puede seleccionarlo manualmente."}
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
                    Del mismo documento de recepción física que da la evidencia MSEG: cuando el gas llega a planta,
                    SAP registra a qué centro (o centros) de costo se repartió esa entrega.
                  </p>
                </div>

                <div className="manual-reconciliation-card manual-reconciliation-card--wide">
                  <h3>Por qué a veces salen varios</h3>
                  <p>
                    Cuando una entrega se repartió entre varias plantas o departamentos al recibirla, el documento de
                    SAP trae más de un centro de costo — y no hay ninguna pista adicional en la factura para saber
                    cuál corresponde. Le pasa hoy a <strong>250 de las 547 facturas (46%)</strong>: en esos casos,
                    Compras elige con criterio entre las opciones que se muestran.
                  </p>
                </div>

                <div className="manual-reconciliation-card">
                  <h3>Sugerencia por proveedor</h3>
                  <p>
                    Si un proveedor entrega casi siempre al mismo centro de costo, se le sugiere ese a todas sus
                    facturas — <strong>123 facturas</strong> hoy.
                  </p>
                </div>

                <div className="manual-reconciliation-card">
                  <h3>Sugerencia por documento</h3>
                  <p>
                    Si la entrega de esta factura en particular no se repartió, el documento trae un único centro de
                    costo y no hay ambigüedad — <strong>99 facturas</strong> hoy.
                  </p>
                </div>
              </div>
            </div>

            <footer>
              <div className="manual-modal-check">
                <span aria-hidden="true">✓</span>
                <p>
                  <strong>Antes de continuar</strong>
                  El CECO sugerido nunca bloquea la aprobación — Compras puede editarlo siempre, tenga sugerencia o no.
                </p>
              </div>
            </footer>
          </article>
        </div>
      ) : null}
    </main>
  );
}
