# Fase 1 — Decisiones

Resumen compacto de la Fase 1 (matching CFDI↔SAP de Hidrocarburos).
Investigación y queries en [`hallazgos.md`](./hallazgos.md); mapa de tablas en
[`Esquema.md`](./Esquema.md).

> **Actualizado en Fase-1-bis (jul-2026):** un segundo barrido de **todo**
> `proan-quantrue` corrigió **D4** (la dirección de consumo SÍ existe, vía `T001W`) y
> **D15** (el estatus de pago SÍ es recuperable, vía `proan_BSAK`/`BSIK`), reforzó **D9**
> (CECO manual, ahora con evidencia exhaustiva) y subió la validación SAP del 85% al
> 90,4%. Todo en [`hallazgos.md`](./hallazgos.md) §26 y `Esquema.md` §8.

> **Corrección Fase-1-bis-2 (jul-2026):** el "~2% con MSEG" de abajo era en parte un
> bug de filtro (`MATNR` en vez de proveedor), no un techo de datos — sube a **48%**
> filtrando por proveedor. Ver [`hallazgos.md`](./hallazgos.md) §27, que corrige §5, y
> D3 más abajo. No cambia la arquitectura de Módulo 2 (MSEG sigue siendo corroboración
> auxiliar, no la vía principal de validación).

## El hallazgo que sostiene todo lo demás

Solo el **~2%** de las facturas de gas tiene un documento SAP de recepción de
mercancía (MSEG) con material de gas contra el que conciliar (21 de 1,051,
acotado a Proteína Animal). No es un problema de datos incompletos: es el
tamaño de la transacción (solo las entregas grandes a granel generan
recepción). **El Módulo 2 se diseña asumiendo que la vía "sin MSEG" es el caso
normal, no la excepción.**

> **Corrección (§27):** el filtro de "es gas" en MSEG (`MATNR` contra el catálogo de
> 6 materiales) descartaba las recepciones sin material (cuenta contable directa
> `0005010611`) — el patrón dominante, no la excepción. Filtrando por proveedor en vez
> de por material, sube a **505/1,056 (48%)** con evidencia de recepción (54 con folio
> e importe exactos, 451 con folio pero importe de un documento consolidado). El ~52%
> restante sí carece de recepción casable — la lectura de "tamaño de la transacción"
> se mantiene para esa mitad, solo que ya no es el 98%.

Matiz clave (§20): "sin MSEG" **no** es "sin rastro en SAP". El **87%** de las
facturas sí está registrada como documento contable (`RE`) en SAP FI. Lo que
no hay es recepción de mercancía con material de gas (2%) ni estatus de pago.

> **Actualización Fase-1-bis (§26):** uniendo el registro `RE` con la partida de
> proveedor (`proan_BSAK`/`BSIK`, folio+proveedor), `estado_sap` sube al **90,4%**, y el
> estatus de pago SÍ resultó recuperable (**600 pagadas / 4 pendientes** de 1.056).

> **Snapshot:** `cfdis` es un feed que crece; las cifras están ancladas al
> **22-jul-2026** (datos hasta 2026-07-20). El hallazgo central se re-verificó
> contra los 6 materiales de gas y todo 2026
> ([queries/103](./queries/103_cobertura_definitiva_6_materiales.sql)).

## Decisiones cerradas (base del diseño)

| # | Tema | Decisión |
| --- | --- | --- |
| D3 | Arquitectura de matching | Dos vías: **servicio** (sin MSEG, sigue siendo la vía principal de validación — registro SAP + CECO + pedido) y **corroboración MSEG** (**corregido §27, jul-2026: 48%, no 2%** — filtrar por proveedor conocido en vez de por catálogo de material; folio+fallback numérico como clave, score con importe como señal de confianza, excluir revertidos `BWART 102`). MSEG sigue sin ser la vía principal: `estado_sap` (que sí bloquea/flaguea) se apoya en BKPF/BSAK/BSIK, no en MSEG. |
| D4 | Dirección de Consumo | El **sitio (`WERKS`) es derivable para ~58%** vía folio→`sap_ekbe`→pedido (547→613 con el fix de folio numérico, §23): casi todo "PAN Planta San Juan 1". **La dirección postal SÍ existe** (corregido Fase-1-bis, §26.1): `proan_T001W_*` da calle/región por `WERKS`, expuesta como `direccion_sitio` (mismo ~58%). El ~42% sin sitio es estructural (sin rastro de pedido en EKBE), no formato. |
| D10 | Sitios de consumo (incl. Querétaro/Torreón) | **Resuelto:** todo el gas rastreable converge en **Planta San Juan 1** (Jalisco). Los pedidos de Energas de México (74) y Natgas Querétaro (1) apuntan a `WERKS`=San Juan 1 pese a estar registrados fuera; **no hay sitios de consumo separados sin identificar**. Matiz: confirmar con Compras que el `WERKS` de pedido de servicio = punto físico (§21). |
| D11 | Alcance por razón social | Solo Proteína Animal (`PAN921013AK7`): 11 proveedores, **1,051 facturas · ~$40.6M** (jun-2025→jul-2026). *Provisional.* |
| D14 | Deduplicar el origen | `dm_vendors`, el extracto MSEG (34% filas dup) y `cfdis` traen filas duplicadas. El backend **debe deduplicar** antes de cualquier `SUM`/`JOIN` (§18-19). |
| D17 | Capa SAP `D30_INTEGRATION` | La factura de gas **sí está registrada en SAP** (`bkpf`, 87% de folios; 81% como `RE`, **match blindado**: 845/847 a ≤7 días del CFDI, §21) y **existen pedidos de compra** (`sap_purchasing_orders`, los 11 proveedores). Corrige el error previo de que EKKO/EKPO no existían (§20-21, `Esquema.md` §7). |
| D18 | Match folio↔BKPF por número, no por serie | El 13% sin match exacto se explica: `BKPF.XBLNR` guarda el **número** de folio con prefijo/sufijo **variable** (`GCRE12179`→`12179`/`FL11569`), no la `Serie+Folio`. **El matcher del Módulo 2 debe usar nº de folio + fecha (±7-15d)**, no `Serie+Folio` exacto. `sin_match_sap` = **flag de revisión suave, no bloqueo** (∼37% de los sin-match son formato/timing benignos; ∼14%+ es ausencia real). (§22, [queries/120](./queries/120_sin_match_bkpf_por_proveedor.sql)-[124](./queries/124_sin_match_bkpf_ausencia_real.sql)). |

