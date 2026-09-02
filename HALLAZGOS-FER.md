# Hallazgos rama `Fer` — commit a commit

Registro de trabajo mientras revisamos, uno a uno, los commits de Fernando
Romeo (rama `Fer`, todos del 26-ago-2026). Fuente cruzada: diff real de cada
commit (`git show <hash>`) + [`ConsultasBigQuery/README.md`](ConsultasBigQuery/README.md),
que ya documenta la iteración completa con cifras verificadas contra BigQuery.

Orden de los 9 commits (oldest→newest):

1. `a55decd` — Migrar M1 de `D00_SANDBOX.cfdis` a `D30_INTEGRATION.cfdi_completo`
2. `e59df96` — Dedup por UUID+concepto_idx en vez de por contenido (M1)
3. `b2530d4` — Desglose MSEG por ticket de entrega (M2)
4. `997f5c5` — Backend + UI: desglose MSEG por ticket en la Cola de Compras
5. `7df5986` — Tolerancia relativa en el match de importe MSEG (M2)
6. `2f31ae9` — confianza_mseg sube a Alta con match perfecto por ticket (M2)
7. `87988c4` — CECO por ticket también con un solo ticket exacto (M2, D33)
8. `488d6b6` — Filtro "CECO sugerido" en las colas de aprobación
9. `a0fa60d` — Documentar la iteración completa en el README

---

## 1. `a55decd` — Migrar M1 de `cfdis` a `cfdi_completo`

**Problema real:** `D00_SANDBOX.cfdis` traía incompleta la mayoría de facturas
de gas — 414/547 solo tenían 1 línea aunque el `SubTotal` exigiera más.
`importe_gas` ya compensaba esto restando desde `SubTotal` (nunca fue un bug
de importe), pero `n_lineas_total`/`conceptos_gas` (la evidencia auditable)
salían subcontados.

**Verificación:** mismo universo de facturas del receptor (277.489 vs 277.446
UUID) pero casi el doble de líneas (543.759 vs 278.776) — confirma que
faltaban líneas, no que aparecieran facturas nuevas.

**Diff real:**
- `ConsultasBigQuery/HCARB_gold_clasificacion.sql`: un comentario explicativo +
  **1 línea de cambio real**: el `FROM` de `cfdis_dedup` pasa de
  `D00_SANDBOX.cfdis` → `D30_INTEGRATION.cfdi_completo`.
  - Nota dejada en el propio SQL: `cfdi_completo` trae 1.675 pares de filas
    duplicadas por reingesta, pero el dedup existente ya las absorbía sin
    cambios (ese dedup dejará de ser válido en el commit 2, por otro motivo).
- `ConsultasBigQuery/HCARB_gold_clasificacion_fer.sql` (nuevo, 79 líneas):
  copia temporal que escribe en `HCARB_GOLD_CLASIFICACION_FOLIO_fer` (tabla de
  prueba), para comparar sin tocar la tabla real de producción.
- `apps/financialbi/financialbi/hidrocarburos_engine.py`: la constante
  `_FOLIO` (nombre de tabla que lee el backend) pasa de estar hardcodeada a
  leer `os.getenv("HCARB_FOLIO_TABLE", <tabla real>)` — con fallback seguro a
  la tabla real si la variable no está definida.
- `config/financialbi.env` (**solo desarrollo**, no lo usa Cloud Run): añade
  `HCARB_FOLIO_TABLE=...HCARB_GOLD_CLASIFICACION_FOLIO_fer`.

**Para producción:** ejecutar `HCARB_gold_clasificacion.sql` (sin sufijo)
contra la tabla real `HCARB_GOLD_CLASIFICACION_FOLIO`, y quitar la línea
`HCARB_FOLIO_TABLE=...` de `config/financialbi.env` cuando se confirme.

---

## 2. `e59df96` — Dedup por UUID+concepto_idx (no por contenido)

**Diff real** (idéntico en `HCARB_gold_clasificacion.sql` y su copia `_fer`),
en el `ROW_NUMBER()` que decide qué fila "duplicada" se conserva:

```sql
-- Antes
PARTITION BY UUID, ClaveProdServ, CAST(Cantidad AS STRING), CAST(Importe AS STRING), Descripcion
ORDER BY FechaTimbrado

-- Después
PARTITION BY UUID, concepto_idx
ORDER BY _ingested_at DESC
```

