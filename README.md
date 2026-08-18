# Cofre Express — v3 (Next.js + TypeScript + Prisma)

Reescritura completa del sistema sobre una arquitectura profesional:
**Next.js 14 (App Router) + TypeScript + Prisma + Tailwind**, con
autenticación real (JWT + bcrypt), 5 roles con permisos por módulo, y
base de datos normalizada preparada para cientos de miles de paquetes.

## 🔧 Corrección post-Módulo 2 (antes de seguir con Depósito)

Al correr `npx prisma db push` diste con un error real de arquitectura:
**SQLite no soporta enums nativos de base de datos**, y yo había definido
`enum Role` y `enum PackageStatus` en el schema. Eso hacía fallar la
generación del cliente de Prisma por completo (`P1012`), lo que a su vez
provocaba **los otros 24 errores de TypeScript en cascada** — no eran 26
problemas distintos, era básicamente uno solo con muchos síntomas.

**Qué cambié:**
- `role` y `status`/`estado` ahora son `String` en `prisma/schema.prisma`
  (con comentarios explicando por qué, y cómo volverlos `enum` real si
  algún día migran a PostgreSQL).
- `Role` y `PackageStatus` ahora se definen a mano en
  `src/types/index.ts` — es el único lugar del proyecto donde existen,
  todo lo demás los importa de ahí en vez de `@prisma/client`.
- Donde Prisma entrega el valor crudo como `string` (por ejemplo,
  `groupBy` en el dashboard), lo convierto explícitamente al tipo
  correcto en ese punto exacto, para que el resto del código siga
  trabajando con el tipo seguro de 5 valores, no con `string` libre.
- Aparte de esa cascada, encontré **un bug real e independiente** en
  `camera-scanner.tsx`: asumí que `decodeFromConstraints` devolvía los
  controles de la cámara como valor de retorno, pero el compilador
  reveló que en la versión instalada los entrega por el tercer parámetro
  del callback. Ya corregido.

Si quieres ver exactamente qué cambió, todos los archivos tocados están
documentados abajo en el historial de módulos.

## ⚠️ Estado del proyecto: Módulo 7 de 8 (Fundaciones + Recepción + Entrega + Depósito + Buscador + Etiquetas + Reportes + Configuración)

**Módulo 7 (Configuración) — el más grande hasta ahora, recién agregado, pendiente de que lo pruebes:**

Página `/configuracion` (solo Administrador), con 13 pestañas:

- **Empresa**: nombre, logo (se sube como imagen y se guarda como
  `data:` URL en `Company.logoUrl`, máximo ~500KB — no depende de
  ningún sistema de archivos ni servicio externo), dirección, teléfono,
  correo, sitio web, ciudad, país, horario. Ya los usan Reportes, el PDF
  de Etiquetas y los encabezados/pies de página.
- **Usuarios**: crear, editar (nombre/rol), desactivar/reactivar,
  bloquear/desbloquear manualmente, restablecer contraseña, buscar y
  filtrar por rol/estado. Estado calculado (Activo/Inactivo/Bloqueado),
  con último acceso y último inicio de sesión — este último es un campo
  nuevo, `ultimoLoginAt`, separado de `ultimoAccesoAt` (que ahora se usa
  para medir inactividad real, no solo el login).
- **Roles y permisos**: solo informativo — lee directamente
  `PERMISOS_POR_MODULO` de `src/types/index.ts` (la misma fuente que ya
  usa el middleware), sin ninguna lógica nueva ni forma de editar
  permisos individuales, tal como se pidió.
- **Tarifas**: tarifa base, días incluidos, costo adicional diario — los
  mismos campos que ya usa `pricing.ts`; un cambio aquí se aplica al
  siguiente paquete que se registre, lo probé en vivo.
- **Feriados**: agregar, editar, eliminar, buscar y una importación
  masiva (pegas líneas `fecha,nombre`). Los usa `calcularCosto` de
  inmediato, sin tocar esa lógica.
- **Meses**: reutiliza literalmente el mismo componente
  (`MesLetrasConfig`) y la misma API (`/api/etiquetas/mes-letras`) del
  Módulo 5 — le agregué una prop `sinColapsar` para que se vea siempre
  expandido aquí, sin duplicar nada.
- **Tipos de código**: administra `PackageSeries` (M, S, P, L, X…),
  incluyendo la "tarifa especial" por tipo. Eliminar solo funciona si el
  tipo nunca se usó (lo verifiqué contra `Package` y `GeneratedCode`
  reales); si ya se usó, hay que desactivarlo en su lugar.
- **Respaldos**: "Crear respaldo completo" copia el archivo real de
  SQLite a `data/backups/` (ruta ya prevista en `.gitignore`, no
  accesible por URL), registra fecha/hora/usuario/tamaño/estado en una
  tabla nueva, y se puede descargar. Dejé la arquitectura lista para una
  restauración automática futura (el nombre exacto de archivo de cada
  respaldo queda guardado), pero esa restauración todavía no está
  implementada, tal como se pidió.
