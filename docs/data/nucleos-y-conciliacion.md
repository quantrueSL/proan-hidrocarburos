# Núcleos y conciliación: estado, implementación y problemas conocidos

Este documento junta dos temas que viven repartidos por el repo (código,
`ConsultasBigQuery/README.md`, un `.md` de hallazgos ya borrado del árbol de
trabajo) para tener un solo punto de entrada antes de trabajar sobre ellos.
No sustituye a las fuentes vivas — enlaza a ellas — pero sí es el único sitio
donde estos dos temas aparecen juntos con sus problemas abiertos.

- El **porqué estructural** de la conciliación (por qué CFDI y SAP nunca casan
  al 100%) ya está documentado a fondo en
  [`naturaleza-de-los-datos.md`](./naturaleza-de-los-datos.md). Este documento
  no lo repite: resume el **qué** (los 4 pilares que ve el usuario, con
  cifras) y centraliza también el tema de **núcleos**.
- El detalle commit a commit de cómo se construyó todo esto vivía en
  `HALLAZGOS-FER.md` (raíz del repo), borrado en `87c2488` por limpieza de
  documentación histórica. Sigue recuperable con
  `git show 87c2488^:HALLAZGOS-FER.md`. Este documento rescata de ahí lo que
  seguía siendo información viva (sobre todo la sección 11, núcleos) y lo que
  quedó como problema abierto.

## 1. Conciliación: los 4 pilares que ve el usuario

La herramienta no "calcula" un match exacto — acumula evidencia dentro de los
límites de lo que cada sistema de origen (CFDI, MSEG, BKPF/BSAK/BSIK, EKBE)
realmente registra. Ver `naturaleza-de-los-datos.md` para el porqué completo
de cada uno. Resumen de los 4 pilares, tal como se explican hoy en el propio
manual de usuario (`apps/frontend/app/(authenticated)/manual/page.tsx:154-509`):

| Pilar | Qué compara | Niveles / resultado | Dónde se calcula |
|---|---|---|---|
| **SAP** | Folio de la factura vs. asiento contable (`BKPF`, tipo `RE`) y partida de proveedor (`BSAK`/`BSIK`) | Validada SAP / Sin match SAP | `HCARB_GOLD_VALIDACION_SAP` |
| **MSEG** | Folio + importe vs. documento de recepción física, con corroboración adicional por ticket/ZEILE | Alta (documento e importe compatibles, o todos los tickets casan) / Media (folio ok, sin desglose completo) / Sin evidencia | `HCARB_GOLD_VALIDACION_SAP`, tolerancia `MAX($0.20 MXN, 0.03% del importe)` |
| **Centro (sitio)** | Folio → pedido de compra (`sap_purchasing_orders`) → entrada de mercancía (`EKBE`) → planta (`WERKS`) | Centro detectado / sin centro (Compras lo captura a mano) | `ConsultasBigQuery/HCARB_gold_validacion_sap.sql`; `dashboard_engine.py` solo lo consume y agrupa |
| **CECO** | `KOSTL` del documento MSEG que casó, por 3 reglas en cascada (ticket → proveedor ≥95% → documento completo) | Sugerencia única, reparto exacto por ticket, varias opciones, o `NULL` sin sugerencia (nunca bloquea) | `ConsultasBigQuery/HCARB_gold_validacion_sap.sql`; `aprobacion_engine.py` lo consume y guarda la decisión de Compras |

**Cifras que muestra hoy el manual de usuario** (`manual/page.tsx:158-162`,
universo declarado ahí: **547 facturas**):

- Cobertura SAP: 91,2%
- Confianza MSEG alta: 81,4%
- Centro detectado: 70,4%
- CECO con varias opciones candidatas: 250 (46%)
- El mismo modal cita además 123 sugerencias por regla "proveedor" (≥95% a un
  solo CeCo) y 99 por regla "documento" sin ambigüedad.

### ⚠️ Problema conocido: estas cifras están desactualizadas

`manual/page.tsx` no se ha tocado desde antes de la iteración de la rama
`Fer` (último commit que lo tocó: `33be381`, muy anterior a `a0fa60d`/`860d1aa`).
Las cifras de conciliación están **hardcodeadas en el JSX**, no se calculan en
vivo. Tras el despliegue a producción de sep-2026
(`ConsultasBigQuery/README.md`, sección "Ejecutado contra producción"), el
universo pasó de 641 a 650 facturas. Como la fuente sigue recibiendo datos,
esa cifra tampoco debe tratarse como un total permanente.

