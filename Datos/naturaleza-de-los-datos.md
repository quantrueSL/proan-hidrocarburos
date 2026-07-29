# Naturaleza de los datos: por qué el cruce CFDI↔SAP nunca es exacto

Este documento no es un registro cronológico de investigación (eso vivía en las
fases `PHASE1`/`PHASE2`, ya retiradas del árbol de trabajo — siguen recuperables
en el historial de git si algún día hace falta reconstruir el porqué de una
decisión concreta). Es una explicación de fondo, pensada para no caducar: por
qué las facturas de gas y los registros de SAP no pueden casar al 100%, y qué
significa cada nivel de coincidencia que ves en la herramienta.

Para el detalle de qué hace cada query y el historial de bugs encontrados al
ejecutarlas, ver [`ConsultasBigQuery/README.md`](../ConsultasBigQuery/README.md)
— esa es la fuente que se mantiene viva. Este documento explica el **porqué**
estructural; el README explica el **qué** y el **cuándo**.

## La causa raíz: dos sistemas que registran la misma realidad a grano distinto

Todo lo que sigue —por qué la cobertura SAP nunca llega al 100%, por qué el
sitio de consumo falta en 3 de cada 10 facturas, por qué la confianza de MSEG
no siempre es "Alta", por qué el CECO a veces tiene varios candidatos— tiene
la misma causa de fondo: **la factura (CFDI) y los registros de SAP no
describen la misma unidad de trabajo.**

- Una **factura** (`cfdis`) es un documento fiscal: una entrega concreta, un
  proveedor, un folio, un importe.
- Un **documento de recepción SAP** (`MSEG`) es un movimiento de mercancía:
  puede corresponder a una entrega, a varias entregas consolidadas en un solo
  registro contable, o a una entrega repartida entre varios destinos.
- Un **asiento contable** (`BKPF`, tipo `RE`) o una **partida de proveedor**
  (`BSAK`/`BSIK`) tampoco tienen por qué corresponder 1 a 1 con el CFDI: son
  el reflejo contable de la relación con el proveedor, no de la entrega física.

No hay un identificador común entre estos sistemas (ni CFDI trae el número de
documento SAP, ni SAP trae el UUID del CFDI). El único punto de apoyo es el
**folio de la factura** (Serie+Folio), que el proveedor reporta a SAP como
referencia (`XBLNR`) — y un folio puede repetirse entre ejercicios fiscales,
así que cualquier cruce por folio necesita también una ventana de fecha para
no colar coincidencias falsas.

## `cfdis`: grano línea de concepto, con un problema de extracción real

Cada factura puede traer una o varias líneas de concepto (`ClaveProdServ`,
`Cantidad`, `Importe`...). El "importe de gas" de una factura se calcula
sumando las líneas que corresponden a gas (`151115xx` o `83101600/01`).

Esto asume que **todas** las líneas reales de la factura están en `cfdis`. No
siempre es así: para una parte significativa de las facturas (~76% en el
snapshot de jul-2026), `cfdis` solo trae **una** línea de gas, internamente
coherente (`Cantidad × ValorUnitario = Importe`), pero el `SubTotal` de
cabecera es varias veces mayor que esa única línea — algo que el SAT no
permitiría timbrar si esa fuera de verdad la única línea del CFDI (`SubTotal`
tiene que ser la suma de **todos** los conceptos). La conclusión casi
obligada: a esas facturas les faltan líneas en la extracción de `cfdis`. No es
algo que se pueda arreglar desde esta capa — no hay una fuente más completa
disponible —, pero sí se puede evitar que ese hueco distorsione el resultado:
**`SubTotal` (validado por el SAT) es más fiable que la suma de las líneas que
tengamos**, así que el importe de gas se calcula como `SubTotal` menos las
líneas que sí confirmamos que no son de gas, no como la suma de las líneas de
gas que veamos. Confirmado de forma independiente: el importe de recepción de
MSEG reconcilia con `SubTotal`, nunca con la suma incompleta de líneas.

## MSEG: grano documento de recepción física, no factura

`MSEG` registra movimientos de mercancía. El extracto disponible
(`proan_MSEG_HIDROCARBUROS_*`) viene además pre-filtrado de forma amplia (por
grupo de material o unidad), así que el filtro real que sí funciona es por
**proveedor** (los 11 proveedores de gas ya identificados), no por material —
gran parte de las recepciones se contabilizan por cuenta contable directa, sin
material asociado.

