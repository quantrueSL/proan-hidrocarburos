# API de facturas: XML y PDF de las facturas de gas

Estado y decisiones de `facturas-api` (código en
[`apps/facturas-api/`](../../apps/facturas-api/)), la API pública protegida
que expone el XML y el PDF (representación impresa) de cada factura de gas
que Hidrocarburos ya clasifica. Es un servicio **aparte** del portal de
Hidrocarburos (frontend + `financialbi`) — comparte proyecto de GCP y datos
de BigQuery, pero se despliega y se versiona de forma independiente. Última
actualización: 2026-09-03.

---

## 1. Por qué existe

El objetivo original: poder consultar/descargar el XML y el PDF de una
factura de gas vía API, con acceso protegido (API key), sin depender de que
alguien entre al portal.

La pregunta que decidía todo el diseño era **de dónde sale el XML original**
— la herramienta, hasta ahora, solo tenía el CFDI ya *parseado* en columnas
de BigQuery (`HCARB_GOLD_CLASIFICACION_FOLIO`, `cfdi_completo`), nunca el
archivo en sí.

## 2. De dónde sale el XML — investigación y hallazgo

Se investigó la cadena completa de ingesta en `proan-quantrue`:

```
? (origen del XML, no confirmado del todo)
      │
      ▼
  MongoDB "SAT"  ← así la describe el propio DDL de BigQuery
      │  export diario a JSONL
      ▼
gs://proan-quantrue-cfdi-staging/cfdi_staging/*.jsonl  (bucket puente, se
                                                          vacía tras cargar)
      │  BigQuery LOAD (varias veces al día)
      ▼
D00_SANDBOX.cfdi_cabecera / cfdi_conceptos / cfdi_complementos / cfdi_raw
      │
      ▼
D30_INTEGRATION.cfdi_completo → HCARB_GOLD_* (lo que ya usaba la herramienta)
```

**Hallazgo clave**: `D00_SANDBOX.cfdi_raw.comprobante_json` — a diferencia de
`cfdi_cabecera`/`cfdi_conceptos`/`cfdi_complementos` (que sí pierden fidelidad
al tipar cada columna) — es el árbol XML **completo** convertido a JSON, con
los valores preservados como texto literal. Contiene incluso el `Sello`, el
`Certificado` (X.509 completo del emisor) y el `SelloSAT` — no solo los
resúmenes que sí llegaban a `cfdi_cabecera`.

Esto permite **reconstruir el XML on-demand**, sin necesitar:
- Rama A (que alguien ya conserve el XML crudo en algún sistema — la Mongo
  mencionada, un buzón, SAP...) — sigue pendiente de confirmar con Fer, ver
  §6, pero **ya no bloquea nada**.
- Rama B (Descarga Masiva de CFDI del SAT con e.firma) — descartada por
  innecesaria mientras la Rama D siga funcionando.

## 3. Verificación: no es solo "parece igual", es criptográficamente válido

Se probó la reconstrucción contra dos facturas reales (una simple, una mixta
de 131 líneas de concepto):

1. **Coincidencia de campos**: `SelloCFD`, `SelloSAT`, `NoCertificado`,
   `Total`, `SubTotal` del XML reconstruido coinciden carácter a carácter con
   `cfdi_cabecera`.
2. **Verificación criptográfica real** (`facturas_api/verificacion.py`):
   se recalculó la "cadena original" del CFDI con el algoritmo público del
   SAT (Anexo 20, confirmado contra el XSLT real, no de memoria) y se validó
   la firma RSA-SHA256 del `Sello` contra el `Certificado` embebido. **Las
   dos facturas validan.**

De paso, esa verificación encontró y corrigió un bug real: faltaba aplicar
`normalize-space()` a los valores antes de concatenarlos — solo se
manifestaba con datos reales "sucios" (una descripción de concepto con
espacios irregulares entre 131), nunca con datos sintéticos limpios.

**Conclusión práctica**: no hace falta el archivo XML original byte a byte
para servir un documento fiscalmente fiel — la reconstrucción desde
`cfdi_raw` es indistinguible del original a efectos de firma digital.

## 4. Arquitectura

Decidido explícitamente: **sin bucket, sin tarea de Airflow, sin dataset
nuevo**. Todo se genera on-demand en cada petición — con el volumen esperado
(las facturas de gas ya clasificadas, cientos, no miles), recalcular en cada
llamada es más simple y más barato que mantener una caché sincronizada, y
evita que un PDF cacheado quede desactualizado si una factura se cancela ante
el SAT después de generarlo.

