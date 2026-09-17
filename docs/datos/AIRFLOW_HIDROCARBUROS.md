# Airflow de Hidrocarburos

El DAG `proan_produccion` de Cloud Composer ejecuta el flujo de Hidrocarburos
diariamente a las 07:30, hora de México. El tramo relevante es:

```text
hcarb_stg_vendors
→ hcarb_gold_clasificacion
→ hcarb_sync_pendientes
→ hcarb_estatus_sat
→ hcarb_gold_validacion_sap
```

## Sincronización de pendientes

`hcarb_sync_pendientes` ejecuta
[`ConsultasBigQuery/HCARB_sync_pendientes.sql`](../../ConsultasBigQuery/HCARB_sync_pendientes.sql).
Hace un `MERGE` insert-only desde `HCARB_GOLD_CLASIFICACION_FOLIO` hacia
`HCARB_gold_aprobacion`:

- considera únicamente UUID distintos y no nulos que aún no tienen fila de
  aprobación;
- crea esas filas con estado `pendiente_validacion_compras`;
- no incluye `UPDATE` ni `DELETE`.

Por ello no altera decisiones existentes: aprobaciones, rechazos, reaperturas
e historial siguen siendo responsabilidad de la aplicación. Compras ya no crea
pendientes al abrir la cola; solo consulta los pendientes generados por Airflow
y registra decisiones humanas.

## Invariantes operativas

- No debe haber UUID duplicados en `HCARB_gold_aprobacion`.
- Toda fila de aprobación debe tener una clasificación correspondiente.
- Toda clasificación vigente debe tener su alta de aprobación tras la ejecución
  diaria del DAG.

La definición de las tablas mutables, sus esquemas y el resto de consultas
materializadas están en [ConsultasBigQuery](../../ConsultasBigQuery/README.md).
