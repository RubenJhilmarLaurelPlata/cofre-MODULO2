// src/lib/interop/nonce.ts
// Fase 4.2: abstracción de almacenamiento de nonces ya usados, para
// detectar repeticiones (replay). A propósito NO es un modelo Prisma
// todavía (instrucción explícita de esta fase) — es una interfaz mínima
// que cualquier almacenamiento real (Prisma, Redis, memoria) puede
// implementar más adelante sin tocar verificar.ts.
export interface AlmacenNonceInterop {
  /**
   * Debe devolver `true` la PRIMERA vez que ve este (sucursalCodigo,
   * nonce) — y registrarlo en el mismo paso — y `false` cualquier vez
   * después (nonce repetido). `expiraEn` (segundos desde epoch) es
   * cuándo este registro deja de ser necesario: como cualquier timestamp
   * fuera de la ventana de tolerancia ya se rechaza aparte (ver
   * verificar.ts), un nonce nunca necesita recordarse más allá de esa
   * misma ventana.
   */
  registrarSiEsNuevo(sucursalCodigo: string, nonce: string, expiraEn: number): Promise<boolean> | boolean;
}

/**
 * Implementación por defecto: un Map en memoria del propio proceso.
 * Suficiente para un solo proceso Node de esta instalación (que es como
 * corre hoy Cofre Express — ver PM2/instrucciones de despliegue), pero
 * NO sobrevive un reinicio ni se comparte entre varios procesos/réplicas
 * — documentado explícitamente como limitación de esta fase en README.md
 * y en el punto H) del informe. Fase 4.3 puede reemplazar esto por una
 * implementación respaldada por base de datos sin cambiar verificar.ts,
 * simplemente inyectando otro AlmacenNonceInterop.
 */
export function crearAlmacenNonceEnMemoria(): AlmacenNonceInterop {
  const vistos = new Map<string, number>(); // clave "sucursal:nonce" -> expiraEn (epoch segundos)

  function purgarExpirados(ahora: number) {
    for (const [clave, expiraEn] of vistos) {
      if (expiraEn <= ahora) vistos.delete(clave);
    }
  }

  return {
    registrarSiEsNuevo(sucursalCodigo, nonce, expiraEn) {
      const ahora = Math.floor(Date.now() / 1000);
      purgarExpirados(ahora);
      const clave = `${sucursalCodigo}:${nonce}`;
      if (vistos.has(clave)) return false;
      vistos.set(clave, expiraEn);
      return true;
    },
  };
}

// Instancia compartida por defecto para todo el proceso — ver
// verificarFirmaInterop() en verificar.ts, que la usa si no se inyecta
// otra explícitamente (ej. en tests, donde cada test quiere su propio
// almacén aislado).
export const almacenNonceInteropPorDefecto: AlmacenNonceInterop = crearAlmacenNonceEnMemoria();