El dedup original daba por buena la asunción de que dos líneas iguales en
esos 4 campos (producto+cantidad+importe+descripción) eran la misma línea
reingresada — válido con `cfdis` (1 línea/factura, nunca colisionaba) pero no
con `cfdi_completo`, donde es normal que dos conceptos DISTINTOS de una
factura de hasta 49 líneas compartan producto+cantidad+precio+descripción
(p.ej. dos entregas iguales el mismo día).

**Medido** (contra la tabla de prueba `_fer`): 217/614 facturas de gas tenían
colisiones así, perdiendo 1.273 líneas reales — sin efecto en
`importe_gas`/`es_mixta` (0 facturas cambiaban, la colisión siempre caía
dentro de la misma categoría gas/no-gas), pero sí en `n_lineas_total`/
`conceptos_gas` (la evidencia auditable que introdujo el commit 1).

**Fix:** dedup por `UUID+concepto_idx` (índice posicional real de la línea
dentro del CFDI — una reingesta duplica el mismo `concepto_idx`, mismo `_id`,
verificado), quedándose con el `_ingested_at` más reciente (antes se quedaba
con la `FechaTimbrado` más antigua) — colapsa solo reingestas genuinas, nunca
líneas legítimamente distintas.

**Verificación:** mismas 614 facturas, mismas 8 mixtas, mismo `importe_gas`
total ($91.13M); `lineas_totales` sube de 8.060 a 9.333.

**Para producción:** parte del mismo `HCARB_gold_clasificacion.sql` pendiente
de ejecutar contra la tabla real (ver commit 1) — no añade pasos nuevos al
checklist.

---

## 3. `b2530d4` — Desglose MSEG por ticket de entrega (M2)

El cambio más grande de los 9. Añade a `HCARB_gold_validacion_sap.sql` un
bloque de 4 CTEs nuevas antes del `SELECT` final:

1. **`tickets_cfdi`** — agrupa las líneas de gas de `cfdi_completo` por
   `NoIdentificacion` (resultó ser el ticket/remito de entrega), solo para
   facturas ya emparejadas con un documento MSEG. Da `cantidad_ticket`/
   `importe_ticket` por ticket.
2. **`zeile_mseg`** — trae cada línea `ZEILE` del documento MSEG ya
   emparejado, con su propio `KOSTL` (antes solo se usaba el documento
   agregado completo, un `SUM` de todas sus ZEILE).
3. **`tickets_match`** — empareja cada ticket con la `ZEILE` cuyo importe
   está a ≤$0.20 (misma tolerancia del match a nivel documento);
   `QUALIFY ROW_NUMBER()` se queda con la ZEILE más cercana si hay varias
   candidatas.
4. **`tickets_agg`** — agrega por factura: `n_tickets`, `n_tickets_match`,
   `cecos_tickets` (KOSTL distintos), y `tickets_mseg` (`ARRAY<STRUCT>`
   anidado, uno por ticket con `match_exacto` booleano). **El grano de la
   tabla no cambia** — sigue 1 fila por factura.

**En el `SELECT` final:**
- Añade columnas: `tickets_mseg`, `mseg_n_tickets`, `mseg_n_tickets_match`.
- `ceco_sugerido` pasa de `COALESCE(ceco_proveedor, cecos_documento)` a
  ```sql
  COALESCE(
    IF(n_tickets > 1 AND n_tickets_match = n_tickets, cecos_tickets, NULL),
    ceco_proveedor,
    cecos_documento
  )
  ```
  (en este commit todavía exige `n_tickets > 1` — el commit 7 lo relaja a
  `>= 1`).
- Añade `'ticket'` como primer caso (máxima prioridad) en el `CASE` de
  `ceco_sugerido_origen`, por encima de `'proveedor'`/`'documento'`/
  `'documento_multiple'`.
- Nuevo `LEFT JOIN tickets_agg ta ON ta.uuid = f.uuid`.

También crea `HCARB_gold_validacion_sap_fer.sql` completo (306 líneas,
archivo nuevo) — misma copia de prueba que escribe en
`HCARB_GOLD_VALIDACION_SAP_fer`.

**Verificado contra BigQuery real:** 100% match ticket-a-ticket en Corpo Gas
(42/42), 91,7% en Gas Noel (127/235), 69–81% en 3 proveedores más, 0% en 2
proveedores pequeños cuyo `NoIdentificacion` no sigue el patrón (no se fuerza
el match ahí — `match_exacto=false` sin bloquear nada). A escala: 199
facturas pasan a tener CECO preciso por ticket (antes habrían caído en
`'documento_multiple'`).