- **Preferencias**: idioma, zona horaria, formato de fecha/hora, y un
  interruptor de sonidos que **de verdad silencia** `playSound` en todo
  el sistema (Recepción, Depósito, etc.) — lo aplico con un pequeño
  sincronizador en el layout autenticado, para que no fuera un botón sin
  efecto real.
- **Seguridad**: tiempo máximo de sesión (ahora configurable en el JWT,
  antes era una constante fija), tiempo máximo de inactividad + cierre
  automático (ambos aplicados en tiempo real dentro de `getSession()`,
  no solo al reiniciar el servidor), máximo de intentos de login y
  tiempo de bloqueo — probé el bloqueo automático de verdad: al tercer
  intento fallido la cuenta quedó bloqueada, y ni siquiera la contraseña
  correcta funcionó hasta desbloquearla.
- **Auditoría**: tabla nueva `AuditLog` (usuario, IP, navegador, acción,
  módulo, valor anterior/nuevo), con búsqueda y filtros. Queda registrada
  desde login/logout, cambios de estado de paquetes (lo agregué una sola
  vez dentro de la función compartida `transicionar()` en
  `package-transitions.ts`, así cubre Entrega y Depósito sin repetir la
  llamada en 6 archivos distintos), generación/reimpresión de etiquetas,
  cambio de letras de mes, generación de reportes, y toda la propia
  Configuración.
- **Notificaciones**: no es una tabla nueva — es una vista filtrada del
  mismo `AuditLog` para los eventos que ameritan atención (bloqueos,
  intentos fallidos, respaldos, cambios de configuración), para no
  duplicar el dato.
- **Mantenimiento**: solo lectura — versión del sistema/Next.js/Prisma
  (leídas de los `package.json` reales instalados, no inventadas),
  conexión a la base de datos, conteo de registros por tabla, espacio en
  disco ocupado por el archivo `.db`, y fecha del último respaldo. Sin
  ninguna acción peligrosa disponible desde ahí.

**Un par de ajustes a módulos ya terminados, mínimos y justificados:**
- `dashboard-data.ts` y `package-detail.ts` tenían casi la misma lógica
  de "hasta qué fecha se congela el costo" duplicada en dos archivos —
  ahora `dashboard-data.ts` reutiliza la de `package-detail.ts`
  (`fechaReferencia`, ahora exportada).
- El Buscador tenía su propio filtro de texto (código/remitente/
  destinatario/teléfonos/observaciones) escrito inline — lo extraje a
  `construirFiltroTextoPaquete` en `package-detail.ts`, y ahora tanto el
  Buscador como los Reportes lo importan de ahí.
- Agregué `print:hidden` a Sidebar/Topbar y ajusté el `overflow-hidden`
  del layout autenticado — sin esto, el botón "Imprimir" de Reportes
  (Módulo 6) habría recortado el contenido a lo que cabía en pantalla en
  vez de imprimir el reporte completo.

## ⚠️ Estado del proyecto: Módulo 6 de 8 (Fundaciones + Recepción + Entrega + Depósito + Buscador + Etiquetas + Reportes)

**Módulo 6 (Reportes) — recién agregado, pendiente de que lo pruebes:**

- Página `/reportes` (Administrador y Supervisor): un centro de reportes
  real, no un botón de exportar — un filtro compartido (Hoy, Ayer, Esta
  semana, Este mes, Fecha específica, Rango de fechas + estado + usuario
  + tipo/inicial + búsqueda de texto libre) que aplica a 5 reportes:
  **Paquetes**, **Financiero**, **Operadores**, **Depósito** y
  **Etiquetas**. Cada uno con su resumen, su gráfica y sus tablas,
  calculados siempre contra la base de datos real (sin datos de ejemplo).
- **Exportación real** en PDF (`pdf-lib`, hoja carta horizontal con logo
  de Cofre Express, nombre del reporte, fecha, usuario, numeración de
  página y pie de página), Excel (`exceljs`, hojas separadas con
  encabezados de color, autofiltro y ancho de columna) y CSV (UTF-8 con
  BOM, se abre bien en Excel) — las tres respetan exactamente los
  filtros que tengas puestos en pantalla.
- **Impresión directa**: el botón "Imprimir" usa el `window.print()` del
  navegador; la barra lateral, la topbar y los filtros se ocultan solo
  en la hoja impresa (agregué `print:hidden` a Sidebar/Topbar y ajusté el
  layout para que no recorte el contenido al imprimir).
- **Historial de reportes** (auditoría): cada exportación (PDF, Excel o
  CSV) queda registrada en una tabla nueva, `ReportLog` — quién, cuándo,
  qué filtros y en qué formato — consultable desde la pestaña
  "Historial" del propio módulo.
