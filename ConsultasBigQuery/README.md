# ConsultasBigQuery

SQL de producto de proan-Hidrocarburos: construye las tablas `HCARB_*` que
lee la herramienta — esto se mantiene y se re-ejecuta. Por qué el cruce
CFDI↔SAP nunca es exacto (grano distinto entre sistemas, tolerancias,
CECO/sitio como evidencia y no como dato exacto) en
[`docs/data/naturaleza-de-los-datos.md`](../docs/data/naturaleza-de-los-datos.md).

**Estado actual: ejecutadas y validadas contra BigQuery (jul-2026)**. Al
ejecutar aparecieron 6 bugs reales que ninguna revisión estática detectó
(detalle en el header de cada `.sql`): partición `ROW_NUMBER()` por `FLOAT64`
no permitida, nombre real de columna `BELNR_account_document_number`,
`TIMESTAMP` vs `DATE` en `DATE_DIFF`, ventana de fecha ausente en el matcher
numérico de `sap_ekbe` (inflaba `sitio_consumo` a 72% en vez de ~54-58%),
filtro de material de gas ausente en el extracto MSEG (inflaba
`tiene_recepcion_mseg` a 48% en vez de ~2%), y `es_mixta` comparando contra
`Total` (con IVA) en vez de `SubTotal` sin tolerancia de redondeo (daba 100%
mixtas en vez de ~74%). Cifras finales contra los benchmarks de Fase 1: 1.051
facturas, ~$40.2M, 11 proveedores, 74.3% mixtas, 898 validada_sap (solo RE; hoy
955 con la 2ª fuente de validación, ver abajo), 569 con sitio, 21 con recepción
MSEG — todo dentro de lo esperado. **El "21 con recepción MSEG" resultó ser el
bug, no el hallazgo** — ver el fix de más abajo, que lo sube a 505.

**D26:** `HCARB_GOLD_CLASIFICACION_LINEA` (no bug) salió con el mismo número
de filas que `_FOLIO` (1.051=1.051) — los conceptos no-gas de una factura
mixta no se guardan como filas aparte en `cfdis` (Fase 1 §16), sin desglose
real que mostrar. **Eliminada** de `HCARB_gold_clasificacion.sql` y borrada
de BigQuery (`DROP TABLE`, jul-2026, autorizado explícitamente). Quedan 3
tablas `HCARB_*` vivas: `HCARB_STG_VENDORS` (D50), `HCARB_GOLD_CLASIFICACION_FOLIO`
y `HCARB_GOLD_VALIDACION_SAP` (D60).