**Para producción:** ejecutar `HCARB_gold_validacion_sap.sql` (sin sufijo)
contra la tabla real `HCARB_GOLD_VALIDACION_SAP`.

---

## 4. `997f5c5` — Backend + UI: desglose MSEG por ticket en la Cola de Compras

Conecta lo que el commit 3 dejó en BigQuery con lo que ve el usuario, en 3
capas:

**Backend (`apps/financialbi`)**
- `hidrocarburos_engine.py`: mismo patrón que `_FOLIO` (commit 1) pero para
  la tabla SAP — `_SAP` pasa de hardcodeada a
  `os.getenv("HCARB_SAP_TABLE", <tabla real>)`.
- `aprobacion_engine.py`: añade `tickets_mseg, mseg_n_tickets,
  mseg_n_tickets_match` a la constante `_SELECT_COLA` (la query que arma la
  respuesta de la Cola de Compras/Gerencia) — sin esto el backend no
  devolvería las columnas nuevas aunque ya existieran en la tabla.
- `config/financialbi.env` (solo desarrollo): añade
  `HCARB_SAP_TABLE=...HCARB_GOLD_VALIDACION_SAP_fer`.

**Tipos (`apps/frontend/src/types/aprobacion.ts`)**
- Añade `tickets_mseg`, `mseg_n_tickets`, `mseg_n_tickets_match` a
  `AprobacionInvoice` y `'ticket'` al union de `ceco_sugerido_origen`.
- Tipo nuevo `AprobacionMsegTicket` (ticket, cantidad, importe, ceco,
  match_exacto).

**UI (`aprobacion-workspace.tsx` + `globals.css`)**
- Añade `'ticket'` a `CECO_ORIGEN_LABEL` (diccionario que explica el origen
  de la sugerencia, ya existía desde julio).
- Función `ticketCorto()`: recorta `NoIdentificacion` (ej.
  `"LP/14561/DIST/PLA/2016-TIC14850357"`) al último tramo, con el valor
  completo en el `title`/tooltip.
- Si `tickets_mseg.length > 1`, pinta una tabla "Desglose por ticket de
  entrega" (Ticket/Cantidad/Importe/CECO), marcando en naranja
  (`is-sin-match`) los tickets sin ZEILE.
- CSS nuevo para esa tabla.

**Verificado end-to-end en Docker local:** factura GCRE13341 (57 líneas/14
tickets) sale con `ceco_sugerido_origen='ticket'`, 14/14 con match exacto.

**✅ Hallazgo confirmado y corregido (2026-09-02, fuera de los commits de
Fernando):** la tabla de desglose solo se pintaba si había **más de 1**
ticket (`tickets_mseg.length > 1`, línea ~371 de `aprobacion-workspace.tsx`).
El commit 7 relaja el SQL de `n_tickets > 1` a `n_tickets >= 1` para que
`ceco_sugerido_origen='ticket'` también aplique con un solo ticket exacto —
pero ningún commit posterior tocaba `aprobacion-workspace.tsx`. Efecto
práctico: una factura con 1 sola línea de gas que casa exacto (caso
BA263791, el que motiva el commit 7) mostraba correctamente
`ceco_sugerido_origen='ticket'` en el resumen, pero la tabla "Desglose por
ticket de entrega" no aparecía. Fix aplicado: `length > 1` → `length > 0` en
`apps/frontend/src/features/aprobacion/aprobacion-workspace.tsx` (el copy
"Desglose por ticket de entrega (X de Y casan exacto)" ya funciona igual con
1 ticket que con varios, no hizo falta tocar nada más).

**Verificado en el navegador (Docker local, Cola de Compras):** factura
EC253 (CORPO GAS, `uuid=33440aa9-df82-4419-9257-0416e9acfab9`, encontrada por
query directa a `HCARB_GOLD_VALIDACION_SAP_fer` — ver query más abajo).
Ahora muestra "CECO sugerido" = ticket + la tabla "Desglose por ticket de
entrega (1 de 1 casan exacto)" con su única fila (TIC41318, 33.64, 308 MXN,
CECO Administración Granjas Aves). Antes del fix esa tabla no aparecía con 1
solo ticket. **Fix cerrado y confirmado.**

