# Fase 1 — Hallazgos de la investigación (matching CFDI ↔ SAP)

Registro de hallazgos de la Fase 1, organizado por tema (no por orden
cronológico de investigación). Decisiones finales, compactas, en
[`resumen.md`](./resumen.md); mapa de tablas y cruces en
[`Esquema.md`](./Esquema.md). Todas las queries citadas viven en
[`queries/`](./queries) con nombre numerado y descriptivo.

## 1. Frente a la Primera Iteración: qué cambió

| | `Primera-iteracion/` (punto de partida) | Fase 1 |
| --- | --- | --- |
| Filtro de "hidrocarburos" | `external_material_group LIKE '151115%' OR ERFME IN ('L','M3')` | Solo clave SAT: `151115xx` + `83101600`/`83101601` (GNC servicio) |
| Universo conciliado | 494 registros, ~$13.84M | El filtro anterior estaba contaminado (~95% del valor era diésel, insecticida, detergente, alimento animal — no gas). Universo real: 35 documentos MSEG (un proveedor) y 1,088 facturas / ~$24.9M en 17 proveedores del lado CFDI (11 tras acotar a Proteína Animal). |
| Bloque de 128 registros ($6.47M) que no cuadraba | Hipótesis: 1 CFDI cubre varias recepciones SAP (1:N) | Descartada con evidencia (proporción de importes inestable, 0.003x-80x). Causa real: la cantidad no coincide (el precio unitario sí, casi siempre exacto); algunos casos son errores de captura decimal en SAP ya corregidos por una reversión. |
| Tamaño del problema de matching | Implícito: la mayoría de facturas debería conciliar contra MSEG | Solo el 1.93% de las facturas reales tiene documento MSEG — el problema no es que el matching falle, es que casi nunca hay nada contra qué conciliar. |
| CECO, dirección de consumo, estatus de pago | No explorado | Los tres resueltos técnicamente (secciones 6 y 9). |
| Alcance (diésel/gasolina, GNC-servicio, razón social) | No se planteaba | Diésel/gasolina fuera, GNC-servicio dentro, alcance = Proteína Animal. |

En una frase: la Primera Iteración medía algo que no era hidrocarburos y
diagnosticaba como falla de matching algo que resultó ser, en su mayoría,
la ausencia total del documento contra el que conciliar.

## 2. El filtro original estaba contaminado

