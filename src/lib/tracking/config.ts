// src/lib/tracking/config.ts
// Fase 5.3K: configuracion de ESTA instalacion para hablar con el
// servicio independiente cofre-tracking — solo variables de entorno de
// desarrollo/prueba en esta fase (nunca secretos reales de La Paz/El
// Alto, ver .env.example). Cada instalacion fisica (La Paz, El Alto)
// tiene su propio .env con su propia URL/secreto — nunca uno compartido
// — asi que esto ya soporta "credenciales independientes por sucursal"
// sin necesitar una tabla nueva ni un mapa JSON (a diferencia de
// cofre-tracking, que si necesita distinguir varias sucursales EN UN
// SOLO proceso — aqui cada proceso ES una sola sucursal).
export interface ConfigTracking {
  url: string;
  secreto: string;
}

/**
 * `null` si Tracking no esta configurado todavia en esta instalacion —
 * el llamador (src/lib/tracking/cliente.ts) debe tratarlo como "no se
 * puede enviar todavia" (reintentable mas tarde), nunca como un error
 * fatal.
 */
export function obtenerConfigTracking(): ConfigTracking | null {
  const url = process.env.TRACKING_URL?.trim();
  const secreto = process.env.TRACKING_HMAC_SECRET?.trim();
  if (!url || !secreto) return null;
  return { url, secreto };
}