Un documento de recepción (`MBLNR`) puede tener varias líneas. Eso no significa
que el extracto esté mal — es cómo SAP registra la recepción físicamente
cuando una misma entrega (o varias entregas próximas en el tiempo del mismo
proveedor) se reparte entre distintos destinos o centros de costo. El folio de
cabecera (`XBLNR_MKPF`) es único por documento, pero el **importe total** del
documento no tiene por qué coincidir con el de una sola factura — puede ser
varias veces mayor si agrupa más de una entrega.

Esto es exactamente lo que separa la confianza **Alta** de la **Media**:

- **Alta**: el documento tiene una única línea (o el total coincide al
  centavo con la factura) — recepción verificable 1 a 1.
- **Media**: el folio coincide, pero el documento reparte el importe entre
  varias líneas/centros de costo — hay evidencia de que el gas llegó, sin
  poder aislar el monto exacto de esta factura en particular.

El precio por litro (importe ÷ cantidad) sí reconcilia casi exacto entre MSEG y
la factura en ambos casos — la prueba de que el match de folio es correcto; lo
que no reconcilia es la cantidad total, porque el documento cubre más volumen
físico que el de una sola entrega.

Ojo con el ruido de redondeo: comparar importes a 2 decimales exactos es
más estricto de lo que tiene sentido cuando dos sistemas distintos suman
números en pesos por caminos distintos — de ahí la tolerancia de **$0.20
MXN** (no dólares; todos los importes de este cruce están en pesos) al
comparar `doc_importe` (MSEG) contra el importe de la factura.

## El CECO: por qué no hay un dato exacto y por qué a veces salen varios

Idealmente, el centro de costo (CECO) de una factura de gas debería venir de
la imputación contable del pedido de compra (`EKKN` en SAP). Para estos
proveedores, ese dato no existe en los sistemas disponibles hoy: el mayor
contable detallado (`ACDOCA`) solo cubre la sociedad `ETC` (no las de gas), el
histórico agregado (`0FI_GL_14`) está congelado desde 2024, y las partidas de
proveedor (`BSAK`/`BSIK`) traen el campo `KOSTL` pero vacío. Es un límite de
**ingesta**, no de modelo — no hay una consulta que lo resuelva mejor.

Lo que sí existe es el `KOSTL` que trae el propio documento de recepción MSEG
que casó con la factura — el mismo documento que da la evidencia de
recepción física. De ahí salen dos reglas de sugerencia, nunca bloqueantes:

1. **Por proveedor**: si un proveedor concentra casi todo su historial de
   entregas en un único centro de costo (≥95%), se le sugiere ese centro a
   *todas* sus facturas, aunque esta factura en concreto no haya casado
   ningún documento.
2. **Por documento**: si no aplica la regla anterior, se usan los `KOSTL` del
   documento MSEG que casó con esta factura — si ese documento reparte el
   gasto entre varios centros de costo (la misma razón por la que a veces la
   confianza MSEG es Media, no Alta), no hay ninguna pista adicional para
   elegir uno solo, así que se muestran todos para que Compras decida.

Por eso, para una parte importante de las facturas con sugerencia, el
resultado no es un único CECO sino varias opciones: es el mismo reparto físico
de la entrega entre destinos que limita la confianza MSEG a "Media", visto
desde el ángulo del centro de costo en vez del importe.

## Sitio de consumo y cobertura SAP: el mismo principio, aplicado a otros cruces

- **Sitio de consumo**: se sigue el folio hasta el pedido de compra en SAP
  (`sap_purchasing_orders`) vía la entrada de mercancía (`sap_ekbe`), para
  llegar al `WERKS` (planta). Mismo mecanismo de folio + ventana de fecha que
  el resto de cruces, con el mismo límite: si el folio no aparece en ningún
  pedido dentro de la ventana, no hay sitio que mostrar (Compras lo captura a
  mano).
- **Cobertura SAP**: se busca el folio en dos fuentes independientes —
  el asiento contable (`bkpf`, documento `RE`) y la partida de proveedor
  (`BSAK`/`BSIK`, que además aporta el estado de pago). Si aparece en
  cualquiera de las dos, la factura queda validada. El techo de cobertura no
  es 100% porque, sin un campo UUID en estas tablas de SAP, el folio (con o
  sin ventana de fecha) es la única evidencia disponible — y para un
  porcentaje residual de facturas, simplemente no hay un registro SAP que
  citar el mismo folio dentro de una ventana razonable.

## En una frase

Ningún cruce de este proyecto es "búsqueda exacta con resultado binario" —
todos son *evidencia acumulada dentro de los límites de lo que cada sistema de
origen realmente registra*. Cuando la herramienta muestra "Media", "varios
CECO candidatos" o "sin sitio", no es una query mal escrita: es que la fuente
de origen, tal como existe hoy en SAP, no tiene una respuesta más precisa que
dar.