`Primera-iteracion/hidrocarburos.sql` marca un documento MSEG como "de
hidrocarburos" si **al menos una línea** cumple `external_material_group
LIKE '151115%'` **o** `ERFME IN ('L','M3')` (unidad de medida litros/m³).
Ese `OR` es demasiado permisivo: de los 4,479 "documentos de hidrocarburos"
que produce ese filtro (~$957M), **solo 35 documentos (57 líneas, ~$4.56M)
tienen de verdad la clave SAT de hidrocarburo (`151115xx`)**. El resto entró
solo por la unidad de medida, y es otra cosa (ver
[`queries/15`](./queries/15_diagnostico_filtro_erfme.sql)-[`17`](./queries/17_nombres_grupos_material.sql)):

| Grupo material | Qué es en realidad |
| --- | --- |
| `15101505/14/15` | Diésel y gasolina PEMEX (SAT 1510xxxx, no 151115xx) |
| `10191500` | Insecticida |
| `12161902` | Detergente en polvo |
| `12163800` | Producto de limpieza CIP |
| `15121501/08` | Aceite de motor |
| `51102600` | Premix para alimento animal |
| `01010101` | Cajón genérico (25,250 materiales distintos) |
| `NULL` | Compras sin ficha de material (ver sección 8) |

Esto explica por qué la primera prueba de la hipótesis 1:N (agregando por
RFC/mes) dio sumas absurdas: se estaba sumando diésel, insecticida y premix
de alimento animal junto con el gas real.

## 3. El universo real de gas

Corrigiendo el filtro a solo `151115xx` ([`queries/18`](./queries/18_matching_solo_clave_sat.sql)):
**35 documentos MSEG**, prácticamente todos de un único proveedor,
Distribuidora de Gas Noel (RFC `DGN811026BU6`).

Pero mirando del lado CFDI sin restringir a lo que tiene MSEG
([`queries/42`](./queries/42_los_17_proveedores_gas.sql)): **17 proveedores
reales de gas**, 1,088 facturas, ~$24.9M en 2026 (más si se cuenta desde
mediados de 2025). El universo se acota más adelante a 11 proveedores al
decidir el alcance por razón social (sección 12).

## 4. Por qué existía el filtro amplio: gas facturado como servicio (GNC)

Buscando por qué alguien había necesitado el `OR ERFME`
([`queries/26`](./queries/26_buscar_gas_en_cfdis_por_nombre.sql)-[`28`](./queries/28_cuantificar_gnc_servicios.sql)):
hay proveedores de **Gas Natural Comprimido (GNC)** que facturan el consumo
como **servicio** de red (compresión/transporte/descompresión), con clave
SAT `83101600`/`83101601`, no `151115xx` — Neomexicana de GNC, Natgas
Querétaro y Energas de México. Ejemplo real de descripción (Neomexicana):
*"METROS CÚBICOS CONSUMIDOS DE GAS NATURAL... en el municipio de
Zapotlanejo, Estado de Jalisco..."* — consumo real de gas, facturado como
servicio de red.

También aparece ruido bajo otras claves que no es consumo de gas y no debe
mezclarse: `72102900` (obra civil — instalación de tubería, capex, no
consumo recurrente), `73152100`/`26101766` (mantenimiento de equipo — carga
de refrigerante, reguladores de presión).

## 5. El hallazgo central: la vía servicio es la norma, no la excepción

De las **1,088 facturas de gas reales** en 2026 (universo sin acotar
todavía por razón social — ver sección 12), **solo 21 (1.93%) tienen un
documento MSEG que conciliar — y las 21 son del mismo proveedor**
([`queries/55`](./queries/55_cobertura_real_mseg.sql)). Ni ese proveedor se
salva del todo: de sus 727 facturas, solo 21 (2.9%) tienen recepción SAP
formal.

**No es un problema de datos incompletos.** `proan_MSEG_HIDROCARBUROS_20260714`
resultó ser un extracto ya filtrado por alguien más, no la tabla cruda. Se
localizó el MSEG real (`proan_MSEG_<fecha>`, decenas de tablas — cargas
trimestrales en 2023-2024 y luego deltas diarios) y, con una consulta
comodín de BigQuery (`proan_MSEG_2026*` + `_TABLE_SUFFIX`), se barrió todo
2026 buscando los materiales reales de gas contra todos los proveedores: **no
aparece ningún proveedor adicional** ([`queries/43`](./queries/43_buscar_mseg_completo.sql)-[`52`](./queries/52_wildcard_gas_todos_proveedores.sql)).
El patrón se sostiene con la fuente más completa disponible.

> **Corrección (jul-2026):** el barrido original ([`queries/52`](./queries/52_wildcard_gas_todos_proveedores.sql))
> usaba un único `MATNR` hardcodeado (`000000110000009544`); el gas son en
> realidad **6 materiales** (subclaves `15111505`/`15111510`/`15111512` —
> [`queries/102`](./queries/102_inventario_materiales_gas.sql)), así que ese
> barrido cubría solo 1 de 6. Rehecho con los 6 materiales × todo 2026
> ([`queries/103`](./queries/103_cobertura_definitiva_6_materiales.sql)): sigue
> apareciendo **solo Gas Noel** — el hallazgo central aguanta con el conjunto
> completo. (Las tablas diarias crudas son deltas muy incompletas, así que el
> wildcard corrobora "no hay otros proveedores"; el conteo de peso —35 docs,
> 21 conciliados— sale del extracto pre-filtrado.)

**Verificado con el universo acotado a Proteína Animal (sección 12):** el
lado MSEG ya estaba 100% en la sociedad correcta desde el principio — las 4
plantas (`PAN1/PAN3/PANM/PANR`) tienen `BUKRS='PAN'`, que es exactamente
"Proteína Animal SA de CV" en `dm_company`
([`queries/90`](./queries/90_bukrs_de_werks_gas.sql)-[`91`](./queries/91_bukrs_confirmar_pan.sql)).
Recalculando el lado CFDI restringido a `ReceptorRfc='PAN921013AK7'`
([`queries/93`](./queries/93_cobertura_mseg_acotada_pan.sql)): **21 de
1,051 facturas (2.0%)** (snapshot jul-2026) — prácticamente igual al 1.93%
sin acotar. El hallazgo central no cambia al corregir el alcance.

**Lectura correcta:** lo que separa a un proveedor con MSEG de uno sin MSEG
no es el tipo de gas (LP vs. GNC) — es el **tamaño de la transacción**. Las
entregas grandes a granel (pipa completa a tanque estacionario) generan una
recepción SAP formal (MIGO); las ventas pequeñas (recarga de cilindro,
consumo medido) casi nunca la generan, sea cual sea el proveedor.
**Consecuencia:** el Módulo 2 debe diseñarse asumiendo que la vía sin MSEG
es el caso normal, no una excepción.

## 6. Calidad del matching CFDI↔MSEG (para el ~2% que sí tiene MSEG)

El matching no es un JOIN por clave real — es una heurística de texto:
`REPLACE(UPPER(TRIM(XBLNR_MKPF)),' ','') = REPLACE(UPPER(TRIM(CONCAT(Serie,Folio))),' ','')`
más RFC igual. Lo que se confirmó sobre cada señal
([`queries/38`](./queries/38_descomponer_mismatch_precio_cantidad.sql)):

- **Folio + RFC: fiable.** Sin colisiones detectadas.
- **Precio unitario (`DMBTR/ERFMG` vs. `ValorUnitario`): señal fuerte.**
  Coincide exacto en casi todos los matches confirmados.
- **Importe/Cantidad totales: señal débil, no bloqueante.** La cantidad
  puede no coincidir aunque el precio sí — no usar como criterio de exclusión.

**El "83% de discrepancias de importe" del análisis original tiene causa
real.** Al descomponer precio × cantidad, el problema nunca fue el precio —
es solo la cantidad. Varios de los casos más extremos resultaron ser pares
de reversión SAP (`BWART 101`+`102` del mismo folio) con errores de captura
decimal ya corregidos por el propio proceso SAP
([`queries/39`](./queries/39_confirmar_duplicados_folio.sql)): folio
`GCRE11039` tenía dos documentos con `DMBTR=18.24` (error, ×1000) y uno con
`18,229.58` (la corrección real); folio `GCRE12026`, mismo patrón ×10.
**Regla para Fase 2:** excluir siempre el `MBLNR` revertido; quedarse con
el de mayor número por folio (el estado final).

Tras esa limpieza quedan **19 folios** con cantidad discrepante pese a
precio exacto ([`queries/56`](./queries/56_cola_revision_manual_limpia.sql)).
**18 de los 19 son del mismo CECO — "Planta Corrugados Planchas"** —
recurrente cada 2-4 semanas de enero a julio 2026: un patrón operativo
concentrado en un solo punto de recepción, no ruido disperso. La cantidad
SAP siempre está en rango de pipa completa (1,200-2,900 L); la del CFDI no
guarda relación (a veces ~35 L, propio de un cilindro pequeño). **Pregunta
concreta para Compras/Recepción:** ¿por qué el folio tecleado en SAP para
esa planta nunca corresponde a la entrega real? (hipótesis de trabajo: la
factura llega después de la pipa y se anota el último folio a mano).

**Ampliación:** se buscaron candidatas concretas de "factura correcta" para
cada una de las 19 entregas — entre las facturas de Gas Noel que no están
ya reclamadas por ningún otro documento, cuál tiene fecha cercana (±15 días)
y cantidad consistente (±15%) con lo que SAP dice haber recibido
([`queries/100`](./queries/100_candidatos_correccion_d8.sql)). **13 de las
19 obtuvieron al menos una candidata plausible** — algunas muy fuertes (ej.
folio `GCRE9774`: candidata del **mismo día**, cantidad a 0.7% de diferencia;
folio `GCRE12026`: candidata del mismo día, a 3.2%). Las otras 6 (`GCRE10329`,
`GCRE11039`, `GCRE11167`, `GCRE11331`, `GCRE11917`, `GCRE12556`) no
encontraron ninguna candidata en esa ventana — o la factura correcta está
fuera del rango buscado, o no está en `cfdis`. **Esto convierte la pregunta
abierta en una lista concreta que Compras puede verificar rápido** (¿es
esta la factura real de esta entrega?), en vez de una investigación desde
cero.

## 7. El bloque "MATNR vacío" en MSEG: pedidos reales, con un misterio de escala

Al filtrar solo por clave SAT aparecen documentos MSEG con `MATNR` vacío y
sumas enormes bajo ciertos proveedores de GNC-servicio. Un aviso externo
señaló casos extremos (documentos únicos con decenas de millones en
reversos) que llevaron a investigar con `EBELN` (pedido de compra) visible
([`queries/77`](./queries/77_detalle_documentos_gcv_eme.sql)-[`84`](./queries/84_kostl_distintos_gcv_eme.sql)):

- **Natgas Querétaro:** un documento de **$8,378,543 exacto** — el mismo
  importe que su única factura CFDI real. Otro de **$994,752.27**, el mismo
  número que ya aparecía en `hallazgos_conciliacion_hidrocarburos.md`
  (Prueba 1, score 5) del análisis original. Ligado a un pedido real
  (`EBELN 4502193451`), con `MATNR` vacío porque es una posición de servicio
  sin ficha de material — **no es ruido**.
- **Energas de México:** 14+ `EBELN` distintos, cada uno repartido entre
  ~9-10 CECOs, importes de $3M a $49M, la mayoría **sin reversar** —
  actividad de compra real y grande.
- **Gas Comercial de Villa Ahumada:** mezcla — un `EBELN` extremo se
  revierte por completo el mismo día ($63.6M); decenas de otros
  (~$340-355K cada uno) quedan en pie, sin reversar.

**Actualización — se investigó más con `EKBE` (histórico de posiciones de
pedido, `VGABE`) buscando por los `EBELN` ya conocidos**
([`queries/95`](./queries/95_ekbe_por_ebeln_conocido.sql)-[`99`](./queries/99_cobertura_ekbe_2026.sql)):

- **Natgas Querétaro (`4502193451`): completamente explicado.** Hay un
  `VGABE=2` (factura/Invoice Receipt) el mismo día, mismo importe exacto
  ($8,378,543) que la recepción y que la factura CFDI real. Sin misterio.
- **Los casos revertidos el mismo día (GCV $63.6M, Energas $49.1M): sin
  ningún Invoice Receipt asociado.** Consistente con que fueran errores de
  captura corregidos por reversión total — nunca llegaron a facturarse
  porque nunca debieron postearse así.
- **Otros pedidos de Energas que NO se revirtieron (`4502193877`,
  `4502228839`) sí tienen Invoice Receipt real, línea por línea, mismo
  importe** — es decir, una parte de esos ~$120M "misteriosos" **sí es
  gasto real y facturado dentro de SAP**, no ruido.
- **Pero no se pudo reconciliar el total completo:** `EKBE` está fragmentado
  igual que MSEG (201 tablas diarias en 2026) y no todos los `EBELN`
  vistos en MSEG aparecen en el barrido de `EKBE` — cobertura parcial, no
  un problema de formato. Reconciliar el 100% del gasto de Energas contra
  `EKBE` requeriría más arqueología de datos con retornos decrecientes.

**Conclusión revisada:** no es un misterio uniforme — depende del caso.
Los revertidos son claramente errores sin facturar; al menos algunos de los
no revertidos sí son gasto real y facturado (dentro de SAP, vía `EKBE`),
aunque **sigue sin cuadrar contra el total de CFDI real de estos
proveedores** ($8.38M para Energas) — puede ser que la factura CFDI llegue
consolidada/con retraso respecto al Invoice Receipt SAP, o que `cfdis` no
tenga el 100% del historial de facturas de estos proveedores. **No se
resuelve con más SQL** — hace falta alguien que conozca cómo se concilian
estos pedidos de servicio contra la facturación real.

Se verificó además que la cuenta contable que concentra buena parte de
estos importes (`0005010611`) aparece en los 11 proveedores de gas **y
también en Chubb Fianzas Monterrey** (una aseguradora) — confirma que es
una cuenta genérica del sistema, no algo propio de "ser proveedor de gas".

**Esto no cambia el universo limpio de matching** (`151115xx` sigue siendo
la base correcta), pero sí corrige una afirmación anterior: no es cierto
que los 3 proveedores de GNC-servicio "no tengan ningún documento MSEG" —
al menos Natgas Querétaro y Energas de México sí tienen un rastro `EBELN`
real. El problema es que `cfdis` no tiene columna `EBELN`, así que
reconciliar seguiría siendo por RFC+importe+fecha, no por clave directa.

## 8. Tres resoluciones técnicas: CECO, Dirección de Consumo, Estatus de pago

**CECO (nombre):** JOIN con `proan_CSKT_20260714` por `KOSTL`, filtrando
`DATBI='99991231'` (vigente — hay CECOs con varias filas por cambio de
nombre en el tiempo), mostrando `LTEXT` (más completo que `KTEXT`/`MCTXT`,
que vienen truncados) ([`queries/34`](./queries/34_cskt_join_test.sql)).

**Dirección de Consumo:** `ABLAD` (candidato natural, "punto de descarga"
en MSEG) viene **vacío al 100%** — descartado
([`queries/08`](./queries/08_calidad_ablad.sql)). Búsqueda exhaustiva por
columna (no solo por nombre de tabla) de `DIRECCION`/`DOMICILIO`/`CALLE`/
`MUNICIPIO`/`COLONIA` en todo `D20_DIMENSION`: no existe ningún maestro de
dirección postal de planta. La mejor señal disponible es el nombre de sede
vía `WERKS` → `dm_centros.descripcion_centro`.

> **CORREGIDO (Fase-1-bis, §26.1):** la dirección postal de planta **sí existe** en
> `D00_SANDBOX.proan_T001W_*` (`STRAS`/`ORT01`/`REGIO` por `WERKS`). La búsqueda original
> falló porque solo miró `D20_DIMENSION`, no `D00_SANDBOX` ni el nombre de tabla `T001W`.
> Ya se expone como `direccion_sitio`.

**Estatus de pago (Módulo 4):** `bsik_real_time` (abiertas) / `bsak_real_time`
(compensadas) filtrado por `LIFNR`, conciliando contra el **`Total`** del
CFDI (con IVA) — no el `Importe` de línea (que es el correcto para MSEG).
Validado con un cruce exacto real: documento `5100001966` (compensado,
pagado 2026-07-17) con `DMBTR=6,460.77` coincide exacto con el `Total` de
una factura ya conocida ([`queries/35`](./queries/35_bsik_bsak_vendor_real.sql)-[`36`](./queries/36_bsik_bsak_detalle.sql)).

## 9. Formato de `MATNR`/`material_number`

`dm_material` tiene dos rangos numéricos conviviendo — uno pequeño
(~1-893,075, ahí caen materiales como huevo o fosfato) y uno grande
(~11,000-130,000 millones, ahí cae el material de gas) — más ~10,691
`material_number` alfanuméricos (`E9095`, `CE2034`...) que son productos
terminados (jamón, tocino, huevo en polvo), irrelevantes para materiales de
compra. Probado contra un día real completo de MSEG
([`queries/60`](./queries/60_tasa_match_global_matnr.sql)): **el JOIN cruza
al 100%** en ambos rangos (413/413 del rango pequeño, 14/14 del grande) —
no hay hueco de cobertura.

Nota menor: `dm_vendors` puede tener **más de un `id_proveedor` para el
mismo RFC** (vendedor dado de alta más de una vez en SAP) — usar `IN`/`JOIN`
en vez de subconsulta escalar al cruzar por RFC.

## 10. Diésel/gasolina: evidencia para excluirlo

**Primera comparación (sin acotar por razón social):** `ClaveProdServ
1510xxxx` tiene 302 proveedores distintos en 2026 frente a 17 de gas
([`queries/41`](./queries/41_patron_diesel_gasolina.sql)), con escala
$216-313M vs. ~$25-40M. **Esa comparación mezclaba gasto de otras razones
sociales del grupo**, no solo Proteína Animal.

**Recalculado restringido a `ReceptorRfc='PAN921013AK7'`**
([`queries/92`](./queries/92_diesel_acotado_pan.sql)):

| Categoría | Facturas | Proveedores distintos | Importe |
| --- | --- | --- | --- |
| Gas | 1,051 | 11 | $40,567,803 |
| Diésel/Gasolina | 6,629 | **193** | $54,056,466 |

_(Snapshot 22-jul-2026, `COUNT(DISTINCT UUID)`.)_

Acotado a Proteína Animal, diésel/gasolina **ya no es 10-20x más grande en
dinero — es solo ~1.3x** ($54.1M vs $40.6M). **La evidencia de escala en
importe era más débil de lo que se dijo.** Lo que sí se sostiene, y con
fuerza, es la **fragmentación de proveedores**: 193 distintos frente a 11 —
patrón de "compra fragmentada en gasolineras" (flotilla), no el de "pocos
proveedores recurrentes de gas a granel" que describe la Propuesta. Esa es
la base real de la recomendación de excluirlo (D2), no la diferencia de
importe. Tampoco está en el catálogo de 6 claves documentado en `Propuesta.md`.

## 11. Alcance geográfico: Proan consume gas en más sitios de los que parecía

La dirección fiscal registrada de los proveedores de gas
([`queries/65`](./queries/65_ubicacion_registrada_proveedores.sql)) cae en
**5 estados distintos**: Jalisco, San Luis Potosí, Coahuila, Chihuahua y
Querétaro. Las 4 plantas (`WERKS`) que se conocían eran todas de Jalisco.

> **Nota de alcance:** esta búsqueda se hizo con la lista de 11 proveedores
> de ese momento, que incluía Neomexicana y Gas Tule (ya fuera del alcance
> tras D11) y no incluía Gas de Ojuelos ni San Diego Gas de Matehuala (que
> sí entran en el alcance final de Proteína Animal). No cambia las
> coincidencias encontradas (Chihuahua, SLP), pero falta revisar la
> dirección de estos dos últimos — pendiente, junto con D10.

`dm_centros` tiene **492 filas en total**, no las 4 filtradas del universo
de gas conocido. Buscando por región en la tabla completa
([`queries/66`](./queries/66_todos_los_centros.sql)-[`68`](./queries/68_buscar_centros_por_region.sql)):
**10 granjas reproductoras y una quinta planta entera ("PAN Planta Villa
Ahumada", `PAN5`)** en Chihuahua (coincide con Gas Comercial de Villa
Ahumada), y un sitio en Cedral, SLP que coincide exacto con el pueblo de
Corpo Gas. Se confirmó que `PAN5` **no tiene ninguna actividad en MSEG en
todo 2026**, para ningún material — opera fuera del circuito que rastreamos.

`dm_centros` también tiene sitios con prefijo `MK##`/"Maka MPE" en 25+
ciudades — son de **Maka, empresa ya separada de Proan** (coexisten en el
mismo BigQuery por herencia histórica del proyecto), no aplican aquí.