- Para el Reporte de Operadores agregué `User.ultimoAccesoAt` (se
  actualiza en cada login) y, para el de Etiquetas, `GeneratedCode.vecesReimpreso`
  (se incrementa cada vez que un código se resuelve desde la pestaña
  Reimprimir de Etiquetas) — ambos campos no existían antes porque
  ningún módulo anterior los necesitaba.
- **Nada de esto duplica lógica ya escrita**: exporté `fechaReferencia`
  y `sumarCosto` (antes vivían separados, casi idénticos, en
  `package-detail.ts` y `dashboard-data.ts`; ahora `dashboard-data.ts`
  reutiliza `fechaReferencia` en vez de repetir el mismo `if`), extraje
  el filtro de texto del Buscador a `construirFiltroTextoPaquete` (el
  Buscador ahora lo importa en vez de tener su propia copia), y extraje
  el listado de lotes de Etiquetas a `buscarLotes` (usado tanto por la
  pantalla de Etiquetas como por el Reporte de Etiquetas).

## ⚠️ Estado del proyecto: Módulo 5 de 8 (Fundaciones + Recepción + Entrega + Depósito + Buscador + Etiquetas)

**Módulo 5 (Etiquetas) — recién agregado, pendiente de que lo pruebes:**

- Página `/etiquetas` (Administrador y Recepción) con tres pestañas:
  **Generar** (solo Administrador), **Reimprimir** e **Historial**.
- **Formato del código**: `{inicial}{día a 2 dígitos}{letra del mes}-{consecutivo}`,
  ej. `M24J-1` (M = tipo, 24 = día, J = letra de junio, 1 = consecutivo).
  El consecutivo **no lleva ceros a la izquierda**, tal como se pidió.
- **Letra de cada mes**: 100% configurable, tabla nueva `MonthLetter` (12
  filas), nunca codificada en el sistema — panel "Letra de los meses"
  dentro de Generar, solo para Administrador.
- **Tipo (inicial) sin límites**: si escribes una inicial que no existe
  todavía como serie (`PackageSeries`), el sistema la crea sola al
  generar el lote — no hace falta una pantalla de configuración aparte
  para eso.
- **Fecha**: Hoy, Mañana, Fecha específica, Semana completa (domingo a
  sábado, igual que el dashboard) o Rango de fechas. En lotes de varios
  días, cada día recibe "cantidad por día" etiquetas y el consecutivo
  sigue una sola secuencia continua a través de todos los días.
- **Consecutivo**: "Continuar lote" propone automáticamente
  `último usado + 1` para la inicial elegida (nuevo campo
  `PackageSeries.correlativo`, que ya existía sin usarse); "Nuevo lote"
  lo resetea para que escribas cualquier número a mano.
- **Validación real contra la base de datos**: antes de crear un solo
  código, se verifica que ninguno de los que se van a generar exista ya
  en `GeneratedCode` ni en `Package` (activo, entregado o denegado). Si
  hay colisión, no se genera nada y se explica cuáles chocan.
- **PDF profesional** (`pdf-lib` + `bwip-js`, tabla nueva `LabelBatch`
  para el historial de lotes): hoja carta, márgenes estrechos,
  exactamente 30 etiquetas por hoja (3 columnas × 10 filas), paginación
  automática para lotes más grandes. Cada etiqueta: código en texto
  grande, código de barras Code128 (1D, nunca QR) más pequeño pero
  perfectamente legible, y la fecha correspondiente a esa etiqueta
  puntual (no la fecha de generación del lote).
- **Vista previa en vivo** antes de descargar, renderizada en el
  navegador con la misma librería de barras (`bwip-js`) que usa el PDF,
  para que se vea igual a lo que se va a imprimir.
- **Reimprimir**: por código específico, por rango (ej. `M24J-150` hasta
  `M24J-180`) o por una lista de varios códigos sueltos — siempre
  leyendo los códigos reales ya generados, nunca recreándolos.
- **Historial de lotes**: buscar por observaciones/usuario, filtrar por
  inicial y por fecha de generación, reimprimir cualquier lote anterior
  con un clic, y "Duplicar" (lleva sus datos a la pestaña Generar,
  dejando que cambies solo la fecha o el consecutivo, como se pidió).
- Reutiliza `getCompanyConfig()` para el separador (`Company.formatoSeparador`,
  ya existía sin usarse) y no toca ninguna regla de tarifas/estados de
  paquete ya implementada.

## ⚠️ Estado del proyecto: Módulo 4 de 8 (Fundaciones + Recepción + Entrega + Depósito + Buscador)

**Módulo 4 (Buscador) — recién agregado, pendiente de que lo pruebes:**

- Página `/buscador` (Administrador, Supervisor, Entrega y Consulta).
- Un solo campo de texto busca a la vez por código completo o parcial,
  remitente, destinatario, teléfono (remitente o destinatario) y
  observaciones — combinable con un filtro de estado y un rango de
  fechas de ingreso ("desde" / "hasta").
