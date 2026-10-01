"use client";

import { useEffect, useState, type ReactNode } from "react";

export type GuideFilters = { fechaDesde: string; fechaHasta: string; nucleos: string[]; rfcs: string[]; uuid: string };
type Props = { apiUrl: string; filters: GuideFilters; onClose: () => void };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABS = [
  { id: "inicio", label: "Primeros pasos" },
  { id: "busqueda", label: "Búsqueda" },
  { id: "respuesta", label: "Respuesta y paginación" },
  { id: "descargas", label: "Descargas" },
  { id: "errores", label: "Errores" }
] as const;
type TabId = (typeof TABS)[number]["id"];

const EXAMPLE_UUID = "00000000-0000-0000-0000-000000000000";

const BACKSLASH = String.fromCharCode(92);
type Shell = "bash" | "powershell";
const SHELLS: { id: Shell; label: string }[] = [
  { id: "bash", label: "macOS / Linux / Git Bash" },
  { id: "powershell", label: "Windows PowerShell" }
];

function shellLabel(shell: Shell) {
  return SHELLS.find((item) => item.id === shell)?.label ?? "Terminal";
}

/** Binario y cabecera de la key, distintos en cada terminal. */
function curlBin(shell: Shell) {
  return shell === "powershell" ? "curl.exe" : "curl";
}

function keyHeader(shell: Shell) {
  return shell === "powershell" ? `-H "x-api-key: $env:FACTURAS_API_KEY"` : `-H "x-api-key: $FACTURAS_API_KEY"`;
}

function quote(shell: Shell, value: string) {
  return shell === "powershell" ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, `'${BACKSLASH}''`)}'`;
}

/** Une líneas de un mismo comando con la continuación propia de cada terminal. */
function multiline(shell: Shell, lines: string[]) {
  const continuation = shell === "powershell" ? " `" : ` ${BACKSLASH}`;
  return lines.join(`${continuation}\n`);
}

function curlGet(shell: Shell, url: string) {
  return `${curlBin(shell)} ${keyHeader(shell)} "${url}"`;
}

function curlSearch(shell: Shell, apiUrl: string, params: [string, string][]) {
  return multiline(shell, [`${curlBin(shell)} -G "${apiUrl}/v1/facturas"`, `  ${keyHeader(shell)}`, ...params.map(([name, value]) => `  --data-urlencode ${quote(shell, `${name}=${value}`)}`)]);
}

const PARAMETERS: { name: string; type: string; repeatable: boolean; text: string; example: string }[] = [
  { name: "fecha_desde", type: "Fecha AAAA-MM-DD", repeatable: false, text: "Fecha de emisión mínima, incluida. Solo se compara el día; la hora de la factura se ignora.", example: "2026-01-01" },
  { name: "fecha_hasta", type: "Fecha AAAA-MM-DD", repeatable: false, text: "Fecha de emisión máxima, incluida. No puede ser anterior a fecha_desde (si lo es, la API responde 400).", example: "2026-01-31" },
  { name: "rfc_emisor", type: "Texto", repeatable: true, text: "RFC exacto del proveedor que emitió la factura, en mayúsculas.", example: "AAA010101AAA" },
  { name: "nucleo", type: "Texto", repeatable: true, text: "Nombre exacto del núcleo, con los mismos acentos y mayúsculas que se ven en la página. No es un identificador numérico.", example: "Agua Fría" },
  { name: "serie", type: "Texto", repeatable: false, text: "Serie de la factura, comparación exacta.", example: "A" },
  { name: "folio", type: "Texto", repeatable: false, text: "Folio de la factura, comparación exacta. Por sí solo no identifica una factura: se repite entre proveedores y ejercicios.", example: "1234" },
  { name: "limit", type: "Entero 1–100", repeatable: false, text: "Cuántas facturas devuelve como máximo la petición. Por defecto y como máximo, 100.", example: "100" },
  { name: "offset", type: "Entero ≥ 0", repeatable: false, text: "Cuántas facturas se saltan desde el principio del resultado. Sirve para pedir la página siguiente.", example: "100" }
];