Nota operativa encontrada en el camino: el contenedor `carb-financialbi-dev`
solo lee `config/financialbi.env` (`env_file`) al crearse, no en cada
restart -- si se edita ese archivo con el contenedor ya arrancado, hay que
`docker compose -f deploy/docker-compose.dev.yml up -d --force-recreate
carb-financialbi-dev` (un `docker restart` normal no basta).

Query usada para encontrar casos de 1 ticket exacto en la tabla de prueba:
```sql
SELECT f.folio, f.serie, s.uuid, s.mseg_n_tickets, s.mseg_n_tickets_match,
  s.ceco_sugerido_origen, s.ceco_sugerido
FROM `proan-quantrue.D60_REPORTING.HCARB_GOLD_VALIDACION_SAP_fer` s
JOIN `proan-quantrue.D60_REPORTING.HCARB_GOLD_CLASIFICACION_FOLIO_fer` f ON f.uuid = s.uuid
WHERE s.mseg_n_tickets = 1 AND s.mseg_n_tickets_match = 1
LIMIT 5
```

**Para producción:** sin cambios propios en BigQuery; el backend/UI ya están
listos para leer las columnas nuevas. Depende de que el SQL real (commits 3,
5, 6, 7) se ejecute contra las tablas reales, y de quitar las 2 líneas
`HCARB_FOLIO_TABLE`/`HCARB_SAP_TABLE` de `config/financialbi.env`.

---

## 5. `7df5986` — Tolerancia relativa en el match de importe MSEG (M2)

Toca la lógica más central del matching MSEG: el criterio con el que se
decide si el importe de un documento SAP "casa" con `importe_gas`, tanto a
nivel documento como en el match por ticket (commit 3).

- **Antes:** tolerancia fija de $0,20 MXN, sin importar el tamaño de la
  factura.
- **Después:** `tolerancia_importe = GREATEST(0.2, 0.0003 * importe_gas)` —
  $0,20 o el 0,03% del importe, lo que sea mayor (para facturas hasta
  ~$667 sigue siendo $0,20 fijo; por encima escala con el importe).

**Por qué:** medido contra las 497 facturas con folio exacto en BigQuery
real, 41 quedaban en `'Media'` pese a una diferencia del 0,0174–0,0181%
**muy consistente** (no ruido aleatorio — hipótesis: redondeo de precio
unitario CFDI vs SAP; ej. $0,24 en una factura de $1.369, $1,88 en una de
$10.629, mismo ~0,018%). Justo por encima hay un salto limpio a 0,06% (el
triple) — esos sí son documentos genuinamente distintos, así que la
tolerancia nueva no arriesga colar un importe que no corresponde.

**Dónde se aplica** (3 sitios, mismo criterio en los 3 para ser
consistente):
1. `mseg_scored.score` — el CASE que puntúa 3/1/0 según qué tan bien casa
   el importe a nivel documento.
2. `mseg_scored.match_importe` — el booleano que alimenta `confianza_mseg`.
3. `tickets_match` (commit 3) — el `LEFT JOIN` que empareja cada ticket con
   su ZEILE.

**Efecto medido:** `confianza_mseg = 'Alta'` sube de 447 a 488 (sobre 505
Alta+Media, coincide con el histórico previo al cambio de fuente de M1).

Réplica idéntica en `HCARB_gold_validacion_sap_fer.sql`.

**Para producción:** mismo `HCARB_gold_validacion_sap.sql` pendiente de
ejecutar (ver commit 3).

---

## 6. `2f31ae9` — `confianza_mseg` sube a Alta con match perfecto por ticket

Cambio pequeño en el `SELECT` final de `HCARB_gold_validacion_sap.sql`:

```sql
-- Antes
mm.confianza_mseg,

-- Después
CASE
  WHEN ta.n_tickets >= 1 AND ta.n_tickets_match = ta.n_tickets THEN 'Alta'
  ELSE mm.confianza_mseg
END AS confianza_mseg,
```

`confianza_mseg` comparaba el documento MSEG COMPLETO (suma de todas sus
ZEILE) contra `importe_gas` de la factura — si el documento consolidaba
otras entregas/facturas (caso real de SAP, no un bug), el agregado nunca
reconciliaba aunque la factura estuviera perfectamente corroborada línea a
línea. Caso real: factura BA268044 (INFRA, mixta) con 3/3 tickets casando
exacto contra sus 3 ZEILE (`ceco_sugerido_origen` ya daba `'ticket'`) pero
`'Media'` porque el documento completo sumaba $180.397 (otras entregas)
contra los $4.056 de esta factura.