- Búsqueda en vivo con debounce de 300ms mientras se escribe, y
  búsqueda instantánea al presionar Enter (compatible con lector de
  código de barras USB, igual que Recepción/Depósito). También se puede
  buscar con la cámara del celular reutilizando el mismo componente
  `CameraScanner` de Recepción (Code128 1D, nunca QR) — sin duplicar esa
  lógica.
- Si no hay ningún filtro activo, se muestran los 20 paquetes más
  recientes; con filtros, hasta 60 resultados (avisa si hay más y pide
  afinar la búsqueda).
- Tarjetas de resultado responsive (1 columna en celular, 2 en tablet, 3
  en escritorio) con código, estado, remitente, destinatario, fecha de
  ingreso, días almacenado, costo actual y observaciones.
- Desde cada tarjeta: **Detalle** (modal con todas las fechas, teléfonos
  y costo), **Historial** (línea de tiempo completa de
  `PackageHistory`), **Entrega** (lleva a `/entrega?code=...`, que
  precarga el paquete sin que el operador tenga que volver a escribirlo)
  y **Enviar a depósito** (ejecuta la transición ahí mismo, sin salir
  del Buscador). Los últimos dos botones solo aparecen si el rol de la
  sesión tiene acceso a esos módulos.
- Nada de esto duplica lógica: la búsqueda es una consulta nueva, pero
  el cálculo de costo reutiliza `package-detail.ts` (al que le agregué
  `toPackageDetailDTOList`, para traer la configuración de tarifas y
  feriados una sola vez por búsqueda en vez de una vez por paquete), y
  "Enviar a depósito" reutiliza literalmente el mismo endpoint
  `/api/deposito/enviar` del Módulo 3.

## ⚠️ Estado del proyecto: Módulo 3 de 8 (Fundaciones + Recepción + Entrega + Depósito)

**Módulo 3 (Depósito) — recién agregado, pendiente de que lo pruebes:**

- Página `/deposito` (Administrador, Entrega y Recepción).
- Pestaña **"Enviar a depósito"**: input de escaneo continuo igual que
  Recepción — cada código pasa automáticamente de "En Paquetería" a
  "En Depósito", sin confirmar uno por uno, con historial de la sesión.
- Pestaña **"Bajar de depósito"**: lista en vivo de los paquetes
  "Pendiente de bajar" (con botón "Actualizar" para refrescarla si otro
  dispositivo solicitó bajar algo mientras esta pantalla ya estaba
  abierta) + un input de escaneo para confirmar que un paquete ya se
  bajó físicamente, que lo devuelve a "En Paquetería".
- Reutiliza `enviarADeposito` y `bajarDeDeposito` de
  `src/lib/package-transitions.ts` (esta última ya existía, escrita para
  este módulo desde Entrega, pero sin endpoint ni pantalla hasta ahora) —
  no se duplicó ninguna regla de transición de estado.
- De paso corregí un bug real e independiente que encontró `tsc` en
  `camera-scanner.tsx` (Módulo 1): la versión instalada de
  `@zxing/library` no entrega los controles de la cámara por un tercer
  parámetro del callback como asumía el comentario anterior — ese
  callback solo recibe `(result, error)`. Ahora se detiene la cámara
  guardando la instancia del lector (`reader.reset()`), que es la API
  real de esta versión. También corregí un error de tipos en
  `api/auth/login/route.ts` (`user.role` como `string` de Prisma no
  encajaba con el tipo `Role` de 5 valores — mismo patrón de conversión
  explícita que ya se usaba en el dashboard).

**Módulos 0, 1 y 2 — verificados por ti, funcionan.**

**Módulo 2 (Entrega) — recién agregado, pendiente de que lo pruebes:**

- Página `/entrega` (solo Administrador y Entrega).
- Buscador de un solo código (compatible con lector USB, igual que
  Recepción: siempre enfocado, Enter dispara la búsqueda).
- Tarjeta grande con código, cliente (destinatario/teléfono, editable),
  costo acumulado, estado, observaciones editables.
- Botones grandes y contextuales según el estado del paquete: Entregar,
  Enviar a depósito, Solicitar bajar de depósito, Denegar.
- **Confirmación de entrega con cuenta regresiva 5-4-3-2-1**: al pulsar
  "Entregar" aparece la pantalla de confirmación; si nadie cancela en 5
  segundos, se registra la entrega automáticamente (actualiza estado,
  historial y el contador del dashboard).
- Denegar pide una confirmación simple (no tiene cuenta regresiva, según
  se pidió solo para Entregar).
- Refactoricé la lógica de transición de estados
  (`src/lib/package-transitions.ts`) para que Entrega y el próximo módulo
  de Depósito compartan exactamente las mismas reglas en vez de
  duplicarlas.