**Snapshot verificado directamente contra BigQuery el 2026-09-09:**

- 657 facturas.
- 611 `validada_sap` (**93,0%**).
- 497 con `confianza_mseg='Alta'` (**75,6%**) y 9 con `'Media'`.
- 437 con centro detectado (**66,5%**).
- Origen de la sugerencia CECO: 284 `ticket`, 41 `proveedor`, 11
  `documento`, 157 `documento_multiple` y 164 sin sugerencia.
- 249 facturas tienen más de un CECO en `ceco_sugerido`, pero no todas son
  ambiguas: 157 vienen de `documento_multiple` y requieren elegir; en las
  otras 92 el desglose por ticket ya identifica el reparto exacto entre CECO.

El manual sigue mostrando "547 facturas" / "81,4%" / etc. y describe los
CECO múltiples como si todos fueran alternativas entre las que Compras debe
elegir. No rompe nada, pero ya no representa ni el volumen ni la semántica
actuales. Pendiente: sustituir esas cifras por un resumen vivo específico o,
si no se quiere añadir otra consulta, mostrar únicamente explicación
cualitativa. Una nueva foto hardcodeada volvería a caducar.

### Problema estructural (no es un bug, es un límite de datos)

"El problema del CECO" (`manual/page.tsx:439-506`): el CECO no está ligado a
la factura de gas en ningún sistema de origen — ni el pedido de compra ni el
asiento contable traen esa imputación para estos proveedores. Es un límite de
**ingesta**, no algo que una query mejor pueda resolver (detalle completo en
`naturaleza-de-los-datos.md`, sección "El CECO"). Consecuencia práctica según
el snapshot del 2026-09-09: 157 facturas traen varios candidatos realmente
ambiguos y 164 no tienen ninguna sugerencia; las 92 con varios CECO de origen
`ticket` ya tienen un reparto respaldado línea a línea y requieren
confirmación, no elegir arbitrariamente un único CECO.

## 2. Núcleos: agrupación de instalaciones por entidad federativa

### Origen y qué es

Methagas compartió un Excel — **`Propuesta de relación de núcleos e
instalaciones asociadas PROAN.xlsx`** (raíz del repo) — para agrupar
instalaciones de gas en **núcleos** por entidad federativa (Jalisco,
Chihuahua, San Luis Potosí), relevante para el umbral mínimo de consumo de
gas. El Excel da nombres (núcleo → instalación → CeBe tal como aparece en SAP
por proveedor), **no** códigos KOSTL reales — ese cruce hubo que construirlo.

### Cómo se construyó el cruce Núcleo↔CeCo

Tabla `HCARB_dim_nucleo` (antes `HCARB_dim_nucleo_draft`) en `D60_REPORTING`.
De 101 nombres de CeBe distintos en las 5 hojas del Excel, se cruzaron contra
el catálogo real de SAP (`proan_CSKT_20260714`) y contra uso real en
`proan_MSEG_HIDROCARBUROS_20260714`, **filtrado por el proveedor correcto de
cada fila** (no en agregado — un primer intento sin ese filtro habría elegido
mal en al menos un caso real, "Santa Elena Sitio 1", donde el candidato con
más uso total era de un proveedor totalmente distinto).

Resultado inicial: **92 filas — 57 `confirmado`** (con su KOSTL real) y **35
`pendiente_confirmar`** (sin candidato de texto, o candidatos sin ninguna
línea de gas real bajo el proveedor esperado).

### Autoridad y estados del cruce

SAP y Methagas responden preguntas diferentes y ambos se consideran fuentes
autoritativas dentro de su ámbito:

- **SAP** identifica el CECO real (`KOSTL`), su nombre y su estructura
  organizativa.
- **Methagas** define la relación de negocio instalación/núcleo del Excel.

Por tanto, una relación normal incluida en la propuesta de Methagas no necesita
una segunda "confirmación" de negocio. Solo queda pendiente cuando el propio
Excel expresa una duda (`Por confirmar`, pertenencia aves/cerdos sin definir,
etc.) o cuando el nombre del Excel no permite identificar un único KOSTL en
SAP.

El 2026-09-09 se separaron esas dos preguntas en producción, conservando el
campo antiguo `estado` temporalmente para compatibilidad:

| Dimensión | Valores | Significado |
|---|---|---|
| `estado_identificacion_ceco` | `confirmado`, `candidato_multiple`, `sin_candidato` | Si el nombre/CeBe de Methagas se ha vinculado de forma determinista a un KOSTL de SAP |
| `estado_asignacion_nucleo` | `confirmada`, `pendiente_negocio` | Si la pertenencia del CECO al núcleo está definida por Methagas |
| `fuente_asignacion` | `methagas_excel` | Procedencia de la relación de negocio |