**Querétaro (Natgas Querétaro) y Torreón/Coahuila (Energas de México)
quedan sin sitio físico identificado** — aparcado a petición de Pablo, se
retoma al final.

## 12. Quién es "Proan": un grupo de razones sociales, no una sola empresa

Las facturas de gas no van a una sola razón social — se reparten entre
**~19 RFC de un grupo agropecuario relacionado**
([`queries/72`](./queries/72_receptor_de_las_facturas_gas.sql)-[`73`](./queries/73_proveedor_x_receptor.sql)):
`PAN921013AK7` **Proteína Animal** es la mayor (de ahí el prefijo `PAN` de
las plantas — 1,051 facturas), más Alimentos Balanceados Proan, Ferma
Agropecuaria, Avibel de México, Procesadora de Aves de Tepa, Servicios y
Alimentos Proteínicos y varias más, incluidas 3 RFC de personas físicas
(familia propietaria — nombres omitidos por la regla de datos personales del
proyecto).

Verificado que Corpo Gas, Gas Comercial de Villa Ahumada, Hidrogas de
Chihuahua, Distribuidora Potosina de Gas, Energas de México y Natgas
Querétaro facturan todos a Proteína Animal (o a otra razón social del
grupo) — gasto real del grupo, sin mezcla con Maka. Neomexicana de GNC
factura a Procesadora de Aves de Tepa y Avibel de México, no a Proteína
Animal.

**Decisión de Pablo (D11): el alcance de este proyecto es solo Proteína
Animal.**

## 13. El universo final, con alcance = Proteína Animal

Restringiendo a `ReceptorRfc = 'PAN921013AK7'`
([`queries/74`](./queries/74_universo_solo_proteina_animal.sql)), el
universo baja de 17 a **11 proveedores** (snapshot 22-jul-2026, datos hasta
2026-07-20; `Facturas` = `UUID` distintos, `Filas` = líneas de gas — algunas
facturas traen 2 líneas de gas; `Importe` = suma del concepto de gas):

| Proveedor | Facturas | Filas | Importe gas | Rango |
| --- | ---: | ---: | ---: | --- |
| Distribuidora de Gas Noel | 566 | 574 | $7,373,976 | jun-25 → jul-26 |
| Corpo Gas | 256 | 268 | $1,349,625 | jun-25 → jun-26 |
| Hidrogas de Chihuahua | 99 | 101 | $2,825,474 | jun-25 → jul-26 |
| Gas Comercial de Villa Ahumada | 51 | 53 | $1,274,781 | jul-25 → jul-26 |
| Super Gas de los Altos | 23 | 23 | $882,830 | jul-25 → jul-26 |
| Energas de México | 19 | 19 | $8,381,784 | jul-25 → jul-26 |
| Distribuidora Potosina de Gas | 18 | 18 | $7,941,969 | ago-25 → jul-26 |
| Distribuidora de Gas San Juan | 11 | 11 | $1,118,289 | may-26 → jul-26 |
| Gas de Ojuelos | 4 | 4 | $42,829 | oct-25 → may-26 |
| Natgas Querétaro | 2 | 2 | $9,373,295 | ene-26 → feb-26 |
| San Diego Gas de Matehuala | 2 | 2 | $2,951 | feb-26 → jul-26 |
| **Total** | **1,051** | **1,075** | **$40,567,803** | |