**Trazabilidad de clasificación (jul-2026):** `HCARB_GOLD_CLASIFICACION_FOLIO`
lleva ahora `claves_gas` (array de claves SAT distintas que clasificaron la
factura) y `conceptos_gas` (array de líneas de gas con clave, descripción,
cantidad, unidad, valor unitario e importe). Hacen la clasificación auditable
factura a factura en la propia UI (M1) en vez de esconder el criterio en el
SQL. Al exponerlas se confirmó que **ninguna de las 6 claves de la Propuesta
(15111501–15111506) aparece en los datos reales**: el universo factura con
`15111510` ("LITROS DE GAS, LP", 1.035 facturas), `15111512` ("GAS NATURAL
VEHICULAR COMPRIMIDO", 18) y `83101600` (servicio GNC, 3). Por eso el
clasificador filtra por prefijo `151115%` + `83101600/01`, no por la lista
literal de 6 — ceñirse a ella clasificaría 0 facturas. (Feed `cfdis` mutable:
el total subió de 1.051 a 1.056 desde el backfill inicial.)

**Ventana de fecha en los matchers exactos (jul-2026):** `match_sap_exacto` y
`sitio_exacto` casaban por `folio_key` (Serie+Folio) **sin acotar fecha** — el
folio se reutiliza entre ejercicios, así que una colisión de folio años atrás
colaba (2 casos, uno a 1071 días) y, peor, **tapaba el match numérico bueno**
(el numérico solo corre si no hubo exacto). Se añadió ventana de **90 días** a
ambos exactos (más holgada que los 15 del numérico porque el folio completo es
evidencia fuerte). Efecto: la diferencia de fecha máxima entre validadas cae de
1071 a 12 días; las 2 colisiones pasan a `sin_match_sap` (flag suave). Ahora que
`dias_diferencia` es visible en el Portal de Compras (M2), esto evita mostrar
matches falsos a quien valida.

**Segunda fuente de validación + estado de pago (Fase-1-bis, jul-2026):** además
del registro FI (documento `RE` en `bkpf`), `estado_sap` valida ahora también por
**partida de proveedor**: folio + **mismo proveedor** (`LIFNR` = `id_proveedor` de
la factura) contra `proan_BSAK_*` (compensadas = pagadas) y `proan_BSIK_*` (abiertas
= pendientes). Como corrobora el proveedor, es a prueba de colisiones de folio **sin
ventana de fecha** (la cabecera BKPF no trae proveedor, por eso el matcher RE sí la
necesita; exigir el proveedor tiró 670→604 matches, y esos 66 eran justo colisiones).
Efecto: las validadas suben de **899 (85%) a 955 (90,4%)** — la unión de ambas
fuentes — y de paso se obtiene el **estado de pago** (600 pagadas / 4 pendientes),
base para el Módulo 4. Columnas nuevas: `fuente_sap`
(`RE`/`partida_proveedor`/`RE+partida`), `estado_pago_sap`, `belnr_pago_sap`,
`fecha_pago_sap`. El techo teórico era 990 (94%) usando RE sin ventana, pero eso
reabre las colisiones que la ventana corta (solo +35), así que no se toca. El barrido
completo de `proan-quantrue` que lo motivó — y por qué el **CECO** sigue sin poder
derivarse de forma exacta (ACDOCA acotado a la sociedad `ETC`, no las del gas;
`0FI_GL_14` congelado en 2024; sin `EKKN`) está en
[`docs/data/naturaleza-de-los-datos.md`](../docs/data/naturaleza-de-los-datos.md).

**Dirección de Consumo vía `T001W` (Fase-1-bis, jul-2026):** la Propuesta pide mostrar
la "Dirección de Consumo" (punto físico de entrega); Fase 1 la dio por inexistente, pero
el maestro de plantas `proan_T001W_*` **sí** trae la dirección postal por `WERKS` (`STRAS`
calle, `ORT01` ciudad, `REGIO` región). Se expone en la columna nueva `direccion_sitio`
(concatena solo las partes no vacías; p.ej. PAN1 = "Km.2 Carret. San Juan - Guadal, JAL"),
para el mismo ~58% de facturas con `WERKS` resuelto. La calle viene truncada en el propio
maestro SAP. `ORT01`/`PSTLZ` suelen venir vacías.

**Fix del cruce CFDI↔MSEG (Fase-1-bis-2, jul-2026): 2% → 48%.** El filtro de
"es gas" en MSEG (`MATNR` en el catálogo de 6 materiales de `dm_material`)
descartaba las recepciones que SAP contabiliza por cuenta contable directa
sin material (`MATNR` vacío, `SAKTO='0005010611'`) — el patrón **dominante**
incluso para el único proveedor con `MATNR` poblado (Gas Noel: 4.991 filas
por cuenta vs. 52 por material). El filtro correcto es por proveedor
(`LIFNR` = uno de los 11 ya identificados en `HCARB_STG_VENDORS`), no por
material — estas 11 son distribuidoras de gas dedicadas, así que no hay
riesgo de colar diésel/insecticida al quitar el filtro de material. Se portó
también el patrón de score+fallback numérico de folio (como `sap_match`/
`sitio_match`) y agregación a grano documento (`MBLNR`, confirmando que
`XBLNR_MKPF`/`BUDAT_MKPF` son de cabecera). Resultado: `tiene_recepcion_mseg`
(booleano) se reemplaza por `confianza_mseg` (`'Alta'`/`'Media'`/`NULL`) —
505/1.056 (48%) con evidencia de recepción (54 Alta: folio e importe casan
exacto; 451 Media: solo el folio casa, el documento SAP suele ser una
recepción consolidada de varias entregas/facturas, así que su importe no
reconcilia el monto de esta factura en particular). Auditado contra
BigQuery real (`ZZ_PRUEBAS.hcarb_mseg_scored_try`): 0 UUIDs/documentos
duplicados, 0 colisiones de folio por proveedor. Corrige también el
hallazgo "~98% sin MSEG" de la investigación original de Fase 1 (retirada,
ver historial de git) — era un artefacto del filtro de material, no un
techo estructural de los datos.

**CECO sugerido (jul-2026, revierte D22): 51% de las facturas.** Se midió que
solo 201/505 documentos MSEG traen un `KOSTL` único y limpio (la mitad reparte
el gasto entre 2-14 centros de coste sin que ninguno domine) — pero **6 de los
11 proveedores son de un solo sitio real** (≥95% de concentración histórica),
así que su CECO es predecible por proveedor, sin depender del match de
documento. Columna nueva `ceco_sugerido` (patrón de proveedor → `KOSTL` del
documento, uno o varios separados por coma → `NULL`): 543/1.056 con
sugerencia (292 únicas, 251 con varios candidatos). Prellena el campo CECO en
`aprobacion-workspace.tsx`, sigue 100% editable — nunca bloquea.

**Cutoff de fecha de negocio `>=2026-01-01` (D31, jul-2026): 1.056 → 547 facturas.**
`proan_MSEG_HIDROCARBUROS_20260714` solo cubre `MJAHR=2026`, pero `cfdis` no
tenía piso de fecha y arrancaba ~jun-2025 — ~7 de ~13-14 meses que MSEG nunca
podía validar (el dato no existe en SAP para ese rango), diluyendo los
indicadores de cobertura. Se añadió `DECLARE cutoff_fecha_negocio DATE DEFAULT
'2026-01-01'` en `HCARB_gold_clasificacion.sql`, exigiendo `FechaTimbrado` **y**
`Fecha` `>=` el cutoff (ambos campos, no solo uno) en el `WHERE` de `cfdis_dedup`
— único punto de corte, `HCARB_gold_validacion_sap.sql` lo hereda vía el `JOIN`
a `HCARB_GOLD_CLASIFICACION_FOLIO`, y `catalog()`/frontend/dashboard no
necesitaron ningún cambio de código. Efecto medido contra BigQuery real:
`confianza_mseg` (Alta/Media) sube de 48% a **90,7%** (confirma que el 48%
previo era un artefacto de cobertura temporal, no un techo de matching real),
`validada_sap` 90,4%→91,0%, `con_sitio` 70,4% (antes ~58%, medido sobre el
histórico completo con peor cobertura SAP). Huérfanos pre-2026 en las tablas
mutables `HCARB_gold_aprobacion` (509 filas, ninguna ya `aprobada`/`rechazada`)
y `HCARB_ESTATUS_SAT` (506 filas) se borraron con `DELETE` explícito.

**Fuente de M1: `D00_SANDBOX.cfdis` → `D30_INTEGRATION.cfdi_completo` (ago-2026,
rama `Fer`, ver más abajo el estado).** `cfdis` venía incompleta: para 414/547
facturas de gas solo traía 1 línea (de gas) aunque `SubTotal` exigiera más —
`importe_gas` ya lo compensaba restando desde `SubTotal` en vez de sumar
líneas (fix jul-2026 de más arriba), así que el importe siempre fue correcto,
pero `n_lineas_total`/`conceptos_gas` (la evidencia auditable de M1) salían
subcontados. `cfdi_completo` trae **todas** las líneas por factura (mismo
grano UUID+concepto, mismas columnas, más un índice posicional
`concepto_idx` por línea). Verificado contra BigQuery real: mismo universo de
facturas del receptor (277.489 vs 277.446 UUID, prácticamente igual) pero con
casi el doble de líneas (543.759 vs 278.776) — confirma que antes faltaban
líneas, no que haya facturas nuevas. Efecto en el universo de gas (tabla de
prueba): 606 → 614 facturas, 606 → 8.060 líneas (hasta 9.333 tras el fix de
dedup de más abajo), 0 → 8 mixtas reales detectadas por primera vez (antes
`es_mixta` daba siempre `false` porque nunca había línea no-gas que ver).
`importe_gas` total prácticamente no se mueve ($91,12M → $91,13M) — la
fórmula ya era robusta a líneas faltantes, esto solo la vuelve auditable.

**Dedup por `UUID+concepto_idx`, no por contenido (ago-2026).** El dedup
original de M1 (`ClaveProdServ+Cantidad+Importe+Descripcion`) daba por hecho
que dos líneas con esos 4 valores iguales eran la misma línea reingresada —
válido con `cfdis` (1 línea/factura, nunca colisionaba) pero no con
`cfdi_completo`, donde es normal que dos conceptos DISTINTOS de una factura
de hasta 49 líneas compartan producto+cantidad+precio+descripción. Medido:
217/614 facturas de gas tenían colisiones así, perdiendo 1.273 líneas reales
— sin efecto en `importe_gas`/`es_mixta` (la colisión siempre caía dentro de
la misma categoría gas/no-gas), pero sí en la evidencia auditable. Fix:
dedupear por `UUID+concepto_idx` (el índice posicional real de la línea,
quedándose con el `_ingested_at` más reciente) — colapsa solo reingestas
genuinas (mismo `_id`, verificado), nunca líneas legítimamente distintas.

**Desglose MSEG por ticket de entrega (ago-2026, M2).** Hasta ahora el match
MSEG era 1 factura ↔ 1 documento SAP AGREGADO (`SUM` de todas sus líneas
ZEILE) — cuando el documento repartía el gasto entre varios CECO, la UI solo
podía pedir "elige uno de estos N". `NoIdentificacion` en cada línea del CFDI
(disponible solo desde `cfdi_completo`) resultó ser el ticket/remito de
entrega: agrupando las líneas de gas de una factura por ese campo, cada
ticket casa por importe (misma tolerancia que el match a nivel documento, ver
abajo) contra una línea ZEILE del documento MSEG ya emparejado, y cada ZEILE
trae su propio KOSTL. Verificado contra BigQuery real: 100% de match
ticket-a-ticket en Corpo Gas (42/42 facturas), 91,7% promedio en Gas Noel
(127/235 perfectas), 69–81% en 3 proveedores más — 0% en 2 proveedores
pequeños cuyo `NoIdentificacion` no sigue este patrón (no se fuerza el match
ahí). Nuevas columnas en `HCARB_GOLD_VALIDACION_SAP` (mismo grano por
factura, `tickets_mseg` es un array anidado): `tickets_mseg`,
`mseg_n_tickets`, `mseg_n_tickets_match`. Nuevo valor `'ticket'` en
`ceco_sugerido_origen` cuando **todos** los tickets de gas de la factura
(uno o varios — antes exigía más de uno, ver dos entradas más abajo)
encontraron su ZEILE exacta: es la fuente de CECO más precisa que existe,
por encima de `'proveedor'` (patrón histórico del proveedor) y de
`'documento'`/`'documento_multiple'` (KOSTL del documento agregado). Efecto
en la tabla de prueba: 199 → 284 facturas con CECO exacto por ticket.

**Tolerancia relativa en el match de importe MSEG (ago-2026).** El $0,20 MXN
fijo (jul-2026, pensado para el ruido de redondeo de la `cfdis` vieja) dejaba
en `'Media'` facturas cuya diferencia real es sistemática y proporcional al
importe, no ruido aleatorio: medido contra BigQuery real (497 facturas con
folio exacto), 41 quedaban fuera del $0,20 pese a diferir un
0,0174–0,0181% MUY consistente del importe (ej. $0,24 en una factura de
$1.369, $1,88 en una de $10.629 — mismo ~0,018%, probablemente una diferencia
de redondeo del precio unitario entre el CFDI y SAP). Justo por encima hay un
hueco limpio: los casos que ya son documentos genuinamente distintos
(recepción consolidada de otras entregas) empiezan en 0,06% — el triple del
techo del ruido real, así que no hay riesgo de colar un importe realmente
distinto. Fix: `tolerancia_importe = GREATEST($0.20, 0.03% del importe)`,
aplicado tanto en `mseg_scored`/`match_importe` (nivel documento) como en el
match por ticket (mismo criterio, consistente). Efecto: `confianza_mseg`
`'Alta'` sube de 447 a 488 sobre el total de 505 `'Alta'`+`'Media'`
(coincide con el histórico de antes del cambio de fuente).

**`confianza_mseg` sube a `'Alta'` con match perfecto por ticket (ago-2026).**
`confianza_mseg` comparaba el documento MSEG COMPLETO contra `importe_gas` de
la factura — si el documento consolida otras entregas/facturas (caso real:
un mismo documento SAP puede cubrir varios CFDIs), ese agregado nunca
reconcilia aunque la factura esté perfectamente corroborada línea a línea.
Caso real: una factura de INFRA (mixta, 3 líneas de gas de 15 totales) tenía
sus 3 tickets casando exacto contra sus 3 ZEILE (`ceco_sugerido_origen` ya
daba `'ticket'`), pero `confianza_mseg` se quedaba en `'Media'` porque el
documento completo suma $180.397 (de otras entregas) contra los $4.056 de
esa factura. Fix: si TODOS los tickets de gas de la factura encontraron su
propia ZEILE (`mseg_n_tickets_match = mseg_n_tickets`), `confianza_mseg` sube
a `'Alta'` aunque el agregado del documento no cuadre — solo puede subir,
nunca baja un `'Alta'` que ya tenía por el match de documento. Efecto en la
tabla de prueba: `'Alta'` sube de 488 a 497, `'Media'` baja de 17 a 8.

**CECO por ticket también con un solo ticket exacto (ago-2026, D33).**
`ceco_sugerido_origen='ticket'` exigía más de un ticket — pero una factura
con una sola línea de gas (caso común en facturas mixtas, ej. INFRA con 1 de
12 líneas) que casa exacto contra su ZEILE es evidencia igual de fuerte, y
más precisa que `'proveedor'` (patrón histórico, no de esta entrega en
concreto) o `'documento_multiple'` (obliga a elegir entre CECOs que ni
siquiera corresponden a este ticket). Cambiado de `n_tickets > 1` a
`n_tickets >= 1` en `ceco_sugerido`/`ceco_sugerido_origen`, ya consistente
con el criterio de `confianza_mseg` de la entrada anterior. Efecto en la
tabla de prueba: `'ticket'` sube de 199 a 284 (+85) — 47 pasaban antes por
`'documento'` (misma respuesta, mejor evidencia), 34 por `'proveedor'`
(patrón genérico → evidencia real de esta factura), 4 por
`'documento_multiple'` (ambigüedad real resuelta). Los 129 casos sin ninguna
sugerencia no cambian — son facturas donde ni el ticket, ni el proveedor, ni
el documento aportan CECO (ver más abajo, caso SC8581).

**Facturas con evidencia MSEG pero sin CECO sugerido — no siempre es
resoluble.** Caso real (SC8581, Distribuidora Potosina de Gas): `confianza_mseg='Alta'`
(folio e importe casan exacto) pero `ceco_sugerido` sale `NULL`. La línea
MSEG que casó trae `KOSTL` genuinamente vacío **en el propio origen SAP**
(verificado en `proan_MSEG_HIDROCARBUROS_20260714`, no es una pérdida de la
query), y el proveedor tampoco es de los "un solo sitio" que prellenan CECO
por patrón histórico. Confirma la limitación ya documentada más arriba
(Fase-1-bis, sección CECO): es un límite de INGESTA, no de modelo — aquí no
hay CECO que sugerir, Compras tiene que capturarlo a mano igual que si no
hubiera match MSEG. Para encontrar estos casos fácilmente se añadió el
filtro **"CECO sugerido"** (Todos/Sin sugerencia/Con sugerencia) en las tres
colas de `apps/frontend` (Compras, Gerencia, Historial) — `sin_sugerencia`
filtra `ceco_sugerido IS NULL` sin importar si hay o no evidencia MSEG, así
aísla exactamente estos casos sin ambigüedad.

**Ejecutado contra producción (sep-2026).** Todo lo anterior desde "Fuente de
M1" (rama `Fer`) se ejecutó contra las tablas reales
`HCARB_GOLD_CLASIFICACION_FOLIO`/`HCARB_GOLD_VALIDACION_SAP`, con snapshot de
seguridad previo (`bq cp` a `*_bak_20260903`) por si hiciera falta revertir.
Cifras medidas en BigQuery real, antes → después:

- `HCARB_GOLD_CLASIFICACION_FOLIO`: 641 → 650 facturas, 641 → 9.890 líneas
  totales (confirma el desglose real por `concepto_idx`, antes 1 línea/factura
  siempre), 0 → 9 mixtas.
- `HCARB_GOLD_VALIDACION_SAP`: 641 → 650 facturas, `confianza_mseg='Alta'`
  445 → **497**, `'Media'` 51 → 9, `ceco_sugerido_origen='ticket'` 0 → **284**
  (38 `'proveedor'`, 11 `'documento'`, 157 `'documento_multiple'`, 160 sin
  sugerencia) — coincide con las cifras que Fernando había medido contra la
  tabla de prueba.
- `Airflow/D60_REPORTING/HCARB_gold_clasificacion.sql` y
  `HCARB_gold_validacion_sap.sql` quedaron sincronizados con estos mismos
  archivos (eran una copia desincronizada de antes de la migración a
  `cfdi_completo`; sin templating propio de Airflow, la copia es literal).
- `HCARB_dim_nucleo_draft` se promovió a `HCARB_dim_nucleo` (92 filas, 57
  `confirmado`, 35 `pendiente_confirmar` — no bloquean, caen en "Sin núcleo
  asignado").
- Pendiente solo la limpieza de artefactos de prueba (los 2 `.sql` `_fer`,
  las tablas `_fer`/`_draft`/`_bak` en BigQuery, y las 4 líneas
  `HCARB_*_TABLE=` de `config/financialbi.env`) — se deja para después de
  verificar el despliegue en producción, a propósito, como red de seguridad.

## Datasets (reutilizados, ninguno nuevo)

- `D50_AGGREGATE_RENTABILIDAD` — tablas `HCARB_STG_*` (staging/dedupe).
- `D60_REPORTING` — tablas `HCARB_GOLD_*` (preparadas para la herramienta),
  mismo dataset donde viven las `MAKA_GOLD_*` de Maka.

## Orden de ejecución (dependencias)

1. `HCARB_stg_vendors.sql`
2. `HCARB_gold_clasificacion.sql` (depende de 1)
3. `HCARB_gold_validacion_sap.sql` (depende de 2)

`HCARB_gold_clasificacion_fer.sql`/`HCARB_gold_validacion_sap_fer.sql` (rama
`Fer`, ago-2026) son variantes de prueba temporales de 2 y 3 — no forman
parte de este orden real, escriben en tablas `_fer` aparte, ver "Estado de la
rama `Fer`" más arriba.

![Linaje de tablas: fuentes → queries → HCARB_*](./linaje-tablas.png)

Fuente editable en [`linaje-tablas.mmd`](./linaje-tablas.mmd). Para
regenerar cualquiera de los `.mmd` de esta carpeta (este y los dos de más
abajo): `npx -y @mermaid-js/mermaid-cli -i <archivo>.mmd -o <archivo>.png -b white -s 2`

Pensado para quedar como tasks de un DAG de **Airflow** — no Cloud Run Job
como el patrón `materialize_alerts.py` de Maka. Por ahora se corre a mano
para el backfill histórico.

## Tablas mutables (no construidas por una query de esta carpeta)

`HCARB_gold_aprobacion` y `HCARB_ESTATUS_SAT` viven en el mismo dataset
(`D60_REPORTING`) pero **no las reconstruye ningún `SELECT` de aquí** —
las escribe el backend directamente (INSERT/UPDATE/MERGE fila a fila) según
acciones humanas o llamadas a un webservice externo. Por eso no hay un
`HCARB_*.sql` "de cálculo" para ellas, pero sí dejamos versionado lo que sí
es reutilizable sin leer Python:

- **`HCARB_gold_aprobacion`** (Módulo 3, dos roles: Compras/Gerencia) —
  esquema + máquina de estados completa en
  [`HCARB_gold_aprobacion_schema.sql`](./HCARB_gold_aprobacion_schema.sql),
  diagrama en [`flujo-aprobacion.png`](./flujo-aprobacion.png) (fuente
  [`flujo-aprobacion.mmd`](./flujo-aprobacion.mmd)). La escribe
  `apps/financialbi/financialbi/aprobacion_engine.py`.
- **`HCARB_ESTATUS_SAT`** (D24, estatus de cancelación ante el SAT) —
  esquema + mecánica en
  [`HCARB_estatus_sat_schema.sql`](./HCARB_estatus_sat_schema.sql), diagrama
  en [`flujo-estatus-sat.png`](./flujo-estatus-sat.png) (fuente
  [`flujo-estatus-sat.mmd`](./flujo-estatus-sat.mmd)). La escribe
  `apps/financialbi/financialbi/estatus_sat.py`, corriendo hoy a mano
  (`python -m financialbi.estatus_sat`) hasta que exista el DAG de Airflow.

`linaje-tablas.png` ya las incluye (subgrafo "Tablas mutables", con flechas
punteadas para distinguirlas de las tablas que sí construye una query).