Las 92 filas tienen también `fuente_asignacion='methagas_excel'`. El backend ya
exige identificación `confirmado` y asignación `confirmada`; por eso un KOSTL
identificado que aún no tenga núcleo decidido no se publica en el catálogo.
El campo antiguo `estado` queda solo como compatibilidad y no debe emplearse
para nuevas consultas.

La derivación en una factura debe ser automática: CECO confirmado + relación
confirmada produce núcleo confirmado; CECO sugerido + relación confirmada
produce núcleo sugerido. Si hay varios CECO, todos en el mismo núcleo producen
un único núcleo; distintos núcleos producen varias posibilidades; y una
cobertura incompleta se presenta como parcial. Sin CECO ni candidato no se
puede derivar un núcleo con este modelo.

### Implementación

| Pieza | Archivo | Qué hace |
|---|---|---|
| Tabla de catálogo | `HCARB_dim_nucleo` (`D60_REPORTING`) | `ceco`, `nucleo`, estados independientes de identificación/asignación, `fuente_asignacion`; `estado` se conserva por compatibilidad |
| Config de tabla | `apps/financialbi/financialbi/aprobacion_engine.py:36-43` | `_NUCLEO_TABLE` / `_NUCLEO`, mismo patrón que `_FOLIO`/`_SAP`/`_APROBACION` |
| Catálogo de solo lectura | `aprobacion_engine.py` (`catalogo_nucleo()`) | `{id: ceco, nombre: nucleo}` solo con CECO identificado y asignación confirmada, sin `<datalist>` |
| Endpoint | `apps/financialbi/financialbi/app.py` | `GET .../aprobacion/catalogo/nucleo` |
| Agregado dashboard | `apps/financialbi/financialbi/dashboard_engine.py` (`_gasto_por_nucleo`) | Mismo criterio doble que el catálogo y los filtros |
| Filtro | `dashboard_engine.py` (`_construir_filtro`) | Parámetro `nucleo` (`__SIN_NUCLEO__` o nombre real) |
| Frontend dashboard | `apps/frontend/src/types/dashboard.ts`, `dashboard-workspace.tsx` | `gasto_por_nucleo`, 5º `RankedBarChart`, `warnLabel="Sin núcleo asignado"` |
| Frontend Módulo 3 | `apps/frontend/src/features/aprobacion/aprobacion-workspace.tsx` | Las columnas CECO/Núcleo muestran el estado de asignación; el detalle resuelve códigos y núcleos por ticket, también para Gerencia |
| Diagrama de linaje | `ConsultasBigQuery/linaje-tablas.mmd:33,60` | Nodo `HCARB_dim_nucleo`, "cruce Núcleo↔CeCo, propuesta Methagas x SAP" |
| Nota de despliegue | `ConsultasBigQuery/README.md`, sección "Ejecutado contra producción" | Confirma que la tabla ya se promovió en producción |

### Bug encontrado y corregido (historia, ya resuelto)

Primer intento de `_construir_filtro` para `nucleo=` anidó un `EXISTS`
adicional contra `_NUCLEO` dentro del `EXISTS`/`UNNEST` correlacionado que ya
existía para `ceco=`. BigQuery lo rechaza en tiempo de **ejecución** (no en
`dry_run`): *"Correlated subqueries that reference other tables are not
supported unless they can be de-correlated"* — un `EXISTS` correlacionado
contra la factura, anidado dentro de otra subconsulta contra una tabla
distinta, no se puede decorrelacionar.

**Fix aplicado:** el lado `_NUCLEO` se resuelve como `IN (SELECT ceco FROM
_NUCLEO WHERE ...)` (no correlacionado), y el lado `ceco_por_ticket` como un
`JOIN` dentro del propio `EXISTS` (`FROM UNNEST(...) JOIN _NUCLEO ON ...`), en
vez de anidar dos `EXISTS`. Verificado que el conteo coincide exacto con
`_gasto_por_nucleo` (32 facturas para "Reproducción de Aves", 182 para "Sin
núcleo asignado", cifras de la tabla de prueba antes del despliegue).

### Expectativa correcta, no un bug

Entre las facturas con un único CeCo real, la mayoría cae en **"Sin núcleo
asignado"**. En la prueba previa al despliegue eran 182 de 614 facturas del
universo completo. No es un error: son CeCo de
mantenimiento/administrativos fuera del alcance del Excel de Methagas, o cuya
asignación de núcleo sigue pendiente. Aparte quedan "Sin CECO" y "Varios CECO
sin confirmar", que son buckets propios y no cuentan como "sin núcleo" (no
confundir los tres). Tras la primera versión auditada del catálogo del
2026-09-09 los buckets son: 129 facturas con núcleo, 115 "Sin núcleo
asignado", 164 "Sin CECO" y 249 "Varios CECO (sin confirmar)"; suman las 657
facturas del universo. Por tanto, "Sin núcleo asignado"
no es la barra mayoritaria del gráfico completo; sí lo es dentro del
subconjunto con CeCo único y no nulo.