Nada de este módulo depende de la cámara, así que si algo falla aquí es
más fácil de aislar que en Recepción.

## ⚠️ Riesgos conocidos acumulados (vigentes en todas las entregas)

- **Cámara de Recepción (Módulo 1)**: sigue sin poder probarse en este
  entorno. Los navegadores **bloquean la cámara en cualquier sitio sin
  HTTPS**, excepto `localhost`. Si despliegan en un dominio propio,
  necesita SSL o la opción de cámara nunca aparecerá (el lector USB no
  se ve afectado por esto).
- **Sin enum nativo en la base de datos**: como `role` y `status` ahora
  son `String` en SQLite, la base de datos ya no impide por sí sola que
  se escriba un valor fuera de los 5 permitidos — esa validación vive en
  el código de la aplicación (TypeScript + los `if` de cada endpoint), no
  en la base de datos. Es una limitación conocida y aceptable de SQLite;
  si migran a PostgreSQL en el futuro, se puede volver a un enum real de
  base de datos.



## ⚠️ Importante: no pude ejecutar `npm install` / `tsc` / `eslint` aquí

El entorno donde generé este proyecto no tiene acceso a internet, así que
no pude instalar dependencias ni correr el compilador de TypeScript ni
ESLint para verificar el código antes de entregarlo. Revisé cada archivo
manualmente con mucho cuidado, pero en un proyecto TypeScript + Prisma el
compilador puede encontrar cosas que un ojo humano no. **Necesito que
corras exactamente esta secuencia y me pegues cualquier error tal cual
aparece:**

**Importante:** usa esta carpeta nueva descomprimida desde cero (no la
reemplaces encima de la carpeta `cofre-express-MODULO2` que ya tenías) —
así evitas mezclar el `node_modules` o algún archivo parcial que haya
quedado del intento anterior que falló en `prisma db push`.

```bash
cd cofre-express-next
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run typecheck
npm run lint
npm run dev
```

Luego entra como `recepcion1 / recepcion123`, ve a **Recepción**, y prueba:
1. Escribe un código a mano (ej. `M26L-001`) y presiona Enter — debe
   registrarse, sonar y aparecer en el historial de la sesión.
2. Repite el mismo código — debe rechazarlo como duplicado (sonido
   distinto).
3. Prueba un código con una inicial no configurada (ej. `Z99L-001`) —
   debe explicarte que esa serie no existe.
4. Dale clic a "Activar cámara" y apunta a un código de barras Code128
   real (impreso o en pantalla) — este es el paso que más me interesa
   que confirmes.

Después entra como `entrega1 / entrega123`, ve a **Entrega**, y prueba:
1. Busca el código `M26L-001` que registraste en Recepción — debe
   mostrar la tarjeta grande con sus datos.
2. Edita el destinatario/teléfono/observaciones y guarda — debe
   persistir.
3. Presiona "Entregar" — debe aparecer la cuenta regresiva 5-4-3-2-1.
   Prueba **cancelar** una vez (no debe registrar nada) y luego
   entregarlo de verdad dejando que el contador llegue a 0.
4. Registra otro código y pruébale "Enviar a depósito" — debe cambiar de
   estado y ofrecerte "Solicitar bajar de depósito".
5. Prueba "Denegar" en otro paquete — debe pedir confirmación simple
   (sin cuenta regresiva) antes de denegarlo.

Después entra como `admin / admin123` (o `recepcion1` / `entrega1`), ve a
**Depósito**, y prueba:
1. En la pestaña "Enviar a depósito", escribe el código de un paquete
   "En Paquetería" y presiona Enter — debe pasar a "En Depósito" y sonar.
2. Desde **Entrega**, busca ese mismo código y presiona "Solicitar bajar
   de depósito" — debe pasar a "Pendiente de bajar".
3. Vuelve a **Depósito**, pestaña "Bajar de depósito" — el paquete debe
   aparecer en la lista de pendientes (usa "Actualizar" si no lo ves).
4. Escribe ese código en el input de esa pestaña y presiona Enter — debe
   desaparecer de la lista y confirmar que volvió a "En Paquetería".
5. Intenta bajar un código que no está pendiente — debe rechazarlo con
   un mensaje claro, sin cambiar nada.

Después entra como `admin / admin123` (o `supervisor1`), ve a
**Buscador**, y prueba:
1. Sin escribir nada, deben aparecer los paquetes más recientes.
2. Escribe parte de un código (ej. `BUSCA` si registraste algo así) —
   debe filtrar solo, sin recargar la página, mientras escribes.
3. Busca por el destinatario, el teléfono o una palabra de las
   observaciones que hayas guardado desde Entrega — cada uno debe
   encontrar el mismo paquete.
4. Filtra por estado y por rango de fechas (por separado y combinados
   con el texto) — deben acotar los resultados en vivo.