**Fix:** si TODOS los tickets de gas de la factura encontraron su propia
ZEILE (`n_tickets_match = n_tickets`, con al menos 1 ticket), sube a
`'Alta'` ignorando el match a nivel documento — regla de "solo puede subir",
nunca baja un `'Alta'` ya ganado por el documento completo.

**Detalle para el registro:** esta condición ya usa `n_tickets >= 1` desde
este commit (un solo ticket perfecto basta para la *confianza*).
`ceco_sugerido`/`ceco_sugerido_origen` (commit 3) seguían exigiendo
`n_tickets > 1` en este punto — el commit 7 los alinea también a `>= 1`,
citando este commit como precedente de consistencia.

**Efecto:** `'Alta'` sube de 488 a 497, `'Media'` baja de 17 a 8
(Alta+Media se mantiene en 505).

Réplica idéntica en `HCARB_gold_validacion_sap_fer.sql`.

**Para producción:** mismo `HCARB_gold_validacion_sap.sql` pendiente.

---

## 7. `87988c4` — CECO por ticket también con un solo ticket exacto (D33)

Cambio quirúrgico: `> 1` → `>= 1` en dos sitios de
`HCARB_gold_validacion_sap.sql` (más comentarios), replicado en `_fer`:

```sql
-- ceco_sugerido
COALESCE(
  IF(ta.n_tickets >= 1 AND ta.n_tickets_match = ta.n_tickets, ta.cecos_tickets, NULL),  -- antes > 1
  cpp.ceco_proveedor,
  cd.cecos_documento
) AS ceco_sugerido,

-- ceco_sugerido_origen
CASE
  WHEN ta.n_tickets >= 1 AND ta.n_tickets_match = ta.n_tickets THEN 'ticket'  -- antes > 1
  ...
```

`ceco_sugerido_origen='ticket'` (commit 3) exigía más de un ticket, pero una
factura con una sola línea de gas (caso común en facturas mixtas — ejemplo:
BA263791, 1 de 12 líneas) que casa exacto contra su ZEILE es evidencia igual
de fuerte, y más precisa que `'proveedor'` (patrón histórico genérico) o
`'documento_multiple'` (obligaba a elegir entre CECOs que ni siquiera
correspondían a este ticket). El propio commit señala que ya era coherente
hacerlo así porque el commit 6 usaba `>= 1` para `confianza_mseg` — este
cierra esa inconsistencia dentro del SQL.

**Efecto medido:** `'ticket'` sube de 199 a 284 (+85): 47 venían de
`'documento'` (misma respuesta, mejor evidencia), 34 de `'proveedor'`
(patrón genérico → evidencia real de esta factura), 4 de
`'documento_multiple'` (ambigüedad real resuelta, como BA263791). Los 129
casos sin ninguna sugerencia (`NULL`) no cambian — casos reales sin fuente
de CECO (ver commit 8, caso SC8581).

**Nota:** este es el cambio de SQL que dejó desalineada la UI
(`aprobacion-workspace.tsx` seguía con `tickets_mseg.length > 1`) — ver
sección 4 más arriba (hallazgo ya corregido y verificado en el navegador).

**Para producción:** mismo `HCARB_gold_validacion_sap.sql` pendiente.

---

## 8. `488d6b6` — Filtro "CECO sugerido" en las colas de aprobación

Cambio limpio de 4 capas, mismo patrón que el filtro "Centro" (`sitio`) que
ya existía:

- **`apps/financialbi/financialbi/app.py`** — añade
  `ceco_sugerido: Literal["all", "con_sugerencia", "sin_sugerencia"] = "all"`
  al modelo Pydantic `AprobacionFiltros`.
- **`apps/financialbi/financialbi/aprobacion_engine.py`** — en
  `_filtros_cola()` (función que arma el `WHERE`, **compartida por las 3
  colas**: Compras, Gerencia, Historial):
  ```python
  if ceco_sugerido == "sin_sugerencia":
      clauses.append("s.ceco_sugerido IS NULL")
  elif ceco_sugerido == "con_sugerencia":
      clauses.append("s.ceco_sugerido IS NOT NULL")
  ```
  Al ser una función compartida, este único cambio habilita el filtro en las
  tres colas de golpe.