Quedan fuera del alcance (facturaban a otras razones sociales del grupo):
**Neomexicana de GNC** y **Gas Tule**.

> **Nota:** la versión anterior de esta tabla usaba `COUNT(*)` (filas) como
> "Facturas" y traía Distribuidora Potosina mal (17 / $7.49M en vez de 18 /
> $7.94M). La columna `Facturas/mes` se retira: la señal de frecuencia para D9
> se describe en la sección 14 por nombre de proveedor y no depende del número
> exacto. Como `cfdis` es un feed que crece, fijar cualquier cifra al snapshot.

## 14. Viabilidad de un mapeo estático proveedor→CECO (D9)

Con Neomexicana fuera de alcance, no queda ningún proveedor con prueba
directa (texto o MSEG) de servir un solo sitio dentro de Proteína Animal.
Como aproximación se usó la frecuencia mensual de facturación (tabla de
arriba) como señal indirecta — un sitio único con recepción periódica de
pipa no debería generar muchas más facturas al mes que eso:

- **Alta frecuencia (>4/mes) → multi-sitio probable:** Distribuidora de Gas
  Noel, Corpo Gas, Hidrogas de Chihuahua, Gas Comercial de Villa Ahumada
  (esta última porque en Villa Ahumada hay 10 granjas + 1 planta).
- **Baja frecuencia (≤2/mes) → sitio único plausible, sin confirmar:**
  Super Gas de los Altos, Energas de México, Distribuidora Potosina de Gas,
  Natgas Querétaro, Gas de Ojuelos, San Diego Gas de Matehuala. Se revisó
  su `Descripcion` completa (no solo muestra) y ninguno tiene texto de
  ubicación ni documento MSEG.
- **Señal adicional — varianza de importe** ([`queries/101`](./queries/101_varianza_importe_baja_frecuencia.sql)):
  **Distribuidora Potosina de Gas tiene coeficiente de variación de solo
  0.01** (18 facturas, promedio $441,220, desviación $6,531 — apenas 1.5%
  de variación) — un patrón de consumo casi idéntico factura tras factura,
  consistente con un solo sitio con consumo estable. **Es la señal más
  fuerte encontrada para cualquier proveedor de baja frecuencia**, más
  sólida que la frecuencia sola. Los demás (Energas, Natgas Querétaro,
  Super Gas de los Altos) tienen coeficientes de variación altos (~1.0-1.13)
  — no aportan ni a favor ni en contra de forma concluyente (puede ser
  consumo estacional de un solo sitio, o varios sitios; no se puede
  distinguir con lo disponible). Gas de Ojuelos y San Diego Gas de Matehuala
  tienen muy pocas facturas (4 y 2) para sacar conclusión.

