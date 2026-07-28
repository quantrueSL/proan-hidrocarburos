# Esquema de datos — Fase 2 (tablas `HCARB_*`)

Catálogo de las tablas nuevas que construye la herramienta, complemento de
[`resumen.md`](./resumen.md) (por qué) — aquí solo el qué/columnas/grano.
Tablas fuente y cruces originales en
[`../PHASE1/Esquema.md`](../PHASE1/Esquema.md).

## 1. `D50_AGGREGATE_RENTABILIDAD.HCARB_STG_VENDORS`

Dedup de `D20_DIMENSION.dm_vendors` por `id_proveedor` (la tabla trae una
fila por `correo_electronico`, hallazgo §18 de Fase 1). Grano: un proveedor.

Esquema verificado jul-2026 contra BigQuery (12 columnas, todas `STRING`;
[`PHASE1/hallazgos.md`](../PHASE1/hallazgos.md) §24).

| Columna | Origen |
| --- | --- |
| `id_proveedor` (PK) | `dm_vendors.id_proveedor` |
| `rfc` | `dm_vendors.rfc` |
| `razon_social` | nombre del proveedor (existe también `nombre_comercial`, distinto, se conserva tal cual) |
| `id_direccion`, `pais`, `direccion_completa`, `municipio`, `colonia`, `codigo_postal`, `estado_cod`, `nombre_comercial` | resto de columnas de `dm_vendors`, tal cual (`correo_electronico` se descarta, es la causa de la duplicación — confirmado sin pérdida de información, §24) |

## 2. `D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO`

Módulo 1, grano **UUID** (factura completa). Universo: `ReceptorRfc =
'PAN921013AK7'` y ≥1 línea con `ClaveProdServ LIKE '151115%' OR IN
('83101600','83101601')` (D1/D2, provisional), **y** `FechaTimbrado`/`Fecha
>= 2026-01-01` (D31) — alinea el universo de CFDIs con la cobertura real de
`proan_MSEG_HIDROCARBUROS_20260714` (solo `MJAHR=2026`).

| Columna | Qué es |
| --- | --- |
| `uuid` (PK) | `cfdis.UUID` |
| `serie`, `folio` | tal cual |
| `folio_key` | `UPPER(REPLACE(CONCAT(Serie,Folio),' ',''))` — clave del match exacto |
| `folio_numero` | `LTRIM(REGEXP_REPLACE(CAST(Folio AS STRING),r'[^0-9]',''),'0')` — clave del match numérico (D18/D20) |
| `emisor_rfc`, `id_proveedor` | join contra `HCARB_STG_VENDORS.rfc` |
| `receptor_rfc` | por si D1/D2 se amplía a más razones sociales del grupo |
| `fecha_timbrado`, `fecha` | tal cual |
| `tipo_de_comprobante`, `moneda`, `metodo_pago`, `forma_pago` | tal cual |
| `subtotal`, `total`, `total_impuestos_trasladados` | cabecera completa |
| `importe_gas` | `SUM(Importe)` de las líneas con `es_concepto_gas=true` (D19) |
| `es_mixta` | `SubTotal - importe_gas > 0.01` (tolerancia de redondeo; comparar contra `Total` con IVA daba 100% mixtas siempre, ejecución jul-2026) |
| `n_lineas_gas`, `n_lineas_total` | conteo de líneas (en la práctica siempre 1/1 — ver D26) |
| `claves_gas` | array de claves SAT distintas que clasificaron la factura como gas (jul-2026, trazabilidad de M1 — ver README de `ConsultasBigQuery/`). Solo 3 valores reales en todo el universo: `15111510`, `15111512`, `83101600` |
| `conceptos_gas` | array de STRUCT (clave, descripcion, cantidad, clave_unidad, valor_unitario, importe) por línea de gas, ordenado por importe desc — evidencia línea a línea de "por qué es gas" en el detalle de M1 |
| `material_principal`, `cantidad_principal`, `clave_unidad_principal` | (jul-2026, columnas M1) `conceptos_gas[0]` ya extraído como escalares — descripción/cantidad/unidad de la línea de gas de mayor importe, para las columnas Material/Cantidad de la tabla M1. Casi siempre hay una sola línea de gas por factura, así que no hay ambigüedad real |