- **`apps/frontend/src/types/aprobacion.ts`** — añade `ceco_sugerido` al
  tipo `AprobacionFiltros`.
- **`aprobacion-workspace.tsx`** — añade el `<select>` del filtro
  ("Todos"/"Sin sugerencia (a mano)"/"Con sugerencia") y lo suma a
  `activeFilterCount`.

**Por qué:** caso real (SC8581, Distribuidora Potosina de Gas):
`confianza_mseg='Alta'` pero `ceco_sugerido` sale `NULL` porque el `KOSTL` de
la línea MSEG que casó viene genuinamente vacío **en el propio SAP**
(verificado, no es pérdida de la query) y el proveedor no es de los de "un
solo sitio". Es un límite de INGESTA, no de modelo — antes no había forma de
aislar estos casos para que Compras supiera que tiene que capturar el CECO a
mano.

**Verificado end-to-end:** 129 facturas sin sugerencia / 484 con sugerencia
en la Cola de Compras (coincide con los 129 `NULL` del commit 7).

**Para producción:** cambio de frontend/backend puro, no toca BigQuery —
pero solo tiene sentido pleno una vez la columna `ceco_sugerido` de la tabla
real refleje la lógica nueva, o sea, una vez se ejecuten los `.sql` reales
(commits 3, 5, 6, 7).

---

## 9. `a0fa60d` — Documentar la iteración completa en el README

Vuelca todo lo anterior en `ConsultasBigQuery/README.md` con el mismo formato
que el resto del changelog, cifras verificadas contra BigQuery real, y cierra
con la sección "Estado de la rama `Fer`" (ver siguiente apartado).

---

## Qué falta para pasar todo esto a producción

Según la propia sección "Estado de la rama `Fer`" del README, checklist en
orden:

1. **Ejecutar los `.sql` reales contra las tablas de producción** (afecta
   producción, requiere confirmación explícita antes de correrlo):
   - `ConsultasBigQuery/HCARB_gold_clasificacion.sql` → sobreescribe
     `HCARB_GOLD_CLASIFICACION_FOLIO`.
   - `ConsultasBigQuery/HCARB_gold_validacion_sap.sql` → sobreescribe
     `HCARB_GOLD_VALIDACION_SAP`.
   - Ambos ya tienen el cambio de fuente/lógica en el código SQL, pero **no se
     han vuelto a ejecutar** contra las tablas reales — esas tablas siguen
     siendo las de julio, sobre `cfdis` (la fuente vieja).
2. **Decidir sobre `Airflow/D60_REPORTING/`** — es una copia paralela de estas
   queries que ya iba desincronizada de `ConsultasBigQuery/` en fixes
   anteriores (ver comentario en el `README.md` raíz del repo). Hay que
   decidir si el cambio se replica ahí también antes de mergear.
3. **Borrar los artefactos temporales de prueba** una vez confirmado el
   cambio en producción:
   - `ConsultasBigQuery/HCARB_gold_clasificacion_fer.sql` y
     `HCARB_gold_validacion_sap_fer.sql` (los `.sql` `_fer`).
   - Las tablas `HCARB_GOLD_CLASIFICACION_FOLIO_fer`,
     `HCARB_GOLD_VALIDACION_SAP_fer` y `HCARB_gold_aprobacion_fer` (esta
     última añadida hoy, ver sección "CECO por ticket/línea" más abajo) en
     BigQuery.
   - Las 3 líneas `HCARB_FOLIO_TABLE=`/`HCARB_SAP_TABLE=`/
     `HCARB_APROBACION_TABLE=` en `config/financialbi.env` (para que el
     backend local vuelva a leer las tablas reales).
4. **Mergear la rama `Fer` a `main`** una vez hecho lo anterior.

Nada de esto se ha aplicado todavía — todo lo probado corre en local contra
las tablas `_fer`, sin tocar lo que lee producción hoy.

---

## CECO por ticket/línea en el Módulo 3 (trabajo nuevo, 2026-09-02, no es de Fernando)