5. En una tarjeta, prueba "Detalle" (todas las fechas y teléfonos) y
   "Historial" (línea de tiempo) — deben abrir el mismo modal en
   pestañas distintas.
6. Con el rol `entrega1`, prueba el botón "Entrega" de una tarjeta —
   debe llevarte a `/entrega` con el paquete ya cargado, sin tener que
   volver a escribir el código.
7. Con un paquete "En Paquetería", prueba "Enviar a depósito" desde la
   propia tarjeta — debe cambiar de estado ahí mismo, sin salir del
   Buscador.
8. Entra como `consulta1` — debe poder buscar, pero **no** debe ver los
   botones "Entrega" ni "Enviar a depósito" (ese rol no tiene acceso a
   esos módulos).

Después entra como `admin / admin123`, ve a **Etiquetas**, y prueba:
1. Pestaña "Generar": elige un tipo existente (S, M, L o X), deja la
   fecha en "Hoy", cantidad 5, consecutivo 1, y genera — deben aparecer
   5 etiquetas con formato `{inicial}{día}{letra del mes}-{consecutivo}`
   (ej. si hoy es 5 de agosto y agosto = G, `M05G-1` … `M05G-5`).
2. Escribe una inicial que no exista (ej. `Z`) — debe avisarte que se
   creará como serie nueva, y generar igual sin error.
3. Presiona "Descargar PDF" — debe bajar un PDF de una hoja carta con
   las etiquetas en una grilla de 3×10, código grande arriba, código de
   barras al medio y fecha abajo.
4. Genera un lote de 35 etiquetas — el PDF debe traer 2 páginas (30 en
   la primera, 5 en la segunda).
5. Vuelve a generar para el mismo tipo y presiona "Continuar lote" —
   debe proponer automáticamente el consecutivo siguiente al último que
   generaste, sin que lo calcules a mano.
6. Intenta generar con un consecutivo que ya usaste — debe rechazarlo
   explicando qué códigos ya existen, sin crear nada.
7. Prueba "Semana completa" y "Rango de fechas" — deben generarse
   etiquetas con el día correcto para cada fecha dentro del período,
   manteniendo un solo consecutivo continuo.
8. Abre "Letra de los meses", cambia una letra y guarda — los lotes
   nuevos deben usar la letra nueva; los códigos ya generados no cambian.
9. Ve a la pestaña "Reimprimir": busca por un código específico, por un
   rango (ej. las primeras 3 de un lote que generaste) y por una lista
   de varios códigos sueltos — cada modo debe encontrar y permitir
   descargar el PDF de justo esos códigos.
10. Ve a "Historial": debes ver los lotes generados, poder buscarlos y
    filtrarlos por inicial y fecha, reimprimir cualquiera con un clic, y
    "Duplicar" uno (debe llevarte a Generar con esos datos precargados).
11. Entra como `recepcion1` — debe poder abrir Etiquetas, reimprimir y
    ver el historial, pero **no** debe existir la pestaña "Generar".

Después entra como `admin / admin123` (o `supervisor1`), ve a
**Reportes**, y prueba:
1. Con el filtro en "Hoy", cambia entre las pestañas Paquetes,
   Financiero, Operadores, Depósito y Etiquetas — cada una debe mostrar
   su resumen, su gráfica y su tabla con datos reales (no en cero si ya
   registraste paquetes hoy en los módulos anteriores).
2. Cambia el período a "Rango de fechas" y elige un rango de varios
   días — los números deben cambiar de forma consistente con lo que ya
   viste en Buscador/Dashboard.
3. Filtra por estado, por usuario y por tipo (combinados) — cada
   combinación debe acotar los resultados en la pestaña activa.
4. Escribe algo en "Buscar" (un código, un remitente, una observación)
   — debe filtrar igual que en el Buscador.
5. En la pestaña Paquetes, descarga el PDF — debe verse profesional,
   hoja horizontal, con el logo de Cofre Express, fecha, tu nombre,
   numeración de página y pie de página.
6. Descarga el Excel del mismo reporte — ábrelo en Excel o LibreOffice:
   debe tener una hoja "Resumen" y una hoja por tabla, con encabezados
   de color y autofiltro.
7. Descarga el CSV — ábrelo en Excel: los acentos deben verse bien (no
   caracteres raros).
8. Presiona "Imprimir" — en la vista previa de impresión no debe
   aparecer la barra lateral ni los filtros, solo el contenido del
   reporte.
9. Ve a la pestaña "Historial" — debe listar las exportaciones que
   acabas de hacer, con tu usuario, la fecha/hora y los filtros usados.
10. Entra como `recepcion1` o `entrega1` — no debe poder entrar a
    `/reportes` en absoluto (ese módulo es solo Administrador y
    Supervisor).

