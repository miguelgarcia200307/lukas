// Configuración pública del frontend. Aquí NO van secretos: la anon/publishable key y la llave VAPID pública son públicas.
export const APP_NAME = 'Lukas';
export const APP_VERSION = '1.5.0'; // mantener igual a VERSION en sw.js

export const SUPABASE_URL = 'https://hstriyriyvgkpukelxav.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_OjLdR5gu1o3g8ShdaFddvg_H5tA8cV3';
export const VAPID_PUBLIC_KEY = 'BAHUHhAuBcN9ZLw_TM8qFBC24H8Qc68YI-yAD5z-atFP3bksXOrJuboA1wZmayX5hUmyofJPOpGLqOAVZucPdYo';

export const LOCALE = 'es-CO';
export const CURRENCY = 'COP';
export const TIMEZONE = 'America/Bogota';

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
export const MAX_RECORDING_SECONDS = 60;