Al revisar el commit 8 (`488d6b6`) en Docker local, se encontró un caso real
(**GCRE11785**, Distribuidora de Gas Noel, `uuid=9591c636-4e25-4477-9d65-87b14305d9a6`)
donde el desglose por ticket identifica **2 CECOs reales distintos** en la
misma factura (740 MXN → `0000041003` Mantenimiento de Maquinaria, 144 MXN →
`0000041744` Mantenimiento de Granjas). La UI de Compras juntaba ambos
códigos en un único campo de texto (`"0000041003, 0000041744"`) que en el
fondo espera un solo CECO por factura — si Compras no lo corregía a mano, ese
string inválido se guardaba como el CECO de toda la factura. El propio
`dashboard_engine.py` ya anticipaba el problema: cualquier `ceco` con coma se
agrupa como "Varios CECO (sin confirmar)" sin repartir el importe. Medido:
**248 de 614 facturas de prueba (40%)** tienen varios CECOs sugeridos.

Plan completo en `C:\Users\Pablo Coma\.claude\plans\quiet-seeking-acorn.md`
(aprobado y ejecutado). Cambios:

- **Aislamiento de `HCARB_gold_aprobacion` en desarrollo**: la tabla no tenía
  variable de entorno (a diferencia de `_FOLIO`/`_SAP`) — cualquier prueba
  local (validar/aprobar/rechazar/reabrir) escribía en la tabla REAL de
  producción. Se añadió `HCARB_APROBACION_TABLE` (mismo patrón que
  `HCARB_FOLIO_TABLE`/`HCARB_SAP_TABLE`) en `aprobacion_engine.py`,
  `dashboard_engine.py` y `estatus_sat.py` (import compartido, no 3 copias),
  y la línea correspondiente en `config/financialbi.env` apuntando a
  `HCARB_gold_aprobacion_fer`.
- **Esquema**: columna nueva `ceco_por_ticket STRING` (JSON-encoded array de
  `{ticket, ceco, importe_ticket}`) en `HCARB_gold_aprobacion`, añadida vía
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` idempotente en `ensure_schema()`.
  `NULL` para el caso común (1 solo CECO real).
- **Backend**: `capturar_compras()` acepta `ceco_por_ticket` opcional; si se
  recibe, deriva el `ceco` legado (único valor si coincide, lista con coma si
  no) para que las vistas que solo leen `ceco` sigan funcionando.
  `reabrir()` también lo limpia. Nuevo modelo Pydantic `CecoPorTicketItem` en
  `app.py`.
- **UI** (`aprobacion-workspace.tsx`): cuando `tickets_mseg` agrupado por
  CECO sugerido da más de 1 grupo distinto, el campo único de CECO se
  sustituye por una tabla editable — una fila por grupo (no por ticket
  individual: una factura de 69 tickets puede tener solo 14 CECOs distintos,
  caso real EC287), cada una con su propio input. La tabla de solo lectura
  "Evidencia MSEG" muestra el CECO confirmado en vez del solo sugerido
  cuando ya existe.
- **Dashboard** (`dashboard_engine.py`): `_gasto_por_ceco` reparte
  `importe_gas` proporcionalmente entre los CECO confirmados por ticket
  (`UNION ALL` entre facturas con reparto confirmado y el resto, que sigue
  la lógica de siempre); el filtro `ceco=` del dashboard también busca
  dentro de `ceco_por_ticket` (`EXISTS`+`UNNEST`+`JSON_VALUE`), no solo en el
  campo legado.

**Verificado end-to-end** contra Docker local + BigQuery real: GCRE11785
capturado con los 2 CECOs correctos (`ceco_por_ticket` con ambos tickets,
`ceco` derivado como `"0000041003, 0000041744"`), tabla editable confirmada
visualmente en el navegador, SQL de dashboard corriendo sin error (dry-run +
ejecución real contra `_fer`).

### Bug encontrado de paso: duplicados en `sync_pendientes()` (preexistente, ya arreglado)

Al probar el envío a Gerencia, la factura apareció **3 veces** en Historial.
Investigado: **el 100% de las filas** de `HCARB_gold_aprobacion_fer` tenían
exactamente 3 copias idénticas (mismo timestamp de captura en las 3,
confirmando que ya existían como duplicados de `pendiente_validacion_compras`
antes de nuestro envío, y el `UPDATE` de `capturar_compras()` simplemente
actualizó las 3 a la vez). Causa: `sync_pendientes()` hacía un
`INSERT INTO ... SELECT ... LEFT JOIN ... WHERE a.uuid IS NULL` (anti-join en
dos pasos) — si varias peticiones concurrentes llegan antes de que la primera
haga commit (justo lo que pasa al recrear la tabla vacía y recargar la
página varias veces), todas ven "sin fila todavía" e insertan la misma
factura más de una vez (BigQuery no tiene restricciones `UNIQUE`).

**Verificado que NO afecta a producción**: `HCARB_gold_aprobacion` (la tabla
real) tiene 641 filas = 641 UUIDs distintos, sin duplicados — el bug estaba
en el código pero nunca se disparó ahí (no ha habido esa ventana de
concurrencia en producción todavía).

**Fix aplicado**: `sync_pendientes()` pasa de `INSERT...SELECT` anti-join a
`MERGE ... WHEN NOT MATCHED THEN INSERT` (atómico en BigQuery; BigQuery
serializa los `MERGE` concurrentes sobre la misma tabla en vez de dejarlos
pasar a ambos sin más). Tabla de prueba `HCARB_gold_aprobacion_fer`
deduplicada (`CREATE OR REPLACE` con `ROW_NUMBER() OVER (PARTITION BY uuid)`)
antes de seguir probando. No hizo falta tocar la tabla real (sin duplicados).

---

## Revisión del dashboard tras "CECO por ticket" (2026-09-02, trabajo nuevo)

Al revisar la pestaña Dashboard con los cambios ya hechos, surgieron 3
mejoras sobre el gráfico "gasto por CECO" (`_gasto_por_ceco` en
`dashboard_engine.py`, `RankedBarChart` en `charts.tsx`):

1. **Bug real de `key` en React** (preexistente, no de hoy): `RankedBarChart`
   usaba `key={item.grupo}` — como muchas facturas con `documento_multiple`
   comparten la etiqueta `"Varios CECO (sin confirmar)"`, React colisionaba
   esas keys y solo reconciliaba una de cada grupo de duplicados. Fix:
   `key={item.filtro}` (único por el `GROUP BY` del backend).
2. **Tono de aviso**: `RankedBarChart` gana un prop opcional `warnLabel` —
   la barra cuyo `grupo` coincida se pinta con `var(--color-warning)` (barra
   y etiqueta), igual que el resto del dashboard reserva colores de estado.
   Se usa solo en el gráfico de CECO, con `warnLabel="Varios CECO (sin
   confirmar)"` (constante `VARIOS_CECO_LABEL` en `dashboard-workspace.tsx`,
   debe coincidir literalmente con el string que arma el backend).