const FIELDS: [string, string][] = [
  ["uuid", "Identificador fiscal de la factura (folio fiscal del SAT). Es la clave para consultar o descargar una factura concreta."],
  ["serie / folio", "Serie y folio impresos en la factura. Cualquiera de los dos puede ser null."],
  ["fecha", "Fecha y hora de emisión en formato ISO, por ejemplo 2026-01-15T09:36:14."],
  ["rfc_emisor / nombre_emisor", "RFC y razón social del proveedor."],
  ["total / moneda", "Importe total como número (sin símbolo ni separador de miles) y la moneda del CFDI, por ejemplo MXN."],
  ["estatus_cancelacion_sat", "Estatus de cancelación ante el SAT, por ejemplo vigente o cancelado. Es null si no hay estatus registrado."],
  ["nucleos", "Lista de núcleos confirmados para la factura. Es una lista vacía si ninguno está confirmado; en esa situación la factura no aparece al filtrar por núcleo."],
  ["urls", "Rutas relativas de los documentos. Antepón la URL base para formar la dirección completa."]
];

const ERRORS: { status: string; code: string; when: string; todo: string }[] = [
  { status: "400", code: "parametros_invalidos", when: "Parámetro mal formado, por ejemplo fecha_desde posterior a fecha_hasta.", todo: "Corrige el parámetro que indica el mensaje." },
  { status: "401 / 403", code: "—", when: "Falta la cabecera x-api-key o la key no es válida. Lo responde el gateway, antes de llegar a la API.", todo: "Comprueba que la cabecera se escribe exactamente x-api-key y que la variable de entorno tiene valor." },
  { status: "404", code: "factura_no_encontrada", when: "El UUID no existe o la factura no pertenece a las facturas de gas. Los dos casos dan la misma respuesta.", todo: "Revisa el UUID. La búsqueda por filtros nunca da 404: sin coincidencias devuelve []." },
  { status: "422", code: "—", when: "Un parámetro tiene un tipo incorrecto, por ejemplo limit=abc o una fecha que no existe.", todo: "Respeta los tipos de la tabla de parámetros." },
  { status: "429", code: "—", when: "Se superó la cuota de peticiones asignada a la key. Lo responde el gateway.", todo: "Espera unos segundos y reduce el ritmo; no lances descargas en paralelo." },
  { status: "500", code: "error_interno", when: "Fallo inesperado del servicio, por ejemplo que la base de datos no responda.", todo: "Reintenta pasado un momento. Si persiste, avisa al equipo responsable de la API." },
  { status: "503", code: "generacion_no_disponible", when: "La factura existe, pero no se pudo reconstruir su XML o generar su PDF.", todo: "Reintenta. Si ese UUID siempre falla, avisa con el UUID concreto." }
];

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { /* sin permiso de portapapeles: el usuario puede seleccionar el texto */ }
  }
  return <div className="api-code">
    <div className="api-code-bar"><span>{label}</span><button onClick={copy} type="button">{copied ? "Copiado" : "Copiar"}</button></div>
    <pre>{code}</pre>
  </div>;
}

function Step({ children, number, title }: { children: ReactNode; number: number; title: string }) {
  return <section><h3><i aria-hidden="true">{number}</i>{title}</h3>{children}</section>;
}