```
Cliente (con x-api-key)
      │
      ▼
API Gateway (público, valida la key y aplica cuota)
      │  llama a Cloud Run con su propia identidad de servicio
      ▼
Cloud Run "plataforma-hidrocarburos-api"  (NO invocable directamente)
      │
      ├─→ BigQuery: cfdi_raw + cfdi_cabecera + HCARB_GOLD_CLASIFICACION_FOLIO
      │              + HCARB_ESTATUS_SAT (estatus de cancelación)
      │
      ├─→ reconstruccion.py   JSON → XML (validado)
      ├─→ verificacion.py     ¿el Sello valida? (si no, solo un log.warning)
      └─→ render_pdf.py       XML → PDF (Jinja2 + WeasyPrint + QR del SAT)
```

Por qué Cloud Run no es invocable directamente: tiene una URL, pero nadie
tiene `roles/run.invoker` salvo la cuenta de servicio dedicada
`facturas-api-gateway@proan-quantrue.iam.gserviceaccount.com`, que es la que
usa API Gateway para llamarlo. Verificado en el despliegue real: ni siquiera
el dueño del proyecto puede invocarlo sin ese rol (403/401 según el caso).

Detalle completo de los recursos de GCP creados (nombres exactos, comandos
para actualizar el Config o dar de alta otra key) en
[`deploy/cloudrun-facturas-api/README.md`](../../deploy/cloudrun-facturas-api/README.md).

## 5. Contrato de la API

Alcance: **solo** UUIDs que existan en `HCARB_GOLD_CLASIFICACION_FOLIO` (las
facturas de gas que la herramienta ya procesa) — un UUID real pero fuera de
ese universo da 404, igual que uno inexistente, a propósito (no revela si
algo existe fuera del alcance de gas).

| Ruta | Qué hace |
| --- | --- |
| `GET /v1/facturas/{uuid}` | Metadata: proveedor, folio, importe, estatus de cancelación SAT, links a XML/PDF |
| `GET /v1/facturas/{uuid}/xml` | El XML reconstruido |
| `GET /v1/facturas/{uuid}/pdf` | El PDF (representación impresa, con QR); marca "CANCELADO" si aplica |
| `GET /v1/facturas?rfc_emisor=&serie=&folio=&fecha_desde=&fecha_hasta=` | Búsqueda por el identificador "humano" — puede devolver varias coincidencias, fecha opcional |
| `GET /health` | Estado del servicio |

La metadata **no incluye CECO ni el estado del flujo de aprobación interno**
(Compras/Gerencia) — decisión consciente, ampliable en el futuro si hiciera
falta.

Catálogo de errores (`{"error": "...", "detail": "..."}`):

| HTTP | `error` | Cuándo |
| --- | --- | --- |
| 400 | `parametros_invalidos` | Parámetro de búsqueda mal formado (ej. rango de fecha invertido) |
| 404 | `factura_no_encontrada` | UUID inexistente o fuera del universo de gas |
| 500 | `error_interno` | Fallo nuestro inesperado (ej. BigQuery no responde) |
| 503 | `generacion_no_disponible` | La factura existe pero falla la reconstrucción/render para ese caso concreto |

422 lo da FastAPI gratis (Pydantic); 401/403 por API key los resuelve API
Gateway antes de llegar al código.

## 6. Qué falta / pendiente

- **Confirmación de Fer sobre la MongoDB "SAT"**: si guarda el XML original
  byte a byte, dónde vive y quién tiene acceso. No bloquea nada hoy — solo
  importaría para un caso más estricto (auditoría fiscal que exija el
  archivo *original* exacto, no una reconstrucción, aunque esta ya esté
  probada criptográficamente).
- **Interfaz/cliente para consultar la API** sin peticiones HTTP crudas:
  decidido que queda **aparte** del portal de Hidrocarburos, sin fecha ni
  diseño concreto todavía.
- **Gestión de API keys**: hoy 100% manual (`gcloud services api-keys
  create`, ver `deploy/cloudrun-facturas-api/README.md`), solo quien
  administre esto. Sin autoservicio ni interfaz de administración — no hace
  falta mientras sea una sola persona.
- **Layout del PDF**: correcto y completo en datos, pero no es una réplica
  pixel-perfect del formato oficial que genera un PAC — pendiente de pulir si
  se considera necesario.
- **Este mismo documento** es la referencia — el `README.md` principal del
  repo todavía no menciona `facturas-api` en su tabla de módulos ni en la
  estructura del monorepo (a diferencia de `LOGIN.md` y
  `naturaleza-de-los-datos.md`, que sí están enlazados desde ahí).

## 7. Archivos relevantes

- Código: [`apps/facturas-api/`](../../apps/facturas-api/)
- Despliegue: [`deploy/cloudrun-facturas-api/`](../../deploy/cloudrun-facturas-api/)
  (`service.yaml`, `cloudbuild.yaml`, `deploy.sh`, `openapi.yaml`, `README.md`)
- Pruebas: `apps/facturas-api/tests/` (`test_reconstruccion.py`,
  `test_verificacion.py` — ambas con datos sintéticos, sin ninguna factura
  real)