### Problemas / pendientes abiertos

1. **Primera versión operativa pendiente de validación de negocio.** La
   auditoría ampliada dejó 85 relaciones CECO→núcleo utilizables, seis CECO
   identificados con `estado_asignacion_nucleo='pendiente_negocio'` y un único
   alias sin KOSTL. Los 91 CECO identificados son distintos y ninguno pertenece
   a dos núcleos. La sección 3 explica el criterio y los casos prioritarios que
   deben validar PROAN/Methagas.
2. **El Excel contiene más catálogo de negocio que la tabla actual.** Se
   contaron 57 entradas de núcleo (55 distintas por entidad), 88 instalaciones
   y ningún KOSTL. `HCARB_dim_nucleo` contiene 39 agrupaciones distintas. Hay
   16 núcleos omitidos porque sus filas no aportaban un CeBe usable: Gato
   Grande, Cedros, Capiro, Calma, Buena Vista, San Francisco, Santa Clara,
   Lechones, La Fortuna, La Esperanza, Huevo PAN, Cerdo de Línea KG, Alamo,
   Planta de Alimentos PROAN, Santa Isabel y Posta Los Encinos. La tabla actual
   es por tanto un puente, no un catálogo completo de núcleos de negocio.
3. **Fuente del cruce es un Excel externo**, no una tabla de sistema — si
   Methagas actualiza la propuesta (nuevas instalaciones, núcleos
   renombrados), `HCARB_dim_nucleo` no se actualiza sola; hay que rehacer el
   cruce a mano y volver a cargar con `bq load`.
4. **Dato de nombre, no de código real** desde origen — el Excel da nombres
   de CeBe, no KOSTL; todo el proceso de "confirmado" depende de que el cruce
   texto→código (hecho una vez, a mano, filtrado por proveedor) siga siendo
   válido. Un proveedor nuevo o un CeCo renombrado en SAP puede volver a
   generar falsos negativos como el caso ya detectado de "Santa Elena Sitio
   1".
5. **Detalle y filtro del dashboard alineados con el agregado (resuelto en
   4A).** `facturas_detalle()` obtiene los CECO efectivos desde
   `ceco_por_ticket`, muestra todos sus núcleos y señala la cobertura parcial.
   El filtro `__SIN_NUCLEO__` incluye también repartos confirmados cuando
   ninguno de sus CECO pertenece al catálogo, sin mezclarlos con los repartos
   múltiples todavía sin confirmar. En el snapshot previo a este cambio aún
   no había filas `ceco_por_ticket` confirmadas en producción; la corrección
   evita que el primer caso real nazca con un detalle o filtro incoherente.

La cobertura técnica ya contempla los seis bloques concurrentes del dashboard,
los filtros y el catálogo de núcleo, y la autorización de `catalogo/nucleo`.
Módulo 3 ya distingue CECO confirmado, sugerido, parcial, ambiguo o ausente;
deriva núcleo único, múltiple, parcial o ausente y muestra el desglose por
ticket en el detalle.

## 3. Auditoría ampliada y primera versión operativa (2026-09-09)

Un segundo análisis propuso usar actividad total MSEG para descartar códigos
"fantasma" y normalizar tildes, abreviaturas y sinónimos. La idea aportó muchos
candidatos válidos, pero el criterio de actividad no bastaba por sí solo:
`Agua Fría Sitio 1` tenía tres candidatos activos y `Playita Sitio 3`, dos.

La revisión final combinó cuatro evidencias:

1. hoja, bloque de negocio y columna de proveedor del Excel de Methagas;
2. nombre vigente en CSKT;
3. sociedad/rama/centro de beneficio en CSKS (`BUKRS`, `GSBER`, `PRCTR`);
4. actividad MSEG total y bajo el proveedor de gas esperado.