**D26 (jul-2026):** existía también `HCARB_GOLD_CLASIFICACION_LINEA` (grano
línea-concepto, D12/D19) para desglosar facturas mixtas. Se eliminó al
ejecutar: salió con el mismo grano que esta tabla (1.051=1.051, 1 a 1) — los
conceptos no-gas de una factura mixta no se guardan como fila aparte en
`cfdis` (confirma hallazgo §16 de Fase 1), así que no hay desglose real que
mostrar. Reconstruible desde el historial de `ConsultasBigQuery/HCARB_gold_clasificacion.sql`
si aparece una fuente con desglose real.

## 3. `D60_REPORTING.HCARB_GOLD_VALIDACION_SAP`

Módulo 2 (automático), grano **UUID**, a partir de `_FOLIO`.

| Columna | Qué es |
| --- | --- |
| `uuid` (FK) | liga a `_FOLIO` |
| `estado_sap` | `'validada_sap'` / `'sin_match_sap'` — no bloqueante (D18). Valida si casa CUALQUIERA de las dos fuentes (RE o partida de proveedor). 955/1056 (90,4%) tras Fase-1-bis; antes 899 (85%) solo RE |
| `fuente_sap` | `'RE'` / `'partida_proveedor'` / `'RE+partida'` / `NULL` — qué fuente(s) validaron |
| `tipo_match_sap` | `'exacto'` / `'numerico'` / `NULL` (fuente RE) |
| `belnr_sap`, `fecha_registro_sap`, `dias_diferencia` | documento `RE` en BKPF que hizo match; `NULL` si solo validó por partida de proveedor |
| `estado_pago_sap` | `'pagada'` (BSAK compensada) / `'pendiente'` (BSIK abierta) / `NULL`. Fase-1-bis: 600 pagadas / 4 pendientes. Base para el Módulo 4 |
| `belnr_pago_sap`, `fecha_pago_sap` | documento y fecha de compensación (`AUGDT`, solo `pagada`) de la partida de proveedor |
| `werks`, `sitio_consumo` | planta (código y nombre vía `dm_centros`), ~58% cobertura (D21), resto `NULL` |
| `direccion_sitio` | dirección física de la planta vía `T001W` (calle/ciudad/región, solo partes no vacías) — la "Dirección de Consumo" de la Propuesta, mismo ~58% que `werks`. Fase-1-bis jul-2026 |
| `tipo_match_sitio` | `'exacto'` / `'numerico'` / `NULL` — mismo criterio que `tipo_match_sap`, aplicado a `sap_ekbe` (D20) |
| `confianza_mseg` | `'Alta'` (folio e importe casan exacto, recepción 1:1) / `'Media'` (solo el folio casa, documento probablemente consolidado) / `NULL` (sin recepción casable). 48% con evidencia (505/1.056), corregido jul-2026 — era `tiene_recepcion_mseg` bool al 2%, bug de filtro por material en vez de proveedor (`PHASE1/hallazgos.md` §27) |
| `mseg_cantidad`, `mseg_valor_unitario`, `mseg_importe` | solo si `confianza_mseg IS NOT NULL`; en `confianza_mseg='Media'` son del documento SAP completo, no reconcilian el importe de esta factura en particular |
| `ceco_sugerido` | Sugerencia de CECO (jul-2026, D22 revisada): `KOSTL` del proveedor si es de un solo sitio (≥95% concentración histórica, 6 de 11 proveedores), si no los `KOSTL` del documento MSEG que casó (uno o varios separados por coma — casi nunca hay uno dominante en documentos multi-sitio). `NULL` si nada aplica. 543/1.056 (51%) con sugerencia. Solo prellena el campo en la UI, nunca bloquea (mismo principio que D29 para CECO/sitio manual) |

## 4. `HCARB_gold_aprobacion` (backend, NO en `ConsultasBigQuery/`)

Mutable, propiedad de la app — el pipeline la alimenta en solo-lectura
(vía `uuid`) pero FastAPI la actualiza. Dos roles (D23).

**Creada en BigQuery (jul-2026).** DDL en
`apps/financialbi/financialbi/aprobacion_engine.py` (`ensure_schema()`,
idempotente) — no vive en `ConsultasBigQuery/` porque no es una tabla
recalculable por SELECT, es un `CREATE TABLE` vacío que el backend llena con
`INSERT`/`UPDATE`. Identidad de usuario por ahora es texto libre, no login
real (D27).

