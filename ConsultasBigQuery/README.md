# ConsultasBigQuery

SQL de producto de proan-Hidrocarburos: construye las tablas `HCARB_*` que
lee la herramienta. No es investigación (eso vive en
`Datos/PHASE1/queries/` y `Datos/PHASE2/queries/`) — esto se mantiene y se
re-ejecuta. Diseño completo (por qué, columnas, máquina de estados) en
[`Datos/PHASE2/resumen.md`](../Datos/PHASE2/resumen.md) y
[`Datos/PHASE2/Esquema.md`](../Datos/PHASE2/Esquema.md).

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
facturas, ~$40.2M, 11 proveedores, 74.3% mixtas, 898 validada_sap, 569 con
sitio, 21 con recepción MSEG — todo dentro de lo esperado.

**D26:** `HCARB_GOLD_CLASIFICACION_LINEA` (no bug) salió con el mismo número
de filas que `_FOLIO` (1.051=1.051) — los conceptos no-gas de una factura
mixta no se guardan como filas aparte en `cfdis` (Fase 1 §16), sin desglose
real que mostrar. **Eliminada** de `HCARB_gold_clasificacion.sql` y borrada
de BigQuery (`DROP TABLE`, jul-2026, autorizado explícitamente). Quedan 3
tablas `HCARB_*` vivas: `HCARB_STG_VENDORS` (D50), `HCARB_GOLD_CLASIFICACION_FOLIO`
y `HCARB_GOLD_VALIDACION_SAP` (D60).

## Datasets (reutilizados, ninguno nuevo)

- `D50_AGGREGATE_RENTABILIDAD` — tablas `HCARB_STG_*` (staging/dedupe).
- `D60_REPORTING` — tablas `HCARB_GOLD_*` (preparadas para la herramienta),
  mismo dataset donde viven las `MAKA_GOLD_*` de Maka.

## Orden de ejecución (dependencias)

1. `HCARB_stg_vendors.sql`
2. `HCARB_gold_clasificacion.sql` (depende de 1)
3. `HCARB_gold_validacion_sap.sql` (depende de 2)

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

Detalle narrativo adicional (no versionado en git) en
`Datos/PHASE2/Esquema.md` §4-5.