function paginationScript(shell: Shell, apiUrl: string) {
  if (shell === "powershell") {
    const request = multiline(shell, [
      `  curl.exe -s -G "${apiUrl}/v1/facturas"`,
      `    ${keyHeader(shell)}`,
      `    --data-urlencode 'fecha_desde=2026-01-01'`,
      `    --data-urlencode 'limit=100'`,
      `    --data-urlencode "offset=$offset"`,
      `    -o "pagina_$offset.json"`
    ]);
    return `$offset = 0
do {
${request}

  $facturas = Get-Content "pagina_$offset.json" -Raw -Encoding UTF8 | ConvertFrom-Json
  $recibidas = if ($facturas) { @($facturas).Count } else { 0 }
  Write-Host "offset=$offset -> $recibidas facturas"
  $offset += 100
} while ($recibidas -eq 100)   # una página incompleta es la última`;
  }
  const request = multiline(shell, [
    `  curl -s -G "${apiUrl}/v1/facturas"`,
    `    ${keyHeader(shell)}`,
    `    --data-urlencode 'fecha_desde=2026-01-01'`,
    `    --data-urlencode 'limit=100'`,
    `    --data-urlencode "offset=$offset"`
  ]);
  return `offset=0
while true; do
${request} > "pagina_$offset.json"

  recibidas=$(jq length "pagina_$offset.json")
  echo "offset=$offset -> $recibidas facturas"
  [ "$recibidas" -lt 100 ] && break   # una página incompleta es la última
  offset=$((offset + 100))
done`;
}

function downloadScript(shell: Shell, apiUrl: string) {
  if (shell === "powershell") {
    return `# Descarga el PDF y el XML de todas las facturas de una página guardada
$facturas = Get-Content pagina_0.json -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($factura in $facturas) {
  curl.exe -sS ${keyHeader(shell)} -OJ "${apiUrl}/v1/facturas/$($factura.uuid)/pdf"
  curl.exe -sS ${keyHeader(shell)} -OJ "${apiUrl}/v1/facturas/$($factura.uuid)/xml"
}`;
  }
  return `# Descarga el PDF y el XML de todas las facturas de una página guardada
jq -r '.[].uuid' pagina_0.json | while read -r uuid; do
  curl -sS ${keyHeader(shell)} -OJ "${apiUrl}/v1/facturas/$uuid/pdf"
  curl -sS ${keyHeader(shell)} -OJ "${apiUrl}/v1/facturas/$uuid/xml"
done`;
}

function defaultShell(): Shell {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent) ? "powershell" : "bash";
}

