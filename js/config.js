// Configuración pública del frontend. Aquí NO van secretos: la anon/publishable key y la llave VAPID pública son públicas.
export const APP_NAME = 'Lukas';
export const APP_VERSION = '1.10.3'; // mantener igual a VERSION en sw.js

export const SUPABASE_URL = 'https://hstriyriyvgkpukelxav.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_OjLdR5gu1o3g8ShdaFddvg_H5tA8cV3';
export const VAPID_PUBLIC_KEY = 'BAHUHhAuBcN9ZLw_TM8qFBC24H8Qc68YI-yAD5z-atFP3bksXOrJuboA1wZmayX5hUmyofJPOpGLqOAVZucPdYo';

export const LOCALE = 'es-CO';
export const CURRENCY = 'COP';
export const TIMEZONE = 'America/Bogota';

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const MAX_RECORDING_SECONDS = 60;

// Cara de Lukas sobre el orbe de voz (js/voice/orb-face.js). Salida de emergencia: FACE_ENABLED = false, o abrir la
// app con ?face=0 (p. ej. …/lukas/?face=0#/inicio). Apagada, el orbe se dibuja píxel por píxel como en la v1.7.1.
export const FACE_ENABLED = true;
// Tamaño de la cara respecto al personaje (1 = mismas proporciones del logo), según el radio del orbe en px:
// grande = hoja de voz (R ≈ 84), mediano = Inicio (R ≈ 58), pequeño = hoja compacta (R ≈ 34). Se interpola entre medidas.
export const FACE_SCALE = { large: 0.8, medium: 0.85, small: 0.95 };
