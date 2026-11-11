# Banco de pruebas del asistente · reporte

Generado: 2026-11-11T10:51:42.257Z · 3 corrida(s). Montos, intención, categoría, pregunta: % de casos correctos.
Categoría = la esperada es la sugerida o una de las alternativas; "estricta" = la sugerida. Latencias medidas en el cliente (Colombia → Supabase).
Tokens: promedio por solicitud (entrada / salida incl. razonamiento / razonamiento / cacheados / facturables contra cuota = entrada − cacheados + salida).

| Métrica | **m-qwen3.8-27b** | **0-linea-base** | **1-final-120b-low** |
|---|---|---|---|
| Modo | local qwen/qwen3.8-27b  | ai-assistant | local openai/gpt-oss-120b,openai/gpt-oss-20b low |
| Casos (errores) | 66 (0) | 66 (0) | 66 (2) |
| Casos 100% correctos | 93.9% | 87.9% | 84.8% |
| Montos exactos | 97.0% | 95.5% | 92.4% |
| Intención | 100.0% | 98.5% | 90.9% |
| Categoría (sug. o alt.) | 95.7% | 93.5% | 89.4% |
| Categoría estricta | 91.3% | 91.3% | 89.4% |
| Pregunta cuando corresponde | 98.5% | 98.5% | 90.9% |
| Separación / agrupación | 95.7% | 97.8% | 93.6% |
| Método de pago | 100.0% | 100.0% | 77.8% |
| Fecha | 100.0% | 100.0% | 77.8% |
| Campos (pagos, consultas…) | 100.0% | 84.6% | 66.7% |
| Texto total p50 / p95 | 801 ms / 1.42 s | 3.29 s / 8.62 s | 862 ms / 1.84 s |
| Texto 1ª propuesta p50 / p95 | 769 ms / 1.42 s | 3.29 s / 8.62 s | 862 ms / 1.84 s |
| Audio total p50 / p95 | 1.60 s / 2.73 s | 5.15 s / 11.97 s | 1.77 s / 3.26 s |
| Audio 1ª propuesta p50 / p95 | 1.60 s / 2.73 s | 5.15 s / 11.97 s | 1.77 s / 3.26 s |
| Audio → "Escuché" p50 | 770 ms | — | 675 ms |
| Etapas p50: subida · STT · contexto · LLM (1ª línea) | — · 769 ms · — · 766 ms (693 ms) | — · — · — · — (—) | — · 671 ms · — · 813 ms (769 ms) |
| Servidor total p50 | — | 3.10 s | — |
| Tokens entrada / salida | 1494 / 39 | — | 1477 / 80 |
| Tokens razonamiento / cacheados | 0 / 0 | — | 44 / 320 |
| Tokens contra cuota | 1534 | — | 1237 |
| Modelos usados | qwen/qwen3.8-27b×66 | gpt-oss-20b×37, gpt-oss-120b×28, qwen/qwen3.8-27b×1 | gpt-oss-120b×30, gpt-oss-20b×34 |

## Whisper: turbo vs large-v3

Audios del banco (24 transcripciones por modelo). Montos = los montos normalizados de la transcripción coinciden con los de la frase; nombres = Visa, Nequi, D1… aparecen bien escritos.

| Modelo | Montos | Nombres | p50 | p95 | Errores |
|---|---|---|---|---|---|
| whisper-large-v3-turbo | 100.0% | 100.0% | 490 ms | 839 ms | 0 |
| whisper-large-v3 | 100.0% | 100.0% | 557 ms | 942 ms | 0 |

## Fallos · m-qwen3.8-27b

- `spec-01` (amounts, category_strict, category, structure) → expense 30000 Comida y restaurantes account:Efectivo* 2026-11-11; expense 22000 Comida y restaurantes account:Efectivo* 2026-11-11; expense 10000 Comida y restaurantes account:Efectivo* 2026-11-11
- `slang-04` (category_strict) → expense 500000 Otros account:Efectivo 2026-11-11
- `inc-03` (amounts, ask, category_strict, category, structure) → sin propuestas · pregunta: ¿De qué son esos $50000 que te entraron? (¿Venta, reembolso, transferencia, otro ingreso?)
- `audio-10` (category_strict) → expense 500000 Hogar account:Efectivo 2026-11-11; expense 70000 Gasolina account:Bancolombia 2026-11-10 · «Le pagué medio palo al mecánico por arreglar la moto, y ayer eché gasolina por 70.000 con la de Bancolombia.»

## Fallos · 0-linea-base

- `slang-05` (amounts, category_strict, category) → expense 80000000 Gasolina account:Efectivo* 2026-11-11
- `pay-03` (category_strict, category) → expense 65000 Otros account:Efectivo 2026-11-11
- `q-05` (fields) → sin propuestas · consulta {"metric":"spending","from":"2026-11-01","to":"2026-11-11","category_id":null,"card_id":null}
- `miss-02` (intent) → sin propuestas · pregunta: ¿Y para qué pagaste esos 25 mil?
- `audio-05` (fields) → sin propuestas · consulta {"metric":"spending","from":"2026-11-01","to":"2026-11-11","category_id":null,"card_id":null} · «¿Cuánto he gastado esta semana?»
- `audio-07` (amounts, ask, category_strict, category, structure) → sin propuestas · pregunta: ¿Cuánto te costó el tanque de 80 barras? · «Tanque 80 barras»
- `audio-10` (category_strict) → expense 500000 Hogar account:Efectivo* 2026-11-11; expense 70000 Gasolina account:Bancolombia 2026-11-10 · «Le pagué medio palo al mecánico por arreglar la moto, y ayer eché gasolina por 70 mil con la de Bancolombia.»
- `audio-12` (amounts) → income 2500000 Salario account:Efectivo* 2026-11-11 · «Me llegó la quincena, me pagaron dos palos y medio, y le aboné 300 mil a la Mastercard desde Nequi.»

## Fallos · 1-final-120b-low

- `spec-04` (amounts, intent, ask, fields) → sin propuestas · pregunta: ¿A cuál tarjeta le hiciste el pago?
- `slang-04` (category_strict, category) → expense 500000 Hogar account:Efectivo* 2026-11-11
- `pay-03` (category_strict, category) → expense 65000 Otros account:Efectivo 2026-11-11
- `q-01` (fields) → sin propuestas · consulta {"metric":"balance","from":"2026-11-11","to":"2026-11-11","label":"hoy","category_id":null,"card_id":null,"account_id":null}
- `miss-01` (intent, ask) → sin propuestas
- `miss-03` (intent, ask) → sin propuestas
- `audio-02` (amounts, category_strict, category, structure) → sin propuestas · pregunta: ¿Cuánto costaron los clavos? · «Fui a la ferretería y me compré unos clavos para la casa, y de paso una empanada de 5 lucas.»
- `audio-04` (amounts, intent, ask, fields) → sin propuestas · pregunta: ¿A cuál tarjeta le hiciste el pago? · «Pagué 500.000 de la visa desde Bancolombia.»
- `audio-10` (error: openai/gpt-oss-20b: 429 {"error":{"message":"Rate limit reached for model `openai/gpt-oss-20b` in organization `org_01ksbrg1xffe2aj1ja0z6wexje` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 198479, Requested 1554. Please try again in 14.256s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}
)
- `audio-12` (error: openai/gpt-oss-20b: 429 {"error":{"message":"Rate limit reached for model `openai/gpt-oss-20b` in organization `org_01ksbrg1xffe2aj1ja0z6wexje` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199806, Requested 1552. Please try again in 9m46.656s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}}
)
