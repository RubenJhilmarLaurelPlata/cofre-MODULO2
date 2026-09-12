# `src/lib/interop/` — autenticación servidor-a-servidor entre instalaciones

Fase 4.2. Esta carpeta es **solo criptografía y validación** — no define
ningún endpoint, no hace ninguna llamada HTTP real, no toca Prisma ni
`Package`/`Envio`. La wiring real (rutas `/api/interop/*`, resolver el
secreto desde `SucursalDestino`, materializar paquetes) es la Fase 4.3.

## Por qué existe

Cada instalación de Cofre Express (La Paz, El Alto, futuras) tiene su
propia base de datos — nunca se comparten ni se accede a la de otro
directamente (ver auditoría de Fase 4). Cuando dos instalaciones necesiten
hablar por HTTP, cada request debe probar de forma verificable **quién lo
envía** y que **no fue alterado ni repetido en tránsito**. Este módulo
implementa ese esquema, sin acoplarlo a Next.js ni a Prisma: recibe y
devuelve strings/objetos planos, para poder probarse con `vitest` sin
levantar ningún servidor.

## Identidad de cada instalación (Fase 4.1)

Cada fila de `SucursalDestino` (el catálogo de "a qué otra instalación le
hablo") tiene, desde la Fase 4.1, tres campos opcionales:

- `apiUrlSaliente` — URL base de la otra instalación.
- `apiKeySaliente` — secreto que USO YO para firmar cuando LE hablo a esa instalación.
- `apiKeyEntrante` — secreto que ESA instalación debe usar para firmar cuando ME habla a MÍ.

Son direcciones de la llamada HTTP, no del envío físico. Ninguno de los
tres se lee ni se escribe todavía desde este módulo — la Fase 4.3 es
quien los conecta.

## El string canónico

```
METHOD + "\n" +
PATH + "\n" +
TIMESTAMP + "\n" +
NONCE + "\n" +
SHA256(BODY)
```

- **METHOD**: el verbo HTTP en mayúsculas (`POST`, `GET`...).
- **PATH**: el path exacto del request (ej.
  `/api/interop/envios/ENV-20260904-001/recibir`). **Limitación conocida
  de esta fase**: no incluye query string — ningún endpoint de Fase 4.3
  la necesita todavía; si alguna vez hiciera falta, hay que decidir
  explícitamente cómo canonicalizarla (orden de parámetros, encoding) y
  actualizar tanto el firmante como el verificador a la vez.
- **TIMESTAMP**: segundos desde epoch (UTC), como string decimal (ej.
  `"1757600000"`). No milisegundos.
- **NONCE**: un valor opaco único por request (normalmente un UUID v4).
  Nunca vacío — un nonce vacío se rechaza explícitamente (ver más abajo).
- **SHA256(BODY)**: SHA-256 en hexadecimal minúscula del cuerpo crudo del
  request, codificado en UTF-8. Si no hay body (ej. un `GET`), se firma
  el string vacío `""` — que tiene un hash SHA-256 fijo y conocido, nunca
  un caso especial distinto.

Ver `canonical.ts` (`construirCanonicalRequest`, `sha256Hex`).

## La firma

```
HMAC-SHA256(secreto, canonical_string)
```

codificada en **hexadecimal minúscula** — nunca base64. Se eligió hex,
consistente con el hash del body (también hex), por ser más simple de
inspeccionar/comparar en logs de depuración sin ambigüedad de padding.
Ver `firma.ts` (`firmarRequest`).

## Las 4 cabeceras

| Cabecera | Contenido |
|---|---|
| `X-Cofre-Sucursal` | Código de la sucursal EMISORA (ej. `"LPZ"`) |
| `X-Cofre-Timestamp` | El mismo timestamp usado en el canonical string |
| `X-Cofre-Nonce` | El mismo nonce usado en el canonical string |
| `X-Cofre-Signature` | La firma HMAC-SHA256, hex |

El secreto (`apiKeySaliente`/`apiKeyEntrante`) **nunca** viaja en ninguna
cabecera ni en el body — solo se usa localmente, en cada extremo, para
calcular/verificar la firma. Ver `headers.ts` (`crearHeadersInterop`) y
`constantes.ts` para los nombres exactos.

## Verificación de un request entrante

`verificar.ts` (`verificarFirmaInterop`) hace, en este orden:

1. **Sucursal conocida**: lee `X-Cofre-Sucursal`, y le pide al llamador
   (vía el callback `resolverSecreto`, inyectado — este módulo no sabe
   qué es `SucursalDestino`) el `apiKeyEntrante` correspondiente. Sin
   cabecera, o sin secreto configurado para ese código → `SUCURSAL_DESCONOCIDA`.
2. **Timestamp dentro de ventana**: debe ser un entero y estar a menos de
   `VENTANA_TIMESTAMP_SEGUNDOS_DEFAULT` (±5 minutos) del instante actual
   → si no, `TIMESTAMP_INVALIDO`.
3. **Firma válida**: se recalcula el HMAC con el secreto resuelto en el
   paso 1 y se compara **timing-safe** (`compararTimingSafe`, en
   `firma.ts`) contra `X-Cofre-Signature` → si no coincide (o falta),
   `FIRMA_INVALIDA`.
4. **Nonce no repetido**: recién si la firma es válida, se consulta el
   `AlmacenNonceInterop` (ver abajo) → nonce vacío o ya visto,
   `NONCE_INVALIDO`.

El orden es deliberado: verificar la firma ANTES que el nonce evita que
alguien sin el secreto correcto pueda "quemar" nonces ajenos a propósito
(un tipo de denegación de servicio barato).

El resultado es un tipo discriminado (`{ok: true, sucursalCodigo}` o
`{ok: false, motivo}`) — nunca una excepción, y `motivo` nunca incluye el
secreto ni la firma completa.

## Protección contra replay (nonces)

**Esta fase NO agrega un modelo Prisma para esto** (instrucción
explícita) — `nonce.ts` define una interfaz mínima, `AlmacenNonceInterop`,
con un solo método (`registrarSiEsNuevo`), y provee una implementación
por defecto en memoria (`crearAlmacenNonceEnMemoria`/
`almacenNonceInteropPorDefecto`) que alcanza para un solo proceso Node.

**Limitación conocida, para la Fase 4.3**: el almacén en memoria no
sobrevive un reinicio del proceso ni se comparte entre varias réplicas —
si la instalación llegara a correr con más de un proceso Node
simultáneo, un nonce podría "no verse" repetido entre procesos distintos.
Mientras cada instalación corra un solo proceso (como hoy, vía PM2), esto
es correcto. Si eso cambia, `verificarFirmaInterop` ya acepta cualquier
otra implementación de `AlmacenNonceInterop` sin que su propio código
cambie — por ejemplo, respaldada por una tabla nueva o por Redis.

## Comparación timing-safe

`compararTimingSafe` (`firma.ts`) usa `crypto.timingSafeEqual` de Node.
Única excepción documentada: si las dos firmas tienen longitudes
distintas, se devuelve `false` inmediatamente sin comparar contenido
(`timingSafeEqual` exige igual longitud o lanza) — una firma HMAC-SHA256
en hex siempre mide 64 caracteres, así que la longitud en sí no es
información sensible; es el mismo patrón que usan librerías de webhooks
como las de Stripe/GitHub.

## Fase 4.3 — primer endpoint real (solo lectura)

`GET /api/interop/envios/[codigo]` (`src/app/api/interop/envios/[codigo]/route.ts`)
permite que una instalación consulte, de otra, el detalle de un envío ya
`CERRADO`/`RECIBIDO` destinado a ella. Piezas nuevas de esta fase:

- **`adaptador-next.ts`** (`verificarRequestInteropNext`) — único archivo
  de esta carpeta que importa `next/server`; traduce un `NextRequest` real
  a la entrada de `verificarFirmaInterop()`. `req.nextUrl.pathname` nunca
  incluye query string (cumple la regla del canonical string); el body se
  lee UNA sola vez con `req.text()`.
- **`dto.ts`** (`EnvioInteropDTO`) — forma exacta de la respuesta, ver
  comentarios en el propio archivo para qué se excluyó y por qué (nunca
  IDs internos de Prisma, nunca nombres de usuarios/staff).
- **`cliente.ts`** (`consultarEnvioRemoto`) — cliente HTTP saliente
  reutilizable, agnóstico de React/Next/Prisma (`fetch` inyectable para
  pruebas).
- **`src/lib/interop-envios.ts`** (fuera de esta carpeta a propósito —
  conecta el protocolo con Prisma): `resolverApiKeyEntrante()` y
  `getEnvioParaInterop()`, que valida que la sucursal autenticada por HMAC
  sea realmente el destino del envío (si no, `NO_ES_DESTINO` → HTTP 403).

**`qrToken` — decisión explícita de esta fase**: el DTO de este endpoint
de solo consulta **no incluye** `Envio.qrToken`. Se evaluó incluirlo (la
comunicación ya está autenticada por HMAC, así que no sería inseguro
hacerlo) pero se decidió omitirlo: quien consulta este endpoint YA posee
el `qrToken` — acaba de leerlo del QR físico antes de llamar. La
validación real de "¿este QR corresponde a este envío?" queda para la
Fase 4.4 (recepción remota), donde el DESTINO envía de vuelta el
`codigo`+`qrToken` que escaneó al `POST /recibir` del ORIGEN, que lo
compara contra su propio `Envio.qrToken` — el mismo patrón que ya usa hoy
`buscarEnvioParaRecibir()` localmente, ahora por red. Ver `dto.ts` para el
comentario completo.

## Fase 4.4 — recepción remota real (primera escritura entre instalaciones)

`POST /api/interop/envios/[codigo]/recibir`
(`src/app/api/interop/envios/[codigo]/recibir/route.ts`) permite que la
sucursal DESTINO le pida a la sucursal ORIGEN que ejecute, en SU PROPIA
base, la recepción de un envío — exige `{ qrToken }` en el body JSON
(nunca en query string ni headers). Piezas nuevas:

- **`recibirEnvioParaInterop()`** (`src/lib/interop-envios.ts`, lado
  ORIGEN) — valida destino + `qrToken` (timing-safe, vía
  `compararTimingSafe()` reutilizada de `firma.ts`) + estado, y ejecuta
  `recibirEnvio()` (`src/lib/envios.ts`) **tal cual**, sin duplicar su
  lógica. La única adaptación que esa función necesitó fue aceptar
  `userId` opcional (no hay ningún usuario local que haya "hecho clic" en
  una llamada entre instalaciones). Si el envío ya estaba `RECIBIDO`
  (reintento genuino, o perdió una carrera de concurrencia contra una
  request idéntica), devuelve el mismo resultado exitoso sin volver a
  mutar nada — nunca un error.
- **`materializarRecepcionRemota()`** (`src/lib/interop-envios.ts`, lado
  DESTINO) — crea, en UNA transacción, los `Package`/`PackageHistory`
  propios del destino + un `EnvioRecepcionRemota` (Fase 4.1) como guardia
  de idempotencia: se intenta crear ESE registro primero, antes de tocar
  ningún `Package`; si ya existe (choque del índice único sobre
  `transferenciaId`), toda la transacción se corta ahí y se informa
  `yaMaterializada: true` sin duplicar nada. Los `Package` además usan
  `upsert` (nunca `create` ciego) sobre `@@unique([origenSucursalCodigo,
  origenCodigoPaquete])` como segunda capa de defensa. Si CUALQUIER
  paquete del lote falla (ej. su inicial no tiene `PackageSeries`
  configurada en el destino), la transacción entera hace `ROLLBACK` —
  nunca queda un lote a medio materializar.
- **`recibirEnvioRemoto()`** (`cliente.ts`) — cliente HTTP saliente para
  el POST, mismo patrón que `consultarEnvioRemoto()`: firma el body
  EXACTO que se envía (una sola serialización, nunca dos).

**`qrToken` nunca se devuelve** en la respuesta de este endpoint (mismo
criterio que Fase 4.3) — el origen solo lo usa para COMPARAR, nunca para
reenviarlo.

**Pendiente, explícitamente detenido — ver informe de Fase 4.4, punto
F**: `getReservaActivaDePaquete()` (`src/lib/envios.ts`) hoy deja de
bloquear entrega/depósito/denegar en el ORIGEN una vez que su envío pasa
a `RECIBIDO` — correcto mientras origen y destino comparten una sola base
de datos (como corre hoy en producción), pero, con bases realmente
separadas, dejaría la copia de origen operable otra vez mientras una
copia independiente del mismo paquete sigue su propio ciclo de vida en el
destino. Se intentó extender el bloqueo a `RECIBIDO` y se revirtió: rompe
la recepción 100% local existente (confirmado por una regresión real en
`tests/envios.test.ts`), porque el código no distingue si un `RECIBIDO`
llegó por un clic local o por una llamada remota real. Requiere una
decisión de producto antes de implementarse (ver opciones en el informe).

## Qué falta para una fase futura

- Resolver la decisión pendiente de arriba (origen post-`RECIBIDO`).
- Decidir si el almacén de nonces en memoria alcanza para producción o
  si hace falta uno persistente (ver limitación arriba).
- Logging/auditoría de requests de interop, usando `enmascararValorSensible()`
  para nunca imprimir un secreto o firma completos.
- UI de El Alto para disparar la consulta/recepción remota real (ninguna
  fase hasta ahora agregó frontend nuevo, a propósito).
- Tracking público — deliberadamente fuera de alcance de todas las fases de interop hasta ahora.