Después entra como `admin / admin123`, ve a **Configuración**, y prueba:
1. Pestaña "Empresa": cambia el nombre, sube un logo, completa
   dirección/teléfono — guarda y confirma que el logo se ve en la
   vista previa.
2. Pestaña "Usuarios": crea un usuario de prueba, edítale el nombre y
   el rol, bloquéalo manualmente (debe rechazar el login incluso con la
   contraseña correcta), desbloquéalo, desactívalo (el login debe
   fallar), reactívalo, y restablécele la contraseña.
3. Provoca un bloqueo automático: en la pestaña "Seguridad" baja el
   máximo de intentos a 2 o 3, y luego intenta iniciar sesión con ese
   usuario de prueba con la contraseña equivocada esa cantidad de veces
   — debe bloquearse solo, y aparecer como "Bloqueado" en Usuarios.
4. Pestaña "Roles y permisos": debe verse la tabla de los 5 roles ×
   módulos, sin ningún control para editarla.
5. Pestaña "Tarifas": cambia la tarifa base y registra un paquete nuevo
   en Recepción — el costo debe reflejar el cambio de inmediato.
6. Pestaña "Feriados": agrega uno, edítalo, impórtalos pegando varias
   líneas `fecha,nombre`, y elimina alguno.
7. Pestaña "Meses": debe ser la misma pantalla de letras de mes que ya
   viste en Etiquetas, ahora siempre expandida.
8. Pestaña "Tipos de código": crea un tipo nuevo y elimínalo (debe
   funcionar, nunca se usó); intenta eliminar "M" — debe rechazarlo
   porque ya tiene paquetes reales, y sugerirte desactivarlo en su lugar.
9. Pestaña "Respaldos": crea uno y descárgalo — ábrelo con
   `sqlite3 archivo.db` o una herramienta de SQLite para confirmar que
   es una base de datos válida.
10. Pestaña "Preferencias": desactiva los sonidos y registra un paquete
    en Recepción — no debe sonar nada (antes sí sonaba).
11. Pestaña "Auditoría": busca y filtra por módulo — deben aparecer los
    cambios que acabas de hacer en esta misma sesión de pruebas.
12. Pestaña "Notificaciones": deben aparecer el bloqueo, los intentos
    fallidos y el respaldo que generaste.
13. Pestaña "Mantenimiento": revisa que las versiones y los conteos de
    registros coincidan con la realidad de tu base de datos.
14. Entra como `supervisor1` o `recepcion1` — no debe poder entrar a
    `/configuracion` en absoluto (ese módulo es solo Administrador).

Si cualquiera de esos comandos o pasos falla, copia el error completo y
lo corrijo en la siguiente entrega.

## Usuarios de prueba (creados por `npm run db:seed`)

| Usuario       | Contraseña     | Rol            |
|---------------|----------------|----------------|
| admin         | admin123       | Administrador  |
| supervisor1   | supervisor123  | Supervisor     |
| recepcion1    | recepcion123   | Recepción      |
| entrega1      | entrega123     | Entrega        |
| consulta1     | consulta123    | Consulta       |

Cambia estas contraseñas antes de producción (el cambio de contraseña
propio se implementa en el módulo de Configuración).

## Decisiones técnicas y por qué

- **SQLite como base de datos por defecto** (vía Prisma): cero
  configuración, el archivo se crea solo, y soporta con margen el volumen
  que manejan (miles de paquetes por semana, años de historial). Migrar a
  PostgreSQL en el futuro es cambiar una línea en `prisma/schema.prisma`
  (`provider = "postgresql"`) y la `DATABASE_URL` — el resto del código
  no cambia, porque todo pasa por Prisma.
- **`jose` en vez de `jsonwebtoken`** para firmar/verificar la sesión: el
  middleware de Next.js corre en el runtime **Edge**, que no soporta las
  APIs de Node que usa `jsonwebtoken`. `jose` sí es compatible con Edge.
- **Historial en tabla separada** (`PackageHistory`), no como JSON dentro
  del paquete: así se puede indexar y consultar de forma eficiente incluso
  con millones de filas.
- **Sucursal (`Branch`) como entidad propia desde el día 1**, no un campo
  suelto: para cuando abran más de una sucursal, no hace falta rediseñar
  nada, solo agregar filas y un selector en la interfaz.
- **Colores**: usé un naranja institucional estándar (`#F2660F`) como
  base de la paleta. Si Cofre Express tiene un código de color de marca
  específico (hex exacto del logo/manual de marca), dímelo y lo ajusto en
  un solo lugar (`tailwind.config.ts`) — no está hardcodeado en ningún
  otro archivo.

## Estructura del proyecto

