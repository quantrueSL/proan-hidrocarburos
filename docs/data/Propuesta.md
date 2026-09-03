# Propuesta Técnica: Plataforma de Gestión de CFDIs de Hidrocarburos

Este documento detalla el flujo de trabajo y los requisitos funcionales para la creación de una plataforma inteligente que automatiza la extracción, validación y aprobación de facturas de gas, integrándose directamente con SAP.

## Definición de Módulos

### Módulo 1: Extractor y Clasificador Automático

El sistema debe filtrar automáticamente la base de datos de CFDIs entrantes basándose exclusivamente en las siguientes claves:

| Clave SAT | Descripción | Uso Común |
| --- | --- | --- |
| **15111501** | Gas Propano (LP) | Tanques estacionarios, cilindros, gasolineras. |
| **15111502** | Gas Natural | Suministro residencial o industrial por tubería. |
| **15111503** | Gas Natural Licuado (GNL) | Transporte pesado / gran escala. |
| **15111504** | Gas Natural Comprimido (GNC) | Uso vehicular (GNV). |
| **15111505** | Propano | Uso industrial o químico. |
| **15111506** | Butano | Uso industrial o mezclas. |

### Módulo 2: Portal de Compras (Validación Obligatoria)

Este módulo es el primer filtro humano. El personal de compras verá una tabla con los CFDIs extraídos. Al seleccionar uno, el sistema debe consultar a SAP y mostrar de forma obligatoria:

- **Centro de Costos (CECO):** Vinculado al área que consume el recurso.
- **Dirección de Consumo:** Punto físico de entrega del gas.
- **Validación:** Botón de "Validar Datos" que bloquea la edición una vez confirmado que la factura corresponde al consumo real reportado en SAP.

### Módulo 3: Módulo de Aprobación Gerencial

Diseñado para una interfaz simplificada (tipo "One-Tap").

- Muestra solo facturas previamente validadas por Compras.
- Visualización rápida de: Proveedor, Monto, CECO y validación de Compras.
- **Acción:** Aprobar factura para pago.

### Módulo 4: Conector SAP (Automatización de Pago)

Una vez que el Gerente aprueba en el portal:

1. La plataforma envía una señal (vía API o RFC) a SAP.
2. Busca el documento preliminar o crea la instrucción de pago.
3. Cambia el estatus de la factura en el portal a "En proceso de pago SAP".

## 3. Reportes Ejecutivos (Dashboard)

El sistema generará resúmenes automáticos con los siguientes indicadores:

### A. Resumen de Estatus por Sociedad

- **Total Emitidas:** Volumen total de facturas detectadas con las claves SAT.
- **Validadas:** Facturas que ya pasaron por el personal de compras.
- **Aprobadas:** Facturas con visto bueno gerencial listas para pago.
- **Pendientes:** Facturas sin información de CECO o sin validación.

### B. Análisis de Gasto por Ubicación

- **Gasto por CECO:** Gráfica comparativa de qué departamento consume más gas.
- **Gasto por Dirección:** Mapa o lista de las sedes con mayor facturación de hidrocarburos.
- **Total Acumulado:** Sumatoria económica por periodo (mensual/trimestral).

## 4. Requerimientos de Seguridad e IA

- **IA de Extracción:** Capacidad de lectura de XML y PDF para asegurar que el concepto de la factura coincida con la clave SAT.
- **Sincronización:** Actualización en tiempo real con el maestro de materiales y centros de costos de SAP.