## Abiertas (decisión de negocio o verificación pendiente)

| # | Tema | Estado |
| --- | --- | --- |
| D1 | Claves SAT del alcance | `151115xx` + `83101600/01`. **Decisión de Pablo, sin ratificar.** |
| D2 | Excluir diésel/gasolina | Sí (193 proveedores vs 11 de gas — patrón de flotilla, no gas a granel). **Sin ratificar.** |
| D8 | 19 folios con cantidad discrepante | 18 en el CECO "Planta Corrugados Planchas"; **13 ya tienen candidata de factura correcta** propuesta. Verificar con Compras ([queries/100](./queries/100_candidatos_correccion_d8.sql)). |
| D9 | CECO automático por proveedor | No confirmable para casi ninguno → hoy **manual**. El spike lo confirma: el pedido (`sap_purchasing_orders`) **no trae `KOSTL`** (imputación en `EKKN`, ausente) y las tablas con `KOSTL` están vacías para gas (§21). **Fase-1-bis lo cierra con más fuentes (§26.4):** `ACDOCA` (que sí tiene cost center) está acotado a otra sociedad (`ETC`), `0FI_GL_14` está congelado en 2024, sigue sin `EKKN` → es límite de **ingesta**, no de modelo. El catálogo de CECO se acotó a `KOKRS='PROA'` (§26.5). *(El `WERKS`/sitio y la dirección sí son derivables — ver D4.)* |
| D12 | Facturas mixtas (74%) | El dashboard suma `Importe` de la **línea de gas**, no `Total`. **Pendiente de negocio:** ¿aprobar/pagar la factura completa o solo validar la línea? (§16). |
| D13 | Cancelación SAT | `cfdis` no trae estatus de cancelación. **Pendiente:** ¿chequeo externo de Estatus SAT antes de aprobar para pago? (§17). |
| D15 | Estatus de pago (Módulo 4) | **Estatus recuperable (corregido Fase-1-bis, §26.2):** `proan_BSAK_*` (compensadas, 439k filas, con `XBLNR`+`LIFNR`) / `proan_BSIK_*` (abiertas) dan pagada/pendiente por folio+proveedor — **600 pagadas / 4 pendientes** de 1.056; ya expuesto en la app. Lo que sigue faltando es la **escritura** de la instrucción de pago a SAP (no hay vía de write). El `bsik/bsak_real_time` que se midió en Fase 1 era un extracto parcial de 7k sin folio. |

*(D5 nombre de CECO, D6 catálogo SAT, D7 → superada por D15, D16 retenciones:
resueltas o menores; el detalle vive en `Esquema.md` y `hallazgos.md`.)*

## Próximos pasos

1. **Ratificar el alcance (D1/D2)** con el negocio.
2. **Spike de Módulo 2 (D9/D17): hecho** (§21) — match BKPF blindado (99.8% a
   ≤7 días), sitio `WERKS` derivable al ~52% (casi todo San Juan 1), CECO
   confirmado como manual. Queda por confirmar la **frescura** de las tablas
   `D30_INTEGRATION` y por qué el 48% no llega a un pedido vía `EKBE`.
3. **Decisiones de negocio:** D12 (factura completa vs línea) y D13 (cancelación).
4. **Módulo 4 (D15):** el *estatus* de pago ya se resolvió (Fase-1-bis, §26.2:
   `proan_BSAK`/`BSIK`, 600 pagadas). Falta solo la *escritura* de la instrucción
   de pago a SAP, que hoy no tiene vía.