```
cofre-express-next/
├── prisma/
│   ├── schema.prisma       Esquema completo de base de datos
│   └── seed.ts              Datos iniciales (usuarios, sucursal, config, feriados, series)
├── src/
│   ├── middleware.ts         Protección de rutas y APIs por sesión y por rol
│   ├── lib/
│   │   ├── prisma.ts          Cliente Prisma (singleton)
│   │   ├── auth.ts            JWT + bcrypt
│   │   ├── config.ts          Configuración de empresa + feriados
│   │   ├── pricing.ts         Cálculo de tarifas y días de almacenamiento
│   │   ├── package-detail.ts  DTO de paquete + costo (compartido entre módulos)
│   │   ├── package-transitions.ts  Reglas de cambio de estado (compartido)
│   │   ├── etiquetas.ts       Formato de código, fechas de lote, generación atómica
│   │   ├── etiquetas-pdf.ts   PDF de etiquetas (pdf-lib + bwip-js, 30 por hoja)
│   │   ├── reportes.ts        Los 5 reportes + filtros compartidos + auditoría (ReportLog)
│   │   ├── reportes-export.ts PDF/Excel/CSV de cualquier reporte (pdf-lib + exceljs)
│   │   ├── auditoria.ts       Registro y búsqueda de AuditLog + notificaciones
│   │   ├── usuarios.ts        Estado derivado (Activo/Inactivo/Bloqueado) + DTO
│   │   ├── respaldos.ts       Copia real del .db, listar, descargar
│   │   ├── mantenimiento.ts   Info real del sistema (versiones, conteos, espacio)
│   │   ├── dashboard-data.ts  Consultas del dashboard
│   │   ├── nav-items.ts       Navegación compartida (sidebar + menú móvil)
│   │   ├── sound.ts           Sonidos diferenciados (éxito/depósito/duplicado/error)
│   │   └── utils.ts           Helper cn() para clases Tailwind
│   ├── types/index.ts        Roles, permisos por módulo, tipos de sesión
│   ├── components/
│   │   ├── ui/                 Button, Card, Badge, Input, StatusBadge
│   │   ├── layout/              Sidebar, Topbar, MobileNav, SoundPreferenceSync
│   │   ├── dashboard/            StatCard, WeeklyChart, RecentActivity
│   │   ├── recepcion/             RecepcionClient, CameraScanner (Code128 1D)
│   │   ├── entrega/                EntregaClient, DeliveryCountdown (5-4-3-2-1)
│   │   ├── deposito/                 DepositoClient (enviar / bajar de depósito)
│   │   ├── buscador/                   BuscadorClient, PackageDetailModal (detalle + historial)
│   │   ├── etiquetas/                    EtiquetasClient (Generar/Reimprimir/Historial), LabelPreview
│   │   ├── reportes/                       ReportesClient, ReportView, ReportChart, ReportTable
│   │   └── configuracion/                    13 pestañas (empresa, usuarios, roles, tarifas…)
│   └── app/
│       ├── login/                Login (server page + form cliente)
│       ├── (app)/                 Área autenticada (sidebar + topbar)
│       │   ├── dashboard/           Dashboard con datos reales
│       │   ├── recepcion/           Registro de paquetes (USB + cámara)
│       │   ├── entrega/              Buscar, entregar, denegar, depósito
│       │   ├── deposito/              Enviar / bajar de depósito
│       │   ├── buscador/               Búsqueda combinada + acciones rápidas
│       │   ├── etiquetas/                Generar / reimprimir / historial de lotes
│       │   ├── reportes/                   Paquetes/Financiero/Operadores/Depósito/Etiquetas
│       │   └── configuracion/                Panel completo (solo Administrador)
│       └── api/
│           ├── auth/                Rutas de login/logout
│           ├── recepcion/scan/       Registro atómico de paquetes
│           ├── entrega/[code]/       Buscar/editar/entregar/denegar/depósito
│           ├── deposito/             Enviar / bajar / listar pendientes
│           ├── buscador/             Búsqueda combinada + historial por código
│           ├── etiquetas/            Generar / mes-letras / lotes / reimprimir / pdf
│           ├── reportes/             Los 5 reportes / usuarios / exportar / historial
│           └── configuracion/        Empresa/usuarios/tarifas/feriados/series/respaldos/…
└── public/logo.jpg           Logo real de Cofre Express
```

## Cómo correrlo en desarrollo

```bash
cd cofre-express-next
npm install
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

Abre `http://localhost:3000`.

## Próximos módulos (en orden)

1. ~~Recepción (lector USB + cámara, Code128 1D)~~ ✅ hecho
2. ~~Entrega (tarjeta grande + confirmación con cuenta regresiva 5-4-3-2-1)~~ ✅ hecho
3. Depósito (enviar / bajar)
4. Buscador avanzado (código, teléfono, remitente, destinatario, estado)
5. Etiquetas (Code128 + PDF listo para imprimir)
6. Reportes (exportar PDF / Excel / CSV)
7. Configuración (empresa, logo, tarifas, feriados, series, respaldos, usuarios, permisos)
8. Pulido final: QA responsive en todos los dispositivos + pase de performance