| Columna | Qué es |
| --- | --- |
| `uuid` (PK/FK) | liga a `_FOLIO` |
| `estado` | `pendiente_validacion_compras` / `pendiente_aprobacion_gerencia` / `aprobada` / `rechazada` |
| `ceco` | manual, lo captura Compras (D9/D22, siempre) |
| `werks_manual` | solo si `HCARB_GOLD_VALIDACION_SAP.werks` es `NULL` (~42%, D21) |
| `usuario_compras`, `fecha_validacion_compras`, `comentario_compras` | paso 1 |
| `usuario_gerencia`, `fecha_aprobacion_gerencia`, `comentario_gerencia` | paso 2 |
| `rechazada_por_rol`, `motivo_rechazo` | cualquiera de los dos roles puede rechazar/devolver |
| `reabierta_por`, `fecha_reapertura`, `motivo_reapertura` | reversibilidad (jul-2026): última reapertura de una factura ya `aprobada`/`rechazada` -- no histórico completo, solo la última |

**Reversibilidad (jul-2026):** dos mecanismos, para que un error de captura no
necesite arreglo manual en BigQuery:
- **Editar antes de que Gerencia decida:** `capturar_compras` acepta como
  origen tanto `pendiente_validacion_compras` como `pendiente_aprobacion_gerencia`
  -- Compras puede corregir CECO/sitio mientras Gerencia no haya actuado.
- **Reabrir después de decidido:** desde `aprobada` o `rechazada`, vuelve a
  `pendiente_validacion_compras` y borra los datos de la decisión anterior
  (CECO, sitio, comentarios, quién decidió), dejando constancia de quién
  reabrió y por qué en las 3 columnas nuevas.

**Endpoints construidos y probados contra BigQuery real (jul-2026)**, en
`apps/financialbi/financialbi/aprobacion_engine.py` + rutas en `app.py`:

| Endpoint | Qué hace |
| --- | --- |
| `GET /v1/financialbi/hidrocarburos/aprobacion/compras` | cola de Compras (`pendiente_validacion_compras`); hace `sync_pendientes()` antes de leer -- da de alta las facturas nuevas de M1/M2 que aún no están en el flujo |
| `GET /v1/financialbi/hidrocarburos/aprobacion/gerencia` | cola de Gerencia (`pendiente_aprobacion_gerencia`) |
| `GET /v1/financialbi/hidrocarburos/aprobacion/catalogo/{ceco,sitios}` | sugerencia D29 -- 9.783 CECOs (todo el grupo, tratar como autocompletar buscable, no desplegable plano) / 461 sitios (`dm_centros` sin la red `MK##` de Maka) |
| `POST /v1/financialbi/hidrocarburos/aprobacion/{uuid}/reabrir` | deshace una `aprobada`/`rechazada` -- vuelve a `pendiente_validacion_compras`. Sin control de rol, igual que el resto (D27) |
| `POST .../aprobacion/compras/{uuid}/validar` | Compras captura CECO (+ sitio manual si aplica) → `pendiente_aprobacion_gerencia` |
| `POST .../aprobacion/compras/{uuid}/rechazar` | Compras rechaza → `rechazada` |
| `POST .../aprobacion/gerencia/{uuid}/aprobar` | Gerencia aprueba → `aprobada` |
| `POST .../aprobacion/gerencia/{uuid}/rechazar` | Gerencia rechaza → `rechazada` |
| `GET /v1/financialbi/hidrocarburos/aprobacion/historial` | facturas más allá de la bandeja inicial de Compras (`pendiente_aprobacion_gerencia`/`aprobada`/`rechazada`) -- necesaria para poder encontrar una factura y reeditarla/reabrirla desde la interfaz |