Esto resuelve correctamente aparentes empates. Por ejemplo, La Jara y Playita
están en el bloque de cerdos, por lo que corresponden a `0000041910` y
`0000041901` (`PAN/C`), no a los homónimos activos `PAN/H`. Pato 1–4, San
Diego y San Isidro están en aves y se eligieron sus códigos `PAN/H`. Para Agua
Fría se asociaron los dos códigos de cerdos (`0000041986` y `0000041801`) a
las dos referencias del Excel, en lugar del homónimo de aves `0000041707`.

También se confirmaron por nombre, estructura y/o MSEG los cruces de Pastor,
CEPRO, Trillas, San José, San Juanico, Santa Cruz, Labor, Olivo/Olivares,
Santo Domingo, Cuijal y dos de los tres alias de Bernalejo. Cuijal destaca con
179 movimientos del proveedor esperado en `0000041770`; Servicios Generales
SLP tiene 128 en `0000041822`. Estos últimos datos confirman la identidad del
CECO, aunque no deciden por sí solos su núcleo.

### Estado resultante en producción

`HCARB_dim_nucleo` conserva 92 filas:

- **85** CECO identificados con asignación de núcleo confirmada y utilizables
  por el backend.
- **6** CECO identificados con asignación `pendiente_negocio`.
- **1** alias sin KOSTL: `Benalejo Sto 3 G`. El Excel da tres nombres para dos
  instalaciones y solo existen dos CECO adecuados; asignar dos veces uno de
  ellos duplicaría el join. Los códigos `0000041933` y `0000041937` ya están
  asociados una vez a Bernalejos.
- **0** CECO duplicados y **0** CECO asignados a más de un núcleo.

Las seis asignaciones que negocio/Methagas debe decidir son:

| CECO | Nombre SAP | Núcleo propuesto | Motivo pendiente |
|---|---|---|---|
| `0000041856` | Cerd. Pato Sitio 2 | Patos | El Excel pide definir ubicación y si pertenece a cerdos o aves |
| `0000041915` | Cerd. Pato Sitio 3-2 | Patos | Mismo caso anterior |
| `0000041700` | Administración Granjas Aves | Por confirmar | El Excel no determina el núcleo |
| `0000041832` | Aviario 3 Esperanza | Por confirmar | El Excel no determina el núcleo |
| `0000041843` | Núcleo Aviario Posturas Fienhage | Por confirmar | CECO identificado; falta núcleo |
| `0000041822` | Servicios Generales San Luis | Por confirmar | CECO identificado; falta núcleo |

Aunque la versión se usa ya como primera asociación operativa, conviene que
negocio revise primero Agua Fría, Labor, Santo Domingo, Cuijal,
Olivo/Olivares y Bernalejo: son los cruces donde intervino algo más que una
coincidencia literal. Una corrección futura puede hacerse por CECO sin cambiar
el modelo ni el código.

El backup `HCARB_dim_nucleo_bak_20260909` existe en BigQuery y contiene 92
filas. Debe comprobarse su instante concreto antes de usarlo como restauración,
porque se creó durante esta misma secuencia de trabajo.

No se modificó ninguna consulta materializada `HCARB_gold_*`: el catálogo es
una tabla independiente y el cambio consumidor está en
`dashboard_engine.py`/`aprobacion_engine.py`. Las copias de
`HCARB_gold_clasificacion.sql`, `HCARB_gold_validacion_sap.sql` y
`HCARB_stg_vendors.sql` de `ConsultasBigQuery/` y `Airflow/` siguen idénticas.

## 4. Dónde mirar según lo que necesites

- **Por qué el cruce nunca es exacto (SAP/MSEG/CECO/sitio), a fondo** →
  [`naturaleza-de-los-datos.md`](./naturaleza-de-los-datos.md)
- **Qué hace cada query, cifras verificadas contra BigQuery real, historial de
  bugs de la rama `Fer`** → [`ConsultasBigQuery/README.md`](../../ConsultasBigQuery/README.md)
- **Diagrama de tablas y de dónde sale cada dato** →
  [`ConsultasBigQuery/linaje-tablas.mmd`](../../ConsultasBigQuery/linaje-tablas.mmd)
- **Detalle commit a commit de cómo se construyó (incluida la sección 11,
  núcleos, completa)** → `git show 87c2488^:HALLAZGOS-FER.md` (ya no está en
  el árbol de trabajo)
- **Copy de producto que ve el usuario final sobre conciliación y CECO**
  (cifras desactualizadas, ver arriba) →
  `apps/frontend/app/(authenticated)/manual/page.tsx`
