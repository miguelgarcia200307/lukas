# Banco de pruebas del asistente · reporte

Generado: 2026-11-11T14:52:53.057Z · 8 corrida(s). Montos, intención, categoría, pregunta: % de casos correctos.
Categoría = la esperada es la sugerida o una de las alternativas; "estricta" = la sugerida. Latencias medidas en el cliente (Colombia → Supabase).
Tokens: promedio por solicitud (entrada / salida incl. razonamiento / razonamiento / cacheados / facturables contra cuota = entrada − cacheados + salida).

| Métrica | **m-qwen3.8-27b** | **0-linea-base** | **1-final-120b-low** | **2-fix-qwen-muestra** | **3-produccion-muestra** | **4-fix-transporte** | **5-multi-local** | **6-multi-produccion** |
|---|---|---|---|---|---|---|---|---|
| Modo | local qwen/qwen3.8-27b  | ai-assistant | local openai/gpt-oss-120b,openai/gpt-oss-20b low | local qwen/qwen3.8-27b,openai/gpt-oss-120b  | ai-assistant | local qwen/qwen3.8-27b,openai/gpt-oss-120b  | local   | ai-assistant |
| Casos (errores) | 66 (0) | 66 (0) | 66 (2) | 17 (0) | 17 (0) | 2 (0) | 9 (0) | 9 (0) |
| Casos 100% correctos | 93.9% | 87.9% | 84.8% | 88.2% | 94.1% | 100.0% | 100.0% | 88.9% |
| Montos exactos | 97.0% | 95.5% | 92.4% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Intención | 100.0% | 98.5% | 90.9% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Categoría (sug. o alt.) | 95.7% | 93.5% | 89.4% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Categoría estricta | 91.3% | 91.3% | 89.4% | 87.5% | 90.9% | 100.0% | 100.0% | 100.0% |
| Pregunta cuando corresponde | 98.5% | 98.5% | 90.9% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Separación / agrupación | 95.7% | 97.8% | 93.6% | 100.0% | 100.0% | 100.0% | 100.0% | 88.9% |
| Método de pago | 100.0% | 100.0% | 77.8% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Fecha | 100.0% | 100.0% | 77.8% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Campos (pagos, consultas…) | 100.0% | 84.6% | 66.7% | 100.0% | 100.0% | — | — | — |
| Texto total p50 / p95 | 801 ms / 1.42 s | 3.29 s / 8.62 s | 862 ms / 1.84 s | 830 ms / 2.12 s | 995 ms / 1.51 s | 1.53 s / 1.53 s | 1.00 s / 1.22 s | 867 ms / 1.71 s |
| Texto 1ª propuesta p50 / p95 | 769 ms / 1.42 s | 3.29 s / 8.62 s | 862 ms / 1.84 s | 830 ms / 2.12 s | 995 ms / 1.38 s | 1.53 s / 1.53 s | 940 ms / 1.22 s | 866 ms / 1.71 s |
| Audio total p50 / p95 | 1.60 s / 2.73 s | 5.15 s / 11.97 s | 1.77 s / 3.26 s | 1.90 s / 2.99 s | 1.37 s / 1.86 s | 1.59 s / 1.59 s | 1.18 s / 1.18 s | 1.12 s / 1.12 s |
| Audio 1ª propuesta p50 / p95 | 1.60 s / 2.73 s | 5.15 s / 11.97 s | 1.77 s / 3.26 s | 1.90 s / 2.99 s | 1.37 s / 1.86 s | 1.59 s / 1.59 s | 1.18 s / 1.18 s | 1.12 s / 1.12 s |
| Audio → "Escuché" p50 | 770 ms | — | 675 ms | 1.13 s | 744 ms | 919 ms | 627 ms | 513 ms |
| Etapas p50: subida · STT · contexto · LLM (1ª línea) | — · 769 ms · — · 766 ms (693 ms) | — · — · — · — (—) | — · 671 ms · — · 813 ms (769 ms) | — · 1.13 s · — · 885 ms (698 ms) | 1 ms · 274 ms · 46 ms · 524 ms (405 ms) | — · 919 ms · — · 669 ms (419 ms) | — · 618 ms · — · 1.00 s (571 ms) | 1 ms · 236 ms · 45 ms · 587 ms (400 ms) |
| Servidor total p50 | — | 3.10 s | — | — | 626 ms | — | — | 700 ms |
| Tokens entrada / salida | 1494 / 39 | — | 1477 / 80 | 1560 / 58 | 1551 / 74 | 1579 / 62 | 1853 / 106 | 1833 / 150 |
| Tokens razonamiento / cacheados | 0 / 0 | — | 44 / 320 | 0 / 0 | 19 / 0 | 0 / 0 | 0 / 0 | 59 / 0 |
| Tokens contra cuota | 1534 | — | 1237 | 1618 | 1625 | 1640 | 1960 | 1984 |
| Modelos usados | qwen/qwen3.8-27b×66 | gpt-oss-20b×37, gpt-oss-120b×28, qwen/qwen3.8-27b×1 | gpt-oss-120b×30, gpt-oss-20b×34 | qwen/qwen3.8-27b×17 | qwen/qwen3.8-27b×10, gpt-oss-120b×7 | qwen/qwen3.8-27b×2 | qwen/qwen3.8-27b×9 | qwen/qwen3.8-27b×5, gpt-oss-120b×4 |

## Whisper: turbo vs large-v3

Audios del banco (24 transcripciones por modelo). Montos = los montos normalizados de la transcripción coinciden con los de la frase; nombres = Visa, Nequi, D1… aparecen bien escritos.

| Modelo | Montos | Nombres | p50 | p95 | Errores |
|---|---|---|---|---|---|
| whisper-large-v3-turbo | 100.0% | 100.0% | 490 ms | 839 ms | 0 |
| whisper-large-v3 | 100.0% | 100.0% | 557 ms | 942 ms | 0 |

## Fallos · 3-produccion-muestra

- `audio-10` (category_strict) → expense 500000 Hogar account:Efectivo 2026-11-11; expense 70000 Gasolina account:Bancolombia 2026-11-10 · «Le pagué medio palo al mecánico por arreglar la moto, y ayer eché gasolina por 70.000 con la de Bancolombia.»

## Fallos · 4-fix-transporte

Ninguno.

## Fallos · 5-multi-local

Ninguno.

## Fallos · 6-multi-produccion

- `multi-04` (structure) → expense 8000 Mercado account:Efectivo* 2026-11-11; expense 45000 Tecnología account:Efectivo* 2026-11-11