3. **Bug real de agregación en el backend** (preexistente, no de hoy, pero
   destapado por el fix del punto 1): `_gasto_por_ceco` agrupaba por
   `(filtro, grupo)` con `filtro` = la combinación LITERAL de códigos (ej.
   `"0000042050, 0000042051, ..."`). El comentario del código ya decía "se
   agrupan aparte en vez de fragmentar el gráfico en una barra distinta por
   cada combinación", pero el código no lo hacía -- cada combinación distinta
   salía como su propia fila (~30 en la tabla de prueba), todas tituladas
   igual. Antes del fix del punto 1 esto era invisible (el bug de `key` las
   escondía "por accidente"); al arreglar el `key` se hizo evidente. Fix: el
   `filtro` de esas filas pasa a ser un sentinela fijo `__VARIOS_CECO__`
   (mismo patrón que `__SIN_CECO__`), así todas se consolidan en una sola
   barra. `_construir_filtro` (compartido por las 5 queries del dashboard)
   gana la rama `elif ceco == "__VARIOS_CECO__"`, que además excluye las ya
   confirmadas por ticket (`a.ceco_por_ticket IS NULL AND STRPOS(...) > 0`)
   -- clicar la barra ahora filtra correctamente "todas las facturas
   ambiguas sin confirmar", no una combinación arbitraria.

**Verificado contra BigQuery real**: la query consolidada da **una sola**
fila `Varios CECO (sin confirmar)` con 247 facturas (248 del hallazgo
original menos GCRE11785, ya confirmada) y ~$45.86M -- antes de este fix
habría sido ~30 filas separadas. Confirmado visualmente en el navegador:
una sola barra, en tono de aviso.

Quedaron 2 mejoras propuestas y aparcadas a propósito (decisión de producto,
no bug): un KPI dedicado para "facturas con CECO sin confirmar" fuera del
gráfico, y ver si el filtro `__VARIOS_CECO__` resulta útil en la práctica una
vez el equipo use esto una temporada.