Las transiciones llevan guarda de estado (`WHERE uuid=@uuid AND estado=@estado_origen`);
si no afecta ninguna fila, el endpoint responde `404` (uuid no existe en el
flujo) o `409` (existe pero en otro estado -- ya la procesó alguien, o no
aplica esa acción). Verificado con datos reales: `sync_pendientes()` dio de
alta las 1.051 facturas; probado el ciclo completo validar→aprobar y
validar→rechazar sobre dos facturas reales, y limpiado el estado de prueba
después (vuelven a `pendiente_validacion_compras`). Verificada también la
reversibilidad: reeditar CECO estando ya en `pendiente_aprobacion_gerencia`,
y reabrir una factura `aprobada` -- ambos casos limpiados después.

**Frontend de reversibilidad: construido (jul-2026).** Tercera pestaña
"Historial" en `aprobacion-workspace.tsx` (facturas `pendiente_aprobacion_gerencia`/
`aprobada`/`rechazada`) -- desde ahí se puede reeditar CECO/sitio antes de que
Gerencia decida, o reabrir (con motivo obligatorio) una ya `aprobada`/
`rechazada`. El endpoint a usar ya no depende de qué pestaña se mira, sino
del estado real de la factura (`endpointFor()`). Verificado con `tsc --noEmit`
y `next lint` limpios sobre los 5 archivos tocados -- no se ha probado en el
navegador todavía (ver pendientes de [[hidrocarburos-colaboracion-codex]]).

## 5. `HCARB_ESTATUS_SAT` (backend, NO en `ConsultasBigQuery/`) — D24 construido y verificado en vivo (jul-2026)

Poblada por `apps/financialbi/financialbi/estatus_sat.py` (script invocable a
mano hoy, `python -m financialbi.estatus_sat [limite]`; candidato a task de
Airflow cuando exista el DAG) — no por un `SELECT` sobre BigQuery, porque
depende de un servicio externo con límite de tasa y el resultado cambia con
el tiempo.

**Protocolo verificado EN VIVO** contra la WSDL real del SAT
(`https://consultaqr.facturaelectronica.sat.gob.mx/ConsultaCFDIService.svc?singleWsdl`)
y probado con 2 facturas reales + 1 UUID inventado — los 3 resultados
posibles (`Vigente`, `Cancelado`, `No Encontrado`) confirmados. **Corrección
importante sobre D30/el diseño original:** el parámetro de la petición SOAP
se llama `expresionImpresa`, no `expresionImpresionFiscal` como se solía
recordar/documentar de memoria — se corrigió contra la WSDL antes de escribir
código. **Hallazgo real de la primera prueba:** una factura real de nuestro
universo (`10B5DD43-6267-4DD3-AF84-7F286E752B53`) está `Cancelado con
aceptación` ante el SAT — la herramienta no tenía forma de saber esto antes
de D24.

| Columna | Qué es |
| --- | --- |
| `uuid` (PK/FK) | liga a `_FOLIO` |
| `estatus_cancelacion` | `'vigente'` / `'cancelado'` / `'no_encontrado'` (mapeado desde el campo `Estado` de la respuesta) |
| `codigo_estatus`, `es_cancelable`, `estatus_cancelacion_sat` | campos crudos de la respuesta del SAT, para depurar |
| `fecha_consulta` | cuándo se verificó (upsert -- solo la última consulta, no histórico) |
| `fuente` | `'sat_webservice'` |

Cadencia (D30, sin cambios): consulta facturas sin estatus todavía, o
consultadas hace más de 7 días y que no estén `aprobada`. Ritmo secuencial
con pausa de 1s entre llamadas -- nunca en paralelo, para no golpear el
servicio del SAT.

## 6. Dashboard (`dashboard_engine.py`) — construido (jul-2026)

Un único endpoint (`GET /v1/financialbi/hidrocarburos/dashboard`) que agrupa
4 queries en una sola llamada de red (mismo criterio de "menos queries" que
el resto del proyecto): resumen de estatus (total/pendientes/validadas/
aprobadas/rechazadas + vigentes/canceladas/sin-confirmar del SAT) y gasto
por CECO, por sitio, y por periodo mensual. No desglosa por "sociedad"
(pedía la Propuesta original, §3) porque el alcance actual (D1/D2,
provisional) es una sola razón social. Probado con las 4 queries contra
BigQuery real -- cifras coherentes con Fase 1 (ej. "PAN Planta San Juan 1"
domina el gasto por sitio, igual que ya sabíamos).

## Diagrama de estados

Ver [`resumen.md`](./resumen.md#máquina-de-estados-de-la-factura).