**Corrección importante:** se había afirmado que Distribuidora de Gas Noel
entregaba a "18+ CECOs distintos" (granjas y plantas), lo que parecía
confirmar que los proveedores de alta frecuencia son multi-sitio. Era un
bug de scoping ([`queries/85`](./queries/85_verificar_cecos_gas_noel.sql)):
la query original contaba el `KOSTL` de *todas* las líneas de los
documentos que contienen gas, no solo la línea de gas. Corregido: **el
único CECO real con material de gas de Gas Noel es `0000042060` ("Planta
Corrugados Planchas")** — 30 documentos, más 5 sin CECO asignado. Esto no
prueba que Gas Noel sea de un solo sitio en general (su actividad
*rastreable por MSEG* es solo el ~3% de sus facturas; el resto puede ir a
cualquier sitio, sin evidencia directa), pero sí **debilita** la regla
"alta frecuencia = multi-sitio": ya no hay ningún proveedor con prueba
directa de servir varios sitios.

**Conclusión:** el mapeo estático proveedor→CECO sigue sin poder darse por
viable ni por descartado con evidencia sólida para la mayoría de
proveedores — hace falta confirmación de Compras o de quien conozca la
relación comercial con cada uno. **Excepción: Distribuidora Potosina de Gas**
tiene una señal estadística fuerte a favor (importe casi idéntico en 18
facturas seguidas, sección anterior) — candidato razonable para probar un
mapeo estático primero, antes que los demás.

## 15. Verificaciones adicionales que salieron limpias

- **`MJAHR` (año fiscal):** no hay ningún `MBLNR` que se repita entre años
  distintos en `proan_MSEG_HIDROCARBUROS_20260714` (que además solo cubre
  `MJAHR=2026`) ([`queries/86`](./queries/86_verificar_mjahr.sql)-[`87`](./queries/87_rango_mjahr.sql))
  — descartado el riesgo de mezclar documentos de años distintos por
  reciclaje de número de documento.
- **Neomexicana, reconfirmado con toda su historia** (no solo 2026,
  [`queries/64`](./queries/64_neomexicana_historia_completa.sql)): todas
  las facturas con texto de ubicación extraíble dicen "Zapotlanejo", sin
  ninguna excepción.
- **El cálculo de CECO de la sección 6 (D8) estaba bien acotado desde el
  principio** — sí filtraba por material de gas en la línea, a diferencia
  del bug encontrado en la sección 14. El hallazgo de "Planta Corrugados
  Planchas" se mantiene válido tal cual.

## 16. Las facturas de gas son, en su mayoría, facturas mixtas

El extracto `cfdis` guarda casi siempre **una fila por `UUID`** (24 de 1,051
facturas de gas tienen 2 filas, pero — ver §19 — las 24 son **duplicados
exactos** del mismo concepto, no una segunda línea real; regla: deduplicar y
agregar por `UUID`, [`queries/104`](./queries/104_cfdis_una_fila_por_uuid.sql)).
Esa fila es el **concepto de gas**, no toda la factura. Comparando el `SubTotal` de
cabecera (todos los conceptos, sin IVA) contra la suma del `Importe` de las
líneas de gas ([`queries/105`](./queries/105_facturas_mixtas_conceptos_no_gas.sql)),
**el 73.7% de las facturas de gas llevan además conceptos no-gas en el mismo
CFDI** (775 de 1,051). Por valor el desajuste es enorme:

| Franja | Facturas | Σ concepto gas | Σ subtotal factura |
| --- | ---: | ---: | ---: |
| gas = 100% de la factura | 278 | $25.0M | $24.7M |
| gas 50–99% | 113 | $2.6M | $3.4M |
| gas 10–50% | 266 | $12.1M | $39.9M |
| **gas < 10% de la factura** | **394** | **$0.8M** | **$58.5M** |

El gasto real en gas es **~$40.6M** (suma de conceptos gas), pero esas
facturas suman **~$126.5M** de valor total. Los dos proveedores más grandes
son los más mixtos — **Gas Noel 77%**, **Corpo Gas 86%** de facturas mixtas;
en cambio **Distribuidora Potosina es 0% mixta** (gas puro), lo que corrobora
su señal de sitio único (§14).

**Consecuencias para Fase 2:**
- El dashboard de "gasto en gas" debe sumar el `Importe` de la **línea de
  gas**, nunca `Total`/`SubTotal` (los infla ~3×).
- El Módulo 3/4 aprueba y paga la **factura completa** (`bsik`/`bsak`
  concilian contra `Total`, IVA incluido). En 394 facturas el gas es <10% del
  documento: aprobar "una factura de gas" es aprobar gasto mayoritariamente
  no-gas por una lente de gas. **Decisión de negocio pendiente (D12):** ¿se
  aprueba la factura entera o solo se valida la línea de gas?
- `cfdis` no trae los conceptos no-gas como filas aparte, así que desde esta
  tabla no se puede saber qué son (transporte, renta de tanque, otro gas…);
  haría falta el XML de origen. Riesgo menor de completitud del Módulo 1: una
  factura cuyo único concepto guardado no fuese el de gas no se detectaría —
  no observado en el universo actual, pero a tener en cuenta.

## 17. Lo que `cfdis` y las tablas de pago NO traen (Módulos 3 y 4)

- **`cfdis` no tiene estatus ni cancelación SAT.** Sus columnas
  ([`queries/106`](./queries/106_cfdis_sin_estatus_cancelacion.sql)) no
  incluyen ningún `Estatus`/`Cancelado`/`FechaCancelacion`. El universo de gas
  es homogéneo (todo `TipoDeComprobante='I'` = ingreso, sin notas de crédito;
  todo `MXN`), lo cual es bueno — pero **no hay forma, desde esta tabla, de
  saber si un CFDI fue cancelado en el SAT.** Para una herramienta que aprueba
  y paga es un riesgo: hay que decidir en Fase 2 un chequeo externo del Estatus
  SAT (D13).
- **`bsik`/`bsak` no tienen `XBLNR`** (la referencia SAP que suele llevar el
  folio de la factura del proveedor). Los únicos campos de enlace son `ZUONR`
  (asignación), `BELNR` (doc contable) y `AUGBL` (doc de compensación)
  ([`queries/107`](./queries/107_bsik_bsak_sin_referencia_folio.sql)). Por
  tanto la conciliación de pago **solo puede ser por `LIFNR` + importe
  (`Total`) + fecha**, exactamente como concluyó la sección 8 — propensa a
  colisiones si dos facturas del mismo proveedor tienen el mismo total.
  **Pendiente:** probar si `ZUONR` trae el folio (subiría el Módulo 4 de
  match-por-importe a match-por-clave).

## 18. Calidad de datos del origen: duplicación (hallazgo de análisis paralelo)

Un análisis paralelo (corte 21-jul-2026, sobre la tabla prototipo
`ZZ_PRUEBAS.hidrocarburos_try` / `HIDROCARBUROS_20260715`, con el **filtro
amplio** `151115% OR ERFME` — el mismo que la Primera Iteración) reportó dos
problemas de calidad de datos **anteriores a cualquier lógica de
conciliación**. Ambos **verificados** contra nuestras tablas y **confirmados**:

1. **`dm_vendors` duplica filas por proveedor** ([`queries/108`](./queries/108_duplicacion_dm_vendors.sql)).
   Trae una fila por cada `correo_electronico` de contacto, no una por
   proveedor. **5 de los 11 proveedores de gas** (Energas de México, Natgas
   Querétaro, Gas Comercial de Villa Ahumada, San Diego Gas de Matehuala y
   Corpo Gas) tienen **2 filas con el mismo `id_proveedor`**, idénticas salvo
   el correo. Cualquier `JOIN` MSEG/`bsik`/`bsak` → `dm_vendors` por
   `id_proveedor` **duplica los importes** de esos proveedores.
2. **El extracto MSEG trae filas exactamente duplicadas** ([`queries/109`](./queries/109_duplicacion_mseg_extracto.sql)).
   En `proan_MSEG_HIDROCARBUROS_20260714`: **176,465 de 518,055 filas (34%)**
   son duplicados exactos por `(MBLNR, MJAHR, ZEILE)` — un lote del histórico
   cargado dos veces. Afecta también a los documentos de gas (592 líneas → 338
   distintas). Cualquier `SUM(DMBTR)`/`COUNT(*)` sin deduplicar infla ~1.5×.

**Efecto combinado:** un proveedor con ambos problemas termina contando cada
movimiento hasta 4×. Esto explica buena parte de la brecha que el análisis
paralelo vio en su prueba agregada (totales SAP 100-1000× lo facturado).

**Reconciliación con nuestra Fase 1 — nuestras conclusiones se sostienen:**
- **El universo (11 proveedores, 1,051 facturas, ~$40.6M) NO está inflado:** se
  calcula desde `cfdis` directo (por `EmisorRfc`/`Importe`), sin `JOIN` a
  `dm_vendors`.
- **La cobertura MSEG (~2%, 35 docs, 21 conciliados) NO cambia:** usa
  `COUNT(DISTINCT MBLNR)` / `DISTINCT UUID`, que colapsan los duplicados. Lo
  mismo el barrido definitivo ([`queries/103`](./queries/103_cobertura_definitiva_6_materiales.sql)).
- **Sí puede estar inflado un número lateral:** el "~$4.56M / 57 líneas" de §2
  (suma sobre líneas de gas del extracto sin deduplicar). No es load-bearing,
  pero conviene recalcularlo deduplicado si se cita.
- **Matiza §7 (los ~$120M "misteriosos" de servicio):** parte de esa escala es
  esta duplicación, no solo pedidos reales. La conclusión de §7 (mezcla de
  reversas, pedidos reales y algo sin reconciliar) no cambia, pero **antes de
  re-medir el tamaño del gasto de servicio hay que aplicar ambas
  deduplicaciones.**

**Coincidencias con lo que ya teníamos** (el análisis paralelo re-derivó el
punto de partida de la Primera Iteración): el bloque de 128 registros / $6.47M
(folio+RFC correctos, importe+cantidad no); el rechazo de la hipótesis 1:N
salvo ~6 casos puntuales (nuestro §6); los folios cercanos en numeración que
"pierden" el match al forzar 1:1. Aporte **nuevo**: las dos duplicaciones de
arriba y la normalización de prefijos de serie (ver abajo).

**Reglas para Fase 2 (obligatorias en el backend):**
- Deduplicar `dm_vendors` a **una fila por `id_proveedor`** (ignorar
  `correo_electronico`) antes de cualquier cruce.
- Deduplicar MSEG por **`(MBLNR, MJAHR, ZEILE)`** antes de cualquier `SUM`.
- Normalizar prefijos de serie inconsistentes entre SAP y CFDI (el análisis
  paralelo detectó `BCRE`/`BACRE` en Super Gas de los Altos, `SGA811211ED6`) —
  hoy irrelevante para el matching (solo Gas Noel tiene MSEG en nuestro
  alcance), pero a tener en cuenta en el manejo de folios del Módulo 1.

## 19. Puntos ciegos de nuestra propia Fase 1 (re-revisión jul-2026)

El hallazgo de duplicación del análisis paralelo dejó una lección de método:
**validamos los mecanismos a fondo por drill-down (ejemplos), pero medimos
poco la cobertura y la integridad por arriba (agregados).** Repasando con esa
lente aparecieron varios puntos ciegos. El más grave afecta al Módulo 4.

**19.1 — CRÍTICO: el estatus de pago (Módulo 4) está prácticamente sin
fuente.** En §8 validamos la técnica `bsik`/`bsak` con **un** cruce exacto
($6,460.77) y dimos D7 por "Resuelto". Nunca medimos la **cobertura**. Medida
ahora ([`queries/112`](./queries/112_cobertura_pago_bsik_bsak.sql)):
- Solo **2 de 1,051 facturas (0.2%)** casan con una fila de `bsik`/`bsak` por
  proveedor + `Total`.
- Solo **3 de los 11 proveedores de gas aparecen siquiera** en `bsik`/`bsak`,
  con **~$102K en total** frente a los **$40.6M** facturados. Los mayores
  (Energas, Natgas Querétaro, Distribuidora Potosina) tienen **0 filas**.

`bsik`/`bsak` **no es la fuente de estatus de pago** para ~99% del universo.
El único ejemplo que funcionó era una de las 9 filas de Gas Noel. **D7
"Resuelto" queda revocado** — el estatus de pago es un problema **abierto**
para Fase 2.

> **REABIERTO Y RESUELTO PARCIALMENTE (Fase-1-bis, §26.2):** esto medía
> `bsik_real_time`/`bsak_real_time` (7k filas, sin `XBLNR`). Los snapshots diarios
> `D00_SANDBOX.proan_BSAK_*` (439k filas, compensadas) / `proan_BSIK_*` (abiertas) **sí**
> traen `XBLNR`+`LIFNR`: casando por folio+proveedor aparecen **604 facturas (57%), 600
> pagadas**. El estatus de pago SÍ es recuperable; solo falta la escritura del pago a SAP.

**19.2 — El pago es diferido (PPD), no al contado.** El **99.7%** de las
facturas de gas son `MetodoPago = PPD` (pago en parcialidades/diferido); solo
3 son PUE ([`queries/111`](./queries/111_metodopago_y_tipos_comprobante.sql)).
En PPD el pago no ocurre al emitir la factura: se documenta después con un
**complemento de pago (REP, comprobante tipo `P`)**. Y esos complementos
**existen**: 243 comprobantes tipo `P` de estos proveedores hacia Proteína
Animal (más 9 tipo `E`, notas de crédito). **Nunca los miramos.** Son la vía
natural del estatus de pago — **pero** `cfdis` no trae la columna de documento
relacionado (`doctoRelacionado`), así que la liga factura↔pago no está en la
tabla; hay que reparsear el XML o encontrar otra fuente. **Es lo primero que
hay que investigar antes de diseñar el Módulo 4.**

**19.3 — `cfdis` también trae filas duplicadas.** Como MSEG y `dm_vendors`:
las 24 facturas de gas con 2 filas tienen la 2ª fila como **duplicado exacto**
del mismo concepto (no una 2ª línea) ([`queries/110`](./queries/110_duplicacion_cfdis.sql)).
El universo por `SUM(Importe)` sobre filas ($40.6M / 1,075 filas) está
levemente inflado; usar `COUNT(DISTINCT UUID)` y deduplicar por
`(UUID, ClaveProdServ, Cantidad, Importe, Descripcion)` (no hay columna de
línea). **La disciplina de deduplicación aplica a las TRES tablas.**

**19.4 — Hay retenciones (21% de las facturas).** `Total < SubTotal +
TotalImpuestosTrasladados` en 221 de 1,075 facturas — el proveedor retiene
ISR/IVA ([`queries/113`](./queries/113_retenciones_total_vs_subtotal.sql)).
`cfdis` no trae columna de retenciones (solo se infiere). El importe pagable
es `Total` (ya neto), pero refuerza que el match por importe es frágil.

**19.5 — El feed arranca ~jun-2025.** El universo va de jun-2025 a jul-2026
(~13-14 meses) porque `cfdis` empieza ahí, no porque el negocio empiece ahí:
el gasto de gas anterior simplemente no está cargado. "Total histórico" =
extensión del feed, no historia completa.

**Puntos ciegos que quedan por cerrar (necesitan más datos o al negocio):**
- **Fuga de alcance en ambos sentidos:** ¿hay gas facturado bajo claves SAT que
  excluimos, o nuestras 2 claves de servicio (`83101600/01`) no capturan todo
  el GNC-servicio? Revisado parcialmente (§4), conviene confirmarlo con negocio.
- **CECO del 98% sin MSEG:** no tiene ninguna fuente en los datos — es 100%
  captura manual de Compras (esto ya es D9, pero conviene tenerlo explícito
  como realidad de diseño del Módulo 2).
- **Por qué `bsik`/`bsak` está tan vacío** (¿filtro por sociedad? ¿extracto
  parcial?) — necesita a alguien de SAP/datos.
- **Completitud del MSEG crudo diario** (huecos de días) si Fase 2 lo usa como
  fuente en vez del extracto.

## 20. Capa de integración SAP en `D30_INTEGRATION` (descubrimiento tardío — corrige §4)

**La Fase 1 solo había explorado `D00_SANDBOX` y `D20_DIMENSION`.** Al enumerar
todos los datasets del proyecto aparece una **capa de integración SAP entera**
que nadie había mirado, sobre todo en **`D30_INTEGRATION`**
([`queries/114`](./queries/114_capa_integracion_sap_d30.sql)). Esto **corrige
una afirmación falsa de §4** ("EKKO/EKPO no existen en ningún dataset") y
reabre vías de conciliación que dábamos por muertas.

**Tablas nuevas relevantes (todas en `D30_INTEGRATION`):**

| Tabla | Qué es | Cobertura para gas |
| --- | --- | --- |
| `bkpf_account_document_header` | Cabecera de documento contable SAP (FI); `XBLNR_reference_document_number` = folio de la factura del proveedor | **918/1.051 folios (87%)**; **847 como `RE`** (registro de factura de proveedor), 908 como `WE` (recepción) |
| `sap_purchasing_orders` | Pedidos de compra (EKKO/EKPO): `EBELN_OrdenCompra` + `LIFNR_Proveedor` | **Los 11 proveedores**, 10.593 pedidos, 57.817 líneas |
| `sap_mseg` | MSEG integrado, con `LFBNR_NumeroFacturaProveedor` + `EBELN` + `LIFNR` | por explotar (mejor enlace recepción↔factura↔pedido) |
| `sap_open_cleared_items`, `sap_bsik_open_items` | Cuentas por pagar (versión completa; `LIFNR` + `XBLNR`) | casi nula (1-2 folios) |
| `sap_ekbe` | Histórico de posiciones de pedido (`EBELN` + `XBLNR`) | por explotar |
| `int_ACDOCA_historico` | Libro diario universal S/4HANA (`EBELN` + `LIFNR`) | **0** (scope distinto, parece solo Maka) |
| `facturas_pago` | Estatus de pago (`pagado_lg`, `fecha_pago`, `documento_compensacion`) | **0 para gas** — es tabla de **clientes** (cuentas por cobrar), no proveedores |

**Qué cambia (positivo):**
- **La factura de gas SÍ está registrada en SAP FI.** El 87% de los folios está
  en `BKPF`, el 81% como documento `RE` (registro de factura de proveedor)
  ([`queries/115`](./queries/115_cobertura_folio_bkpf.sql)). El "98% sin MSEG"
  era "98% sin recepción de mercancía **con material de gas**" — no "sin rastro
  en SAP". Los Módulos 1/2/3 pueden apoyarse en datos reales, no solo en
  workflow humano.
- **Los pedidos de compra existen para los 11 proveedores**
  ([`queries/116`](./queries/116_pedidos_compra_gas.sql)) → la vía "validar
  contra pedido/contrato" del Módulo 2 tiene respaldo de datos.

**Qué NO cambia (el hueco que queda):**
- **El estatus de pago sigue sin fuente fiable para gas**
  ([`queries/117`](./queries/117_pago_sigue_sin_fuente.sql)): las cuentas por
  pagar (open/cleared items) siguen casi vacías (1-2 folios), `ACDOCA` da 0, y
  `facturas_pago` es de clientes. Sabemos que la factura entró en SAP (`RE`),
  pero **no si se pagó**. Es ahora el único hueco real del Módulo 4 — más
  estrecho que antes.

  **Hilo del pago, tirado hasta el fondo** ([`queries/118`](./queries/118_hilo_pago_conclusion.sql)):
  la tabla de partidas de proveedor `sap_bsik_open_items` (cuentas por pagar)
  solo tiene **9 filas de gas, de 3 de los 11 proveedores, todas abiertas**; de
  los **850 documentos `RE`** de gas en BKPF **solo 1** aparece en ella por
  `BELNR`; y **no existe ninguna tabla de partidas de proveedor compensadas
  (BSAK)** en D30 (las "cleared" disponibles son de clientes: `KUNNR`/`VBELN`).
  **Conclusión definitiva:** el *registro* de la factura (`RE`) es sólido y
  usable (Módulos 1/2/3), pero el *estatus de pago* (Módulo 4) **no es
  recuperable** de las tablas actuales — faltaría una fuente de pagos/clearing
  de proveedor (BSAK) que hoy no está en el almacén. Es una pregunta para
  SAP/Compras, no algo que resuelva más SQL.

  > **CORREGIDO (Fase-1-bis, §26.2):** la tabla de partidas compensadas de proveedor SÍ
  > existe — `D00_SANDBOX.proan_BSAK_20260708` (439k filas, con `XBLNR`+`LIFNR`), más
  > `proan_BSIK_*` para las abiertas. Se buscó solo en `D30_INTEGRATION`; estaba en
  > `D00_SANDBOX`. Da estatus de pago para 604 facturas de gas (600 pagadas).

**Caveats (verificar en Fase 2 antes de construir encima):**
- El match `BKPF` es **por folio solo** (sin RFC) → posible colisión; hay que
  cruzarlo con RFC+importe para blindarlo (los folios distintivos `GCRE#####`
  y los tipos `RE`/`WE` lo hacen muy probable real, pero no está confirmado).
- No se sabe aún si estas tablas de `D30_INTEGRATION` se **mantienen al día** o
  son cargas puntuales — crítico para producción.
- Los 10.593 pedidos son de todo el negocio de esos proveedores, **no solo
  gas** — hay que acotarlos.

**Otros datasets del proyecto** (no explorados a fondo, en su mayoría fuera de
alcance): `D40_EDW` (billing de **ventas/clientes**), `D70_MODELS_PRED_FACT`
(modelos de predicción de cobro de **facturas de cliente**), `D80_ALERTS`
(alertas de stock), `D60_REPORTING` (reporting de Maka), `D61_GA4` (analítica
web), `ZZ_PRUEBAS` (experimentos, incluye la `hidrocarburos_try` del análisis
paralelo y un PoC `sat_facturas_pagos` que distingue Cliente/Proveedor pero no
incluye gas).

## 21. Spike de Módulo 2 sobre la capa SAP (resultado)

Verificación acotada de las tres dudas que quedaban del Módulo 2
([`queries/119`](./queries/119_spike_modulo2_sitio_y_blindaje.sql)):

- **El match `cfdis`↔`BKPF` está blindado.** De las 847 facturas con documento
  `RE`, **845 (99.8%) lo tienen a ≤7 días** de la fecha del CFDI (solo 2 a más
  de 30). El match por folio (87%) **no es colisión** — es la misma factura.
  La validación "¿SAP registró esta factura?" del Módulo 2 es sólida.
- **El sitio de consumo (`WERKS`) es derivable para ~52%** (→ **~58%** aplicando el fix de folio, §23)**.** Vía folio →
  `sap_ekbe.XBLNR` → `EBELN` → `sap_purchasing_orders.WERKS_Centro` → nombre en
  `dm_centros`. De 547 folios ligados, **544 son "PAN Planta San Juan 1"** (el
  resto, 1-2 en otras plantas de Jalisco). Mejora enorme frente al 2% del MSEG
  para saber *a qué sitio* fue el gas. **Pero** sigue siendo el nombre de la
  planta, no una dirección postal/geográfica (que no existe), y solo cubre el
  52% que pasa por `EKBE`.
- **El CECO (`KOSTL`) NO se puede derivar del pedido.** `sap_purchasing_orders`
  no trae `KOSTL` (la imputación vive en `EKKN`, que no está en el almacén). Las
  tablas que sí tienen `KOSTL` están vacías para gas (`sap_bsik_open_items`) o
  son de ventas (`VBAK`/`VBAP`). **El CECO sigue siendo captura manual (D9).**

**Neto para el Módulo 2:** de sus tres frentes, el spike **cierra dos**
(validación de registro en SAP: blindada; sitio de consumo: derivable al ~52%,
concentrado en San Juan 1) y **confirma el tercero como límite** (CECO manual;
dirección geográfica inexistente).

**D10 (sitios Querétaro/Torreón), retomado con la misma vía:** los pedidos de
compra de **Energas de México** (74 pedidos, dic-2023→jun-2026) y **Natgas
Querétaro** (1 pedido) apuntan **todos a `WERKS` = "PAN Planta San Juan 1"**
(Jalisco). Es decir: aunque el proveedor esté registrado fiscalmente en
Querétaro/Torreón, el consumo se ancla a San Juan 1 — **no aparecen sitios de
consumo separados sin identificar**, lo que disuelve la preocupación de D10.
Matiz: el `WERKS` de un pedido de servicio puede ser la planta de procura/
imputación, no el punto físico exacto; la señal es fuerte pero conviene
confirmarla con Compras. Query: misma que §21 (folio/LIFNR → pedido → `WERKS`).

## 22. Por qué el 13% no casa en BKPF: el folio↔`XBLNR` es por número, no por serie

El match de cobertura en `bkpf` (§20-21) dejaba un **13% (133 de 1.051 folios)**
sin match exacto `Serie+Folio` = `XBLNR`. Investigado
([`queries/120`](./queries/120_sin_match_bkpf_por_proveedor.sql)-[`124`](./queries/124_sin_match_bkpf_ausencia_real.sql)):

**Causa raíz (formato — la misma lección que el MATNR en §9 / queries 46-51):**
`BKPF.XBLNR` **no contiene la `Serie+Folio` del CFDI** — contiene el **número**
de folio con un prefijo/sufijo tecleado a mano y **variable**. Ejemplos reales:
`GCRE12179`→`12179`, `GCRE11569`→`FL11569`, `E0000472360`→`BNSF472360`,
`V091473`→`91473`, `OJA88489`→`88489FA`, `CFDI6144183`→`F 6144183`. **El número
es la clave estable; la serie no.** Los sin-match se concentran en CORPO GAS
(69 de 133).

**Descomposición de los 133 sin-match:**

| Causa | Folios | % | Confianza |
| --- | ---: | ---: | --- |
| Timing (factura reciente, SAP aún no la postea) | 36 | ~27% | alta (en los últimos 30d no casa el 51% vs 13% global) |
| Formato (nº en BKPF con otro prefijo, a ≤45d) | 13 | ~10% | alta (es un *floor*) |
| Ausencia real dura (nº **nunca** en BKPF, antigua) | 18 | ~14% | alta |
| Residual no confirmable (47 folios cortos + 54 con nº solo a fecha lejana ≈ colisión) | 66 | ~50% | baja, lean ausencia |

Nota: el residual no se cierra al 100% porque `bkpf` no tiene columna de
proveedor, así que el match por número de folios cortos (Corpo serie "EC")
es propenso a colisión.

**Consecuencias para el Módulo 2:**
- **Cambiar el matcher CFDI↔BKPF a `parte numérica del folio + proximidad de
  fecha` (±7-15d; el posteo real ocurre a ≤7d), no `Serie+Folio` exacto** —
  recupera el formato y sube la cobertura ~1-2 pts.
- **`sin_match_sap` NO debe ser bloqueo duro de aprobación:** ~37%
  (formato+timing) es benigno (la factura está o estará en SAP). Tras el matcher
  numérico, un sin-match en factura no reciente = **flag de revisión suave**, no
  bloqueo — hay facturas pequeñas que legítimamente nunca se postean en FI
  (ausencia real ≥18 confirmadas, p. ej. CORPO GAS `E0000498490/498489/491935`
  de dic-2025).

## 23. Fix de folio aplicado a `sap_ekbe`: cobertura de sitio 52%→58% (techo estructural)

El mismo fix de §22 se aplicó al cruce de sitio de consumo (query 119: folio →
`sap_ekbe.XBLNR` → `EBELN` → `sap_purchasing_orders.WERKS`). `sap_ekbe.XBLNR`
guarda el número de folio con prefijo/sufijo variable, igual que BKPF. Añadiendo
el matcher numérico+fecha (nº ≥5 díg., `BUDAT` ±45d) sobre los no casados por
`Serie+Folio` exacto ([`queries/125`](./queries/125_ekbe_fix_folio_cobertura_werks.sql)):
se recuperan **66 folios**, y los 66 completan la cadena hasta `WERKS`. **La
cobertura de sitio sube de 547 (52%) a 613 (58%).**

**Pero el techo restante es estructural, no de formato** ([`queries/126`](./queries/126_ekbe_residual_breakdown.sql)).
De los 438 folios que siguen sin sitio: **43** timing (recientes), **193** folio
corto (<5 díg., no testeable por colisión), **106** con el número en EKBE pero
sin sitio limpio (colisión a fecha lejana o `EBELN` sin `WERKS`), y **96 sin
ningún rastro en EKBE**. Es decir: a diferencia de BKPF (§22, donde el formato
era el fallo dominante y el registro llega al 87%), **la mayoría de las facturas
sin sitio simplemente no tienen rastro de recepción-pedido en EKBE** (compras
pequeñas / de servicio sin pedido). El fix de formato ayuda (+6 pts) pero la
cobertura de sitio vía EKBE→pedido **está limitada por qué facturas pasan por un
pedido con recepción**, no por el formato del folio. Techo práctico ~58% con
estos datos.

## 24. Catálogo completo de `dm_vendors` y confirmación de que el dedup es seguro

Verificación pedida desde el diseño de Fase 2 antes de escribir
`HCARB_stg_vendors.sql`: el catálogo de columnas de `dm_vendors` solo se
había validado parcialmente (`id_proveedor`/`rfc`/dirección/
`correo_electronico`).

- **12 columnas, todas `STRING`** ([`queries/127`](./queries/127_esquema_columnas_dm_vendors.sql)):
  `correo_electronico`, `id_direccion`, `rfc`, `id_proveedor`, `pais`,
  `razon_social`, `municipio`, `colonia`, `codigo_postal`, `estado_cod`,
  `nombre_comercial`, `direccion_completa`. El nombre del proveedor vive en
  `razon_social` (hay también `nombre_comercial`, distinto — no se investigó
  cuál usar, ambos existen).
- **El dedup por `id_proveedor` (descartando `correo_electronico`, §18) es
  seguro** ([`queries/128`](./queries/128_dm_vendors_dedup_sin_variantes.sql)):
  sobre las 25.110 filas de la tabla completa, **ninguna fila duplicada
  difiere en ninguna otra columna** — el `correo_electronico` es la única
  variación entre filas repetidas del mismo `id_proveedor`. Confirma que
  `SELECT * EXCEPT(correo_electronico)` + quedarse con una fila por
  `id_proveedor` no pierde información real.

## 25. Sin riesgo de fan-out rfc→id_proveedor en el universo de gas

Esquema.md ya avisaba (dedup de `dm_vendors`, §18) que un mismo `rfc` puede
tener más de un `id_proveedor` — riesgo real para `HCARB_gold_clasificacion.sql`
(Fase 2), que hace `LEFT JOIN` de `cfdis` contra `HCARB_STG_VENDORS` por `rfc`:
si algún proveedor de gas tuviera ese problema, el join haría fan-out y
duplicaría `importe_gas`. Verificado
([`queries/129`](./queries/129_verificar_fanout_rfc_id_proveedor_gas.sql)):
**los 11 `rfc` de proveedores de gas mapean cada uno a exactamente 1
`id_proveedor`** — el caso de `rfc` con varios `id_proveedor` existe en la
tabla completa (25.110 filas) pero no afecta a ninguno de los 11 de gas. El
join por `rfc` es seguro para este universo tal como está escrito.

## 26. Fase-1-bis: barrido completo de `proan-quantrue` (jul-2026)

Segundo barrido, esta vez sobre **todo** el proyecto (19 datasets, casi todos en
región `us-west4`; 3 en US), buscando específicamente: (a) fuente de CECO, (b) fuente
de Dirección de Consumo, (c) subir la validación contra SAP hacia el 100%. Regla de
datos personales respetada (solo negocio; se evitaron las tablas partidas por persona
`proan_MovimientosPoliza_*`, `ADRP`/`ADCP`, contactos, `openbravo_LOYALTYDETAIL`).
**Corrige tres conclusiones de la Fase 1 original y refuerza una.** (Queries corridas
ad-hoc, no versionadas en `queries/`.)

**26.1 — Dirección de Consumo: SÍ existe (corrige §8 y Esquema §4).** El maestro de
plantas `D00_SANDBOX.proan_T001W_*` (tipo SAP T001W, que Fase 1 dio por inexistente)
trae la dirección postal por `WERKS`: `STRAS` (calle), `ORT01` (ciudad), `PSTLZ` (CP),
`REGIO` (región). Para los WERKS del gas: PAN1 = "Km.2 Carret. San Juan - Guadal[ajara]"
(JAL), PANB = Rastro AMARA (CDMX), PANM/PAN3 = "Km 1 Carr. San Juan - San Seba" (JAL).
`ORT01`/`PSTLZ` suelen venir vacías y la calle viene truncada en el propio maestro, pero
es una dirección física real. Se expone como `direccion_sitio` en
`HCARB_GOLD_VALIDACION_SAP` (mismo ~58% de cobertura que `WERKS`). Fase 1 concluyó "no
existe" porque buscó nombres de columna DIRECCION/CALLE/... solo en `D20_DIMENSION`, no
en `D00_SANDBOX` ni por el nombre de tabla `T001W`.

**26.2 — Estatus de pago: SÍ es recuperable (revoca §19.1 y §20).** Fase 1 midió
`bsik_real_time`/`bsak_real_time` (7k filas, casi vacías para gas, sin `XBLNR`) y las
`sap_*_items` de `D30_INTEGRATION` (1-2 folios) y concluyó que el pago no era recuperable
y que "no existe tabla BSAK". Falso para el conjunto completo: `D00_SANDBOX.proan_BSAK_20260708`
(compensadas/pagadas, **438.952 filas**) y `proan_BSIK_<YYYYMMDD>` (abiertas, snapshot
diario) **sí traen `XBLNR` (folio) + `LIFNR` (proveedor)**. Casando por folio + mismo
proveedor: **604/1.056 facturas de gas (57%) aparecen, 600 pagadas / 4 pendientes**. El
`_real_time` que Fase 1 usó era un extracto parcial (7k vs 439k) y sin folio. → El
Módulo 4 tiene ahora fuente de *estatus* de pago (falta solo la *escritura* del pago a SAP).

**26.3 — Validación SAP: del 85% al 90,4% (amplía §20-22).** Se añadió una 2ª fuente de
validación —la partida de proveedor (BSAK∪BSIK, folio + proveedor, colisión-proof sin
ventana)— unida al registro `RE` de BKPF. `estado_sap` sube de 899 (85%) a **955 (90,4%)**.
El techo teórico medido era 990 (94%) usando RE sin ventana, pero eso reabre las colisiones
de folio que la ventana de 90 días corta, así que no se tocó. El ~9% restante no está en
BKPF por folio (sin registro o folio distinto); no hay campo UUID en el BKPF actual para
afinar más (el `ZZUUID` solo está en snapshots crudos de BKPF de 2014).

**26.4 — CECO: sigue sin poder derivarse, ahora con evidencia exhaustiva (confirma D9).**
El centro de coste vive en la línea de gasto FI. Descartadas TODAS las fuentes para las
sociedades del gas (`PAN`, `PRA`, `AME`, `PAT`, `SAP`, `MPE`, `BAG`, `SCO1`...):
- `proan_ACDOCA_*` (libro diario universal S/4, snapshots diarios hasta ayer, con `RCNTR`
  cost center + `WERKS`) está acotado a **`RBUKRS='ETC'`** — una sola sociedad que NO es
  ninguna del gas; los pocos matches por `BELNR` eran colisiones de otra empresa.
- `proan_0FI_GL_14_*` (líneas de mayor; SÍ tiene `XBLNR`+`KOSTL`+`WERKS` — sería ideal)
  está **congelado en agosto-2024**; el gas es jun-2025→jul-2026.
- `BSAK`/`BSIK` traen `KOSTL` pero **vacío** (línea de proveedor / cuenta de pasivo).
- `bsis_real_time` (mayor abierto, con `KOSTL`+`WERKS`): los docs del gas no están (compensados).
- **No existe `EKKN`** (imputación de pedido → CECO).
Es un límite de **INGESTA**, no de modelo: si se cargara un `0FI_GL_14` actual o un `ACDOCA`
de las sociedades del gas, el CECO saldría vía folio→BKPF→línea GL. Mientras tanto, manual.

**26.5 — Catálogo de CECO acotado a la sociedad (mejora de producto).** `proan_CSKT` no
trae sociedad (`BUKRS`), pero `KOKRS` (área de control) parte el maestro: **`PROA` (5.699,
Proan — aquí vive el único CECO real del gas), `SC01` (4.075, otra empresa: retail de
alimentos), `PREU` (27, vehículos/activos)**. El catálogo de sugerencia de CECO del backend
se acotó a `KOKRS='PROA'` (de ~9.666 a ~5.569).

**Neto:** Dirección de Consumo y estatus de pago pasan de "imposible" a "resuelto parcial"
(~58% / 57%), la validación SAP sube 5 pts, y el CECO queda confirmado como límite de
ingesta. Implementado en `ConsultasBigQuery/HCARB_gold_validacion_sap.sql` (columnas
`fuente_sap`, `estado_pago_sap`, `belnr_pago_sap`, `fecha_pago_sap`, `direccion_sitio`) y
en la app (evidencia SAP + pago + dirección en el detalle de M2, KPI de validado SAP).

## 27. Fase-1-bis-2: el cruce CFDI↔MSEG, revisitado (jul-2026) — corrige §5

**El "~2% con MSEG" del hallazgo central (§5) era en parte un bug de filtro, no un
techo de datos.** §7 ya había encontrado la pista y la dejó sin generalizar: los
documentos MSEG con `MATNR` vacío bajo la cuenta contable `0005010611` (recepciones
de servicio sin ficha de material) **sí eran gasto real** — ahí estaban los matches
exactos de Natgas Querétaro ($8.378.543 y $994.752,27, idénticos a su factura CFDI).
Pero el filtro que se usó para construir el universo de producción (`MATNR IN` los 6
materiales de `dm_material`, §3/§18) **descartaba justo ese patrón** — que resultó ser
el **dominante**, incluso para Gas Noel (el único proveedor con `MATNR` poblado: 4.991
filas por cuenta `0005010611` contra solo 52 por material).

**Corrección aplicada:** filtrar MSEG por proveedor (`LIFNR` = uno de los 11 ya
identificados en `HCARB_STG_VENDORS`) en vez de por `MATNR` — válido porque estos 11
son distribuidoras de gas dedicadas (no hay riesgo de colar diésel/insecticida de
otro proveedor al quitar el filtro de material). Con el mismo patrón de score+fallback
numérico de folio que ya usan `sap_match`/`sitio_match` (D18), el match exacto de folio
sube de **21/1.056 (2%) a 505/1.056 (48%)**: 54 con folio **e** importe exactos
("Alta" — recepción 1:1 verificable, incluidos los 2 casos de Natgas que §7 ya había
resuelto a mano), 451 con folio exacto pero importe muy distinto ("Media" — el importe
de MSEG es mayor al de la factura en 99% de los casos, signo consistente y no ruido:
el documento SAP suele ser una recepción consolidada de varias entregas/facturas, así
que confirma "hubo recepción" pero no reconcilia el monto de esta factura en concreto).

**Lo que NO cambia:** el ~52% restante (551 facturas) sigue sin ninguna recepción
casable — comprobado que todas tienen algún documento del mismo proveedor dentro de
±120 días, así que no es ausencia total de datos del proveedor, es que ni folio ni
importe casan con nada cercano (consistente con la lectura de §5 de que las entregas
pequeñas/medidas rara vez generan una recepción formal). El Módulo 2 sigue sin
depender de MSEG como vía principal de validación (esa sigue siendo BKPF/BSAK/BSIK,
§17/§26.3) — MSEG sigue siendo corroboración auxiliar, ahora con más cobertura real.
Auditado contra BigQuery (`ZZ_PRUEBAS.hcarb_mseg_scored_try`): 0 UUIDs/documentos
duplicados, 0 colisiones de folio por proveedor. Implementado en
`ConsultasBigQuery/HCARB_gold_validacion_sap.sql` (columna `confianza_mseg` reemplaza
al booleano `tiene_recepcion_mseg`).
