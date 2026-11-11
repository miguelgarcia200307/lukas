# Lukas

**Lukas** es un gestor de finanzas personales *voice-first* para Colombia (COP, hora de Bogotá). Dices “almorcé por 18 lucas con la Visa” y la IA lo entiende, lo separa por categorías y te propone el registro; tú confirmas con un toque.

- **Frontend:** PWA instalable en HTML, CSS y JavaScript con ES Modules, sin frameworks ni build. Funciona en GitHub Pages bajo un subpath.
- **Backend:** Supabase (Postgres con RLS, Auth, Edge Functions, pg_cron, pg_net y Vault).
- **IA:** Groq (Whisper para transcribir y un LLM para interpretar), llamado solo desde Edge Functions.

## Correr en local
```powershell
npm install        # solo herramientas locales (sharp para generar íconos)
npm run dev        # http://localhost:5173
```
El frontend usa la URL y la llave publicable definidas en `js/config.js`.

## Desplegar el backend
1. Copia la plantilla: `copy .env.example .env.local` y llena los valores reales (token de Supabase, llaves, Groq, VAPID, usuario).
2. Ejecuta: `node --use-system-ca scripts/deploy.mjs`

El script vincula el proyecto, aplica las migraciones y el seed, desactiva el registro público, guarda los secretos internos en Vault, carga los secrets de las Edge Functions, las despliega, crea tu usuario y corre `scripts/verify.mjs`.

- Verificar sin tocar tus datos: `node --use-system-ca scripts/verify-temp.mjs` (usa un usuario temporal que luego se borra).
- Redesplegar solo funciones: `npx supabase functions deploy <nombre> --project-ref <ref> --no-verify-jwt --use-api` (cada función valida el JWT en su código).

## Asistente de IA
Flujo por solicitud: el audio se sube apenas se detiene la grabación (o tras 1,5 s de silencio) → la función verifica el JWT localmente, consulta en **una sola RPC** (`ai_begin`) la cuota y el contexto compacto del usuario (en caché por versión), y en paralelo transcribe con Whisper → normaliza los montos en código ("30 lucas" → $30000) → el LLM responde en **JSON Lines** y cada línea se valida y se envía a la app por **SSE** (`transcript`, `proposal`, `question`, `reply`, `done`). Las consultas se calculan en SQL (`ai_query`) y se responden con plantillas, sin segunda llamada al LLM. Lo que el usuario confirma alimenta `category_hints` (memoria de categorización).

- Modelos y cuotas por secrets: `GROQ_CHAT_MODEL`, `GROQ_CHAT_FALLBACK`, `GROQ_REASONING_EFFORT`, `GROQ_STT_MODEL`, `GROQ_STT_FALLBACK`, `AI_DAILY_CAPACITY` (capacidad diaria estimada; cada usuario recibe la mitad) o `AI_USER_DAILY_QUOTA`.
- Banco de pruebas: `scripts/ai-eval/` (casos en español colombiano, audios sintéticos y reporte en `report.md`).
  - Contra la función desplegada: `npm run eval -- --label nombre`
  - Pipeline local con otro modelo: `npm run eval -- --label x --local --model openai/gpt-oss-20b --effort low`
  - Whisper turbo vs large-v3: `npm run eval:whisper` · pruebas unitarias de la normalización: `npm test`
  - Salida cruda del modelo para una frase: `node --use-system-ca scripts/ai-eval/raw.mjs "frase"` (en producción queda en `ai_logs.response.raw`)
  - Varias categorías en una frase: solo se fusiona lo de la misma categoría y el mismo lugar; un ítem sin monto queda como tarjeta pendiente con su pregunta
  - Borrar las cuentas y tarjetas de prueba que crea el banco: `npm run eval -- --cleanup`

## Activar GitHub Pages
1. En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch**, rama `main`, carpeta `/ (root)`.
2. La app queda en `https://<usuario>.github.io/<repositorio>/`. Todas las rutas son relativas y usan hash routing.
3. En Supabase, **Authentication → URL Configuration**: agrega esa URL como *Site URL* o *Redirect URL*.
4. Si publicas desde otro dominio, agrégalo al secret `ALLOWED_ORIGINS` (CORS) y redespliega las funciones.

Cada vez que publiques una versión nueva, sube `VERSION` en `sw.js` para que aparezca el aviso “Hay una nueva versión”.

## Cambiar el nombre de la app
Cambia `APP_NAME` en `js/config.js`, `name` y `short_name` en `manifest.webmanifest`, y `<title>` y `apple-mobile-web-app-title` en `index.html`. Para regenerar los íconos: `npm run icons`.

## Seguridad
- **Públicos (solo en `js/config.js`):** la URL de Supabase, la llave publicable (anon) y la llave pública VAPID.
- **Secretos (solo en `.env.local`, ignorado por git, y en los secrets de Supabase / Vault):** la service role, `GROQ_API_KEY`, la llave privada VAPID, `CRON_SECRET` y el token de acceso.
- **Datos:** todas las tablas tienen RLS y el rol `anon` no tiene permisos.
- **Asistente:** la IA tiene cuota por usuario (20 por minuto y una cuota diaria configurable), CORS con una lista exacta de orígenes y nunca escribe datos: el usuario confirma cada registro.
