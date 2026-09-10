# Rendimiento de Facturas API

- Fecha de ejecución: 2026-09-10T11:17:22+02:00
- Origen: WSL del usuario, llamadas directas al API Gateway.
- Metodología: secuencial; cada respuesta se descarga completa a `/dev/null` y no se conservan documentos.
- La key se toma de `FACTURAS_API_KEY` en memoria y no se imprime ni se almacena.

## Búsquedas

| Filtro | Repeticiones | TTFB medio (s) | Total medio (s) | Bytes medios | Filas medias | HTTP no-200 | Validaciones fallidas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| sin_filtros | 3 | 0.680 | 0.770 | 39513 | 100.0 | 0 | 0 |
| fecha | 3 | 0.837 | 0.838 | 2093 | 5.0 | 0 | 0 |
| rfc | 3 | 0.835 | 0.901 | 30967 | 74.0 | 0 | 0 |
| nucleo | 3 | 0.982 | 1.043 | 30967 | 74.0 | 0 | 0 |
| combinados | 3 | 0.852 | 0.852 | 2093 | 5.0 | 0 | 0 |
| multiples | 3 | 0.814 | 0.913 | 41919 | 100.0 | 0 | 0 |

## Descarga individual

| Ruta | Repeticiones | TTFB medio (s) | Total medio (s) | Bytes medios | HTTP no-200 |
| --- | ---: | ---: | ---: | ---: | ---: |
| metadata | 3 | 0.789 | 0.789 | 395 | 0 |
| pdf | 3 | 2.068 | 2.101 | 19940 | 0 |
| xml | 3 | 0.963 | 0.963 | 5511 | 0 |

## Lotes secuenciales PDF + XML

| Facturas | Pasada 1 (s) | Pasada 2 (s) | Media (s) | Media por factura (s) | Documentos correctos | Bytes medios |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 2.805 | 2.741 | 2.773 | 2.773 | 4/4 | 25451 |
| 5 | 15.138 | 14.675 | 14.907 | 2.981 | 20/20 | 125482 |
| 10 | 30.446 | 29.785 | 30.116 | 3.012 | 40/40 | 307208 |
| 30 | 93.306 | 88.817 | 91.061 | 3.035 | 120/120 | 964690 |
| 50 | 156.864 | 146.090 | 151.477 | 3.030 | 200/200 | 1613926 |
| 100 | 315.751 | 281.458 | 298.605 | 2.986 | 400/400 | 3231204 |

Notas: no mide la autenticación de la interfaz ni la compresión del ZIP del frontend; mide Gateway + Facturas API desde el equipo ejecutor.