export function FacturasApiTerminalGuide({ apiUrl, filters, onClose }: Props) {
  const [tab, setTab] = useState<TabId>("inicio");
  const [shell, setShell] = useState<Shell>(defaultShell);
  const powershell = shell === "powershell";
  const label = shellLabel(shell);
  const bin = curlBin(shell);
  const header = keyHeader(shell);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [onClose]);

  const uuid = filters.uuid.trim();
  const uuidSearch = UUID_PATTERN.test(uuid);
  const currentParams: [string, string][] = [];
  if (filters.fechaDesde) currentParams.push(["fecha_desde", filters.fechaDesde]);
  if (filters.fechaHasta) currentParams.push(["fecha_hasta", filters.fechaHasta]);
  filters.rfcs.forEach((rfc) => currentParams.push(["rfc_emisor", rfc]));
  filters.nucleos.forEach((nucleo) => currentParams.push(["nucleo", nucleo]));
  currentParams.push(["limit", "100"], ["offset", "0"]);
  const hasCurrentFilters = currentParams.length > 2;
  const currentCommand = uuidSearch ? curlGet(shell, `${apiUrl}/v1/facturas/${uuid}`) : curlSearch(shell, apiUrl, currentParams);
  const exampleUrl = `${apiUrl}/v1/facturas/${EXAMPLE_UUID}`;
  const search = (params: [string, string][]) => curlSearch(shell, apiUrl, params);

  return <div aria-labelledby="api-terminal-title" aria-modal="true" className="manual-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }} role="dialog">
    <article className="api-terminal-modal api-guide">
      <header>
        <div><p>Integración externa</p><h2 id="api-terminal-title">Guía de petición por terminal</h2><span>Consulta y descarga facturas desde tus propios sistemas con una API key autorizada. Esta página no muestra ni conserva la key.</span></div>
        <button aria-label="Cerrar guía" onClick={onClose} type="button">×</button>
      </header>
      <div aria-label="Terminal que usas" className="api-guide-shell" role="group">
        <span>Tu terminal</span>
        {SHELLS.map((item) => <button aria-pressed={shell === item.id} className={shell === item.id ? "is-active" : undefined} key={item.id} onClick={() => setShell(item.id)} type="button">{item.label}</button>)}
      </div>
      <div aria-label="Secciones de la guía" className="api-guide-tabs" role="tablist">
        {TABS.map((item) => <button aria-selected={tab === item.id} className={tab === item.id ? "is-active" : undefined} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">{item.label}</button>)}
      </div>

      <div className="api-terminal-modal-body" role="tabpanel">
        {tab === "inicio" ? <>
          <Step number={1} title="Qué necesitas">
            <ul>
              <li><b>curl.</b> Viene instalado en macOS, Linux y Windows 10/11.{powershell ? <> En PowerShell se invoca como <code>curl.exe</code>, que es lo que usan todos los comandos de esta guía.</> : null}</li>
              <li><b>Una API key autorizada.</b> Se envía en la cabecera <code>x-api-key</code> en cada petición. Pídela a quien administre la API; no la compartas ni la guardes en repositorios.</li>
              <li><b>La URL base:</b> <code>{apiUrl}</code>. Todas las rutas de esta guía cuelgan de ella.</li>
            </ul>
          </Step>
          <Step number={2} title="Guarda la key en una variable de entorno">
            <p>Así los comandos no contienen la key y puedes copiarlos y compartirlos con seguridad. Sustituye <code>TU_API_KEY</code> por el valor real.</p>
            <CodeBlock code={powershell ? `$env:FACTURAS_API_KEY = 'TU_API_KEY'` : `export FACTURAS_API_KEY='TU_API_KEY'`} label={label} />
            {powershell
              ? <p>La variable dura mientras la ventana de PowerShell siga abierta. Para guardarla de forma permanente en tu usuario, ejecuta esto y abre una ventana nueva:</p>
              : <p>La variable dura mientras la terminal siga abierta. Para conservarla, añade esa misma línea a tu <code>~/.bashrc</code> o <code>~/.zshrc</code>.</p>}
            {powershell ? <CodeBlock code={`[Environment]::SetEnvironmentVariable('FACTURAS_API_KEY', 'TU_API_KEY', 'User')`} label={label} /> : null}
          </Step>
          <Step number={3} title="Comprueba que la conexión funciona">
            <p>Debe responder <code>{`{"status":"ok"}`}</code>. Si responde 401 o 403, la key falta o no es válida.</p>
            <CodeBlock code={curlGet(shell, `${apiUrl}/health`)} label={label} />
          </Step>
          <Step number={4} title="Cómo se trabaja">
            <p>El flujo habitual tiene tres pasos: <b>buscar</b> con filtros para obtener la lista de facturas y sus UUID, <b>consultar</b> una factura por su UUID si necesitas sus datos, y <b>descargar</b> su PDF o XML usando el UUID.</p>
            <table className="api-guide-table"><thead><tr><th>Ruta</th><th>Qué devuelve</th></tr></thead><tbody>
              <tr><td><code>GET /v1/facturas</code></td><td>Lista de hasta 100 facturas (JSON) según los filtros.</td></tr>
              <tr><td><code>GET /v1/facturas/{"{uuid}"}</code></td><td>Datos de una factura concreta (JSON).</td></tr>
              <tr><td><code>GET /v1/facturas/{"{uuid}"}/pdf</code></td><td>Representación impresa en PDF.</td></tr>
              <tr><td><code>GET /v1/facturas/{"{uuid}"}/xml</code></td><td>XML de la factura.</td></tr>
              <tr><td><code>GET /health</code></td><td>Estado del servicio.</td></tr>
            </tbody></table>
          </Step>
          <Step number={5} title={`Notas para ${label}`}>
            {powershell ? <ul>
              <li>Escribe siempre <code>curl.exe</code>. En Windows PowerShell 5.1, <code>curl</code> a secas es un alias de <code>Invoke-WebRequest</code>, que usa otra sintaxis y no entiende estos parámetros.</li>
              <li>Para partir un comando en varias líneas se usa el acento grave <code>`</code> como último carácter de la línea, sin espacios detrás. Si lo copias con un espacio al final, PowerShell lo trata como dos comandos.</li>
              <li>Las comillas simples <code>&apos;…&apos;</code> envían el texto tal cual; las dobles <code>&quot;…&quot;</code> sustituyen variables como <code>$env:FACTURAS_API_KEY</code>. Los comandos ya están escritos así.</li>
              <li>Los scripts de paginación y descarga usan <code>ConvertFrom-Json</code>, incluido en PowerShell: no necesitas instalar <code>jq</code>.</li>
            </ul> : <ul>
              <li>Los comandos de varias líneas terminan cada línea con <code>{BACKSLASH}</code> y ninguna lleva espacios después. Cópialos completos.</li>
              <li>Las comillas simples <code>&apos;…&apos;</code> envían el texto tal cual; las dobles <code>&quot;…&quot;</code> sustituyen variables como <code>$FACTURAS_API_KEY</code>. Los comandos ya están escritos así.</li>
              <li>Los scripts de paginación y descarga usan <code>jq</code> para leer el JSON. Instálalo con <code>brew install jq</code> (macOS) o <code>sudo apt install jq</code> (Linux). En Windows con Git Bash, descárgalo desde jqlang.org o cambia a Windows PowerShell arriba.</li>
            </ul>}
          </Step>
        </> : null}

        {tab === "busqueda" ? <>
          <Step number={1} title={uuidSearch ? "Tu búsqueda actual (por UUID)" : "Tu búsqueda actual"}>
            <p>{uuidSearch
              ? "Has escrito un UUID en los filtros: la búsqueda por UUID es exacta e ignora el resto de filtros. Este comando devuelve los datos de esa factura."
              : hasCurrentFilters
                ? "Este comando reproduce los filtros que tienes ahora mismo en la página. Cámbialos y la guía lo actualiza."
                : "No has marcado filtros, así que este comando pide las 100 facturas más recientes. Aplica filtros en la página y la guía los añadirá aquí."}</p>
            <CodeBlock code={currentCommand} label={label} />
          </Step>
          <Step number={2} title="Parámetros disponibles">
            <p>Todos son opcionales y se escriben en la URL como <code>?parametro=valor</code>. Puedes enviar cualquier combinación. Los parámetros marcados como repetibles se pueden escribir varias veces.</p>
            <div className="api-guide-table-wrap"><table className="api-guide-table"><thead><tr><th>Parámetro</th><th>Tipo</th><th>Descripción</th><th>Ejemplo</th></tr></thead><tbody>
              {PARAMETERS.map((parameter) => <tr key={parameter.name}><td><code>{parameter.name}</code>{parameter.repeatable ? <small>repetible</small> : null}</td><td>{parameter.type}</td><td>{parameter.text}</td><td><code>{parameter.example}</code></td></tr>)}
            </tbody></table></div>
          </Step>
          <Step number={3} title="Cómo se combinan los filtros">
            <ul>
              <li><b>Dentro de un mismo parámetro repetido, vale cualquiera (O).</b> <code>rfc_emisor=AAA…&amp;rfc_emisor=BBB…</code> devuelve las facturas de AAA o de BBB.</li>
              <li><b>Entre parámetros distintos deben cumplirse todos (Y).</b> Fechas, RFC, núcleo, serie y folio se acumulan: cuantos más filtros, menos resultados.</li>
              <li><b>El orden es fijo:</b> de la fecha de emisión más reciente a la más antigua.</li>
              <li><b>Si nada coincide</b> la respuesta es <code>[]</code> con código 200, no un error.</li>
            </ul>
          </Step>
          <Step number={4} title="Por qué usar -G y --data-urlencode">
            <p>Valores como <code>Agua Fría</code> llevan espacios y acentos, que no son válidos tal cual en una URL. <code>-G</code> hace que curl envíe los datos como parámetros de la URL, y <code>--data-urlencode</code> los codifica por ti. Es la forma más segura de evitar errores con nombres de núcleo.</p>
          </Step>
          <Step number={5} title="Ejemplos">
            <p><b>Facturas de un mes</b></p>
            <CodeBlock code={search([["fecha_desde", "2026-01-01"], ["fecha_hasta", "2026-01-31"]])} label={label} />
            <p><b>Un proveedor</b></p>
            <CodeBlock code={search([["rfc_emisor", "AAA010101AAA"]])} label={label} />
            <p><b>Varios proveedores</b> (repite el parámetro)</p>
            <CodeBlock code={search([["rfc_emisor", "AAA010101AAA"], ["rfc_emisor", "BBB020202BBB"]])} label={label} />
            <p><b>Uno o varios núcleos</b></p>
            <CodeBlock code={search([["nucleo", "Agua Fría"], ["nucleo", "Alamo"]])} label={label} />
            <p><b>Combinación:</b> facturas del proveedor AAA010101AAA, en ese núcleo y en ese periodo</p>
            <CodeBlock code={search([["rfc_emisor", "AAA010101AAA"], ["nucleo", "Agua Fría"], ["fecha_desde", "2026-01-01"], ["fecha_hasta", "2026-03-31"]])} label={label} />
            <p><b>Por serie y folio.</b> El folio por sí solo se repite entre proveedores y años, así que combínalo siempre con el RFC del emisor y, si puedes, con fechas.</p>
            <CodeBlock code={search([["rfc_emisor", "AAA010101AAA"], ["serie", "A"], ["folio", "1234"], ["fecha_desde", "2026-01-01"]])} label={label} />
            <p><b>Por UUID.</b> Es una consulta exacta y no admite otros filtros.</p>
            <CodeBlock code={curlGet(shell, exampleUrl)} label={label} />
          </Step>
        </> : null}

        {tab === "respuesta" ? <>
          <Step number={1} title="Qué devuelve una búsqueda">
            <p>Una lista JSON, una factura por elemento. La consulta por UUID devuelve solo el objeto de la factura, sin la lista.</p>
            <CodeBlock label="Respuesta 200" code={`[
  {
    "uuid": "${EXAMPLE_UUID}",
    "serie": "A",
    "folio": "1234",
    "fecha": "2026-01-15T09:36:14",
    "rfc_emisor": "AAA010101AAA",
    "nombre_emisor": "PROVEEDOR DE EJEMPLO SA DE CV",
    "total": 12345.67,
    "moneda": "MXN",
    "estatus_cancelacion_sat": "vigente",
    "nucleos": ["Agua Fría"],
    "urls": {
      "xml": "/v1/facturas/${EXAMPLE_UUID}/xml",
      "pdf": "/v1/facturas/${EXAMPLE_UUID}/pdf"
    }
  }
]`} />
          </Step>
          <Step number={2} title="Significado de cada campo">
            <div className="api-guide-table-wrap"><table className="api-guide-table"><thead><tr><th>Campo</th><th>Contenido</th></tr></thead><tbody>
              {FIELDS.map(([name, text]) => <tr key={name}><td><code>{name}</code></td><td>{text}</td></tr>)}
            </tbody></table></div>
          </Step>
          <Step number={3} title="Paginación">
            <p>Cada petición devuelve como máximo 100 facturas y la respuesta no incluye el total. Para recorrer un resultado grande, repite la misma búsqueda aumentando <code>offset</code> de 100 en 100: <code>offset=0</code>, <code>offset=100</code>, <code>offset=200</code>… Mantén los mismos filtros en todas las páginas.</p>
            <p><b>Cuándo parar:</b> cuando una página trae menos facturas que <code>limit</code>. Si trae exactamente 100, pide una más: puede llegar vacía.</p>
            <CodeBlock code={search([["limit", "100"], ["offset", "100"]])} label={`Segunda página · ${label}`} />
          </Step>
          <Step number={4} title="Recorrer todas las páginas con un script">
            <p>Guarda cada página en un archivo <code>pagina_0.json</code>, <code>pagina_100.json</code>… {powershell ? "Lee el JSON con ConvertFrom-Json, que ya viene en PowerShell." : "Necesita jq para contar los elementos de la lista."}</p>
            <CodeBlock code={paginationScript(shell, apiUrl)} label={label} />
          </Step>
        </> : null}

        {tab === "descargas" ? <>
          <Step number={1} title="Consultar una factura por UUID">
            <p>Devuelve el mismo objeto que cada elemento de la búsqueda. Úsalo para confirmar que un UUID existe antes de descargar.</p>
            <CodeBlock code={curlGet(shell, exampleUrl)} label={label} />
          </Step>
          <Step number={2} title="Descargar el PDF o el XML">
            <p>Sustituye el UUID de ejemplo por el que recibiste en la búsqueda. <code>-O</code> guarda el archivo y <code>-J</code> usa el nombre que propone el servidor, con la forma <code>SerieFolio_UUID.pdf</code> o <code>SerieFolio_UUID.xml</code>. El archivo se guarda en la carpeta actual de la terminal.</p>
            <CodeBlock code={`${bin} ${header} -OJ "${exampleUrl}/pdf"
${bin} ${header} -OJ "${exampleUrl}/xml"`} label={label} />
            <p>Si prefieres elegir el nombre, usa <code>-o</code>:</p>
            <CodeBlock code={`${bin} ${header} -o factura.pdf "${exampleUrl}/pdf"`} label={label} />
          </Step>
          <Step number={3} title="Qué debes saber de los documentos">
            <ul>
              <li>El XML y el PDF se generan en el momento de la petición a partir de los datos del CFDI, por lo que cada descarga puede tardar unos segundos.</li>
              <li>El PDF indica <b>CANCELADO</b> si la factura está cancelada ante el SAT.</li>
              <li>Un UUID que no pertenece a las facturas de gas responde 404, igual que uno inexistente.</li>
            </ul>
          </Step>
          <Step number={4} title="Descargar todas las facturas de una búsqueda">
            <p>Combina la paginación con la descarga: primero guarda las páginas como en la sección anterior y después recorre sus UUID. Hazlo de uno en uno; no lances descargas en paralelo para no superar la cuota.</p>
            <CodeBlock code={downloadScript(shell, apiUrl)} label={label} />
          </Step>
        </> : null}

        {tab === "errores" ? <>
          <Step number={1} title="Cómo leer un error">
            <p>Los errores de la API llevan un código HTTP y un cuerpo JSON. El texto legible está en <code>detail.detail</code> y el código estable en <code>detail.error</code>.</p>
            <CodeBlock label="Respuesta 404" code={`{
  "detail": {
    "error": "factura_no_encontrada",
    "detail": "No existe ninguna factura de gas con ese UUID."
  }
}`} />
          </Step>
          <Step number={2} title="Códigos de respuesta">
            <div className="api-guide-table-wrap"><table className="api-guide-table"><thead><tr><th>HTTP</th><th>Código</th><th>Cuándo ocurre</th><th>Qué hacer</th></tr></thead><tbody>
              {ERRORS.map((error) => <tr key={error.status}><td><b>{error.status}</b></td><td><code>{error.code}</code></td><td>{error.when}</td><td>{error.todo}</td></tr>)}
            </tbody></table></div>
          </Step>
          <Step number={3} title="Cómo diagnosticar desde la terminal">
            <p><code>-i</code> muestra el código y las cabeceras de la respuesta; <code>--fail-with-body</code> hace que curl termine con error cuando el código es 400 o superior, pero imprimiendo el cuerpo.</p>
            <CodeBlock code={`${bin} -i ${header} "${exampleUrl}"

${bin} --fail-with-body -sS ${header} -o factura.pdf "${exampleUrl}/pdf"`} label={label} />
          </Step>
        </> : null}
      </div>
    </article>
  </div>;
}
