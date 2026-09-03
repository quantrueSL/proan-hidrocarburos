# Datos

Esta carpeta guarda el requerimiento original de negocio y una explicación de
fondo sobre los datos fuente. Ya no es una carpeta de investigación cronológica
— eso vivió aquí como `PHASE1/`/`PHASE2` (investigación de tablas y diseño de
los 4 módulos) hasta que quedó superado por el trabajo real sobre
`ConsultasBigQuery/`; se retiró del árbol de trabajo, pero sigue recuperable en
el historial de git si algún día hace falta reconstruir el porqué de una
decisión concreta.

- **[`Propuesta.md`](./Propuesta.md)** — el requerimiento de negocio original
  (copia de la primera iteración de este proyecto, carpeta local nunca
  versionada y ya borrada): los 4 módulos, las claves SAT de gas, los
  indicadores del dashboard. Es el documento de referencia para saber *qué*
  se pidió.
- **[`naturaleza-de-los-datos.md`](./naturaleza-de-los-datos.md)** — *por qué*
  el cruce entre las facturas (CFDI) y los registros de SAP (MSEG, BKPF,
  BSAK/BSIK, EKBE) nunca es exacto al 100%, y qué significa cada nivel de
  coincidencia (cobertura SAP, confianza MSEG, sitio, CECO sugerido) que
  muestra la herramienta. Es la explicación estructural, no un registro de
  bugs encontrados en fechas concretas.

Para el estado actual de las tablas `HCARB_*`, qué hace cada query y el
historial de bugs corregidos al ejecutarlas contra BigQuery real, ver
**[`ConsultasBigQuery/README.md`](../../ConsultasBigQuery/README.md)** — esa es la
fuente que se mantiene viva y se re-ejecuta.

## Acceso a BigQuery

Consultas contra `proan-quantrue` vía `gcloud`/`bq` en WSL (no en el Git Bash/
PowerShell de Windows — ahí no está instalado), con login interactivo por
dispositivo. Autenticado como `quantrue1@proan.com`, proyecto por defecto
`proan-quantrue`.

**Regla obligatoria:** ninguna consulta debe extraer datos personales
confidenciales. Nada de `SELECT *`, siempre columnas explícitas + `LIMIT`, y
evitar cualquier tabla/columna que identifique a personas físicas (solo razón
social/RFC de empresas, CECOs, importes, fechas — datos de negocio, no de
personas).
