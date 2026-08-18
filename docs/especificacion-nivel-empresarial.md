# Cofre Express — Especificación de nivel empresarial (fase actual del rewrite)

> Contenido íntegro de la instrucción que inició la reescritura completa
> del sistema en Next.js + TypeScript + Prisma. **Esta es la
> especificación vigente y más reciente** — donde entra en conflicto con
> `docs/especificacion-v1-original.md`, esta gana, salvo que aquí mismo
> se indique lo contrario (por ejemplo, la lógica de tarifas, cálculo de
> días y las reglas de depósito del documento v1 siguen vigentes; lo que
> cambió es la arquitectura, el diseño, los roles y varios flujos
> nuevos).

## Instrucciones de proceso (aplican a todo el proyecto, siempre)

1. Antes de modificar código, revisar `docs/especificacion-v1-original.md`
   y esta especificación completas.
2. Estas especificaciones son la fuente oficial del proyecto. Todo el
   desarrollo debe seguir exactamente lo indicado aquí.
3. Si hay diferencia entre el código existente y las especificaciones,
   prevalece la especificación (a menos que el dueño del producto haya
   dado una instrucción más reciente en el chat que la reemplace — en
   ese caso, preguntar antes de asumir).
4. Analizar la arquitectura actual completa antes de modificar cualquier
   archivo (base de datos/Prisma, API, backend, frontend, autenticación,
   componentes, rutas, servicios).
5. No eliminar funcionalidades existentes sin una razón técnica.
6. Si se detectan errores de arquitectura, corregirlos.
7. **Trabajar por módulos.** Al terminar cada módulo: compilar el
   proyecto, corregir errores, ejecutar TypeScript (`npm run typecheck`),
   ejecutar ESLint (`npm run lint`), verificar que no se rompió nada
   existente, y solo entonces continuar con el siguiente módulo. No dar
   el proyecto por terminado hasta verificar que todo funciona con
   calidad profesional, tanto visual como técnica.
8. Eliminar código muerto, componentes sin uso, mocks, TODOs,
   duplicados; corregir imports, rutas, estados, errores de TypeScript y
   de ESLint.
9. No dejar botones sin funcionamiento, formularios falsos, componentes
   simulados, ni datos ficticios cuando ya existe base de datos real.
   Todo debe conectarse de extremo a extremo con la base de datos.

## Objetivo

Software profesional de nivel empresarial — no una maqueta, no una
demo, no una interfaz genérica de IA. Un sistema comercial que una
empresa de paquetería pueda usar a diario: rápido, moderno, elegante,
intuitivo, estable y listo para producción. Debe sentirse como un
software de nivel comercial alto.

## Diseño

Interfaz moderna, limpia y profesional. Inspiración únicamente en
**calidad** de diseño (no copiar literalmente) de: Odoo, Stripe
Dashboard, Linear, Shopify Admin, Notion, Vercel Dashboard.

## Colores

Paleta restringida: blanco, naranja institucional de Cofre Express,
grises suaves, negro únicamente para texto. Nada de colores llamativos
adicionales ni degradados exagerados.

> Implementado con `#F2660F` como naranja base (ver
> `tailwind.config.ts`) por ser un naranja institucional estándar; si
> Cofre Express tiene un hex de marca específico, se debe actualizar ahí
> únicamente.

## Iconos

Únicamente una librería profesional de iconos, mismo estilo en todos
lados. **Implementado: Lucide React** (`lucide-react`) en todo el
sistema, sin emojis ni iconos "caricaturescos".

## Tipografía

Moderna, con espaciado correcto, jerarquía visual clara, buen uso de
espacio en blanco, buena legibilidad. **Implementado: Inter**
(`next/font/google`).

## Responsive

Toda la aplicación debe adaptarse a computadoras, laptops, tablets y
celulares (Android/iPhone) sin romperse y sin requerir zoom.

## Rendimiento

Optimizar renderizados, consultas y estados. Optimizar React, Next.js,
Prisma y las consultas SQL (usar `Promise.all` para paralelizar
consultas independientes, seleccionar solo los campos necesarios,
evitar refetches innecesarios).

## Base de datos

Revisar el esquema de Prisma, corregir relaciones, normalizar tablas,
agregar índices y restricciones, optimizar consultas, usar
transacciones. Preparada para cientos de miles de paquetes, debe poder
funcionar durante años sin rediseño. Estructura escalable y lista para
producción.

> **Nota de arquitectura importante**: el proyecto usa SQLite como motor
> por defecto (cero configuración, adecuado para el volumen actual).
> SQLite **no soporta enums nativos** — por eso `role` y `status` se
> modelan como `String` con el conjunto de valores válidos definido y
> validado en `src/types/index.ts`, no como `enum` de Prisma. Si en el
> futuro se migra a PostgreSQL, esos campos pueden convertirse a `enum`
> real sin tocar el resto del código de la aplicación.

## Autenticación

Autenticación profesional real — nada de usuarios simulados ni mocks.
**Implementado**: contraseñas con hash bcrypt, sesión JWT en cookie
httpOnly firmada, verificada tanto en el middleware (Edge, con `jose`)
como de nuevo dentro de cada API sensible (defensa en profundidad).

## Roles (5 roles — reemplazan a los 2 del documento v1)

- **Administrador**: acceso completo.
- **Supervisor**: puede consultar todo y generar reportes, no puede
  modificar configuraciones.
- **Recepción**: únicamente puede registrar paquetes. No puede modificar
  configuraciones ni eliminar datos.
- **Entrega**: únicamente puede buscar paquetes, entregar, denegar,
  enviar a depósito, bajar de depósito.
- **Consulta**: solo lectura.

Cada acción debe registrar usuario, fecha, hora, e ir al historial.
**Implementado**: tabla `PackageHistory` separada e indexada (no JSON
embebido), permisos centralizados en `src/types/index.ts`
(`PERMISOS_POR_MODULO`), aplicados tanto en `middleware.ts` (páginas y
APIs) como dentro de cada endpoint sensible.

## Dashboard

Debe mostrar información realmente útil y conectada a la base de datos
en tiempo real (no fija): ingresados hoy, entregados hoy, en depósito,
pendientes, cobrado hoy/semana/mes, actividad reciente, gráficos reales.
La fecha se detecta automáticamente, nunca fija.

## Recepción

El módulo más rápido del sistema. Optimizado para lector USB, y también
debe permitir usar la cámara del celular. **NO usar códigos QR — todo el
sistema trabaja únicamente con códigos de barras Code 128 (1D)**. La
cámara debe poder leer Code 128 directamente desde celulares, tablets,
laptop, o webcam de computadora. Después de escanear: buscar/registrar
automáticamente, emitir sonido, volver a colocar el cursor listo para el
siguiente paquete — todo en menos de dos segundos.

## Buscador

Debe buscar por: código, teléfono, remitente, destinatario,
observaciones, estado — todo desde una sola búsqueda, con filtros
rápidos. *(Implementado — Módulo 4. Página `/buscador` con un campo de
texto único (código completo o parcial, remitente, destinatario,
teléfono u observaciones — combinable con filtro de estado y rango de
fechas de ingreso), búsqueda en vivo con debounce de 300ms, compatible
con lector USB (Enter busca al instante) y con cámara del celular
(reutiliza `CameraScanner`, Code128 1D). Tarjetas de resultado con
código, estado, remitente, destinatario, fecha de ingreso, días
almacenado, costo actual y observaciones; desde cada tarjeta se puede
abrir el detalle completo, ver el historial completo, ir directo a
Entrega (`/entrega?code=...`, precarga el paquete sin volver a
escribirlo) o enviar a depósito en el mismo lugar (reutiliza
`enviarADeposito` de `package-transitions.ts`, sin duplicar lógica).)*

## Entrega

Tarjeta grande con: código, cliente, costo, estado, observaciones.
Botones grandes: Entregar, Denegar, Enviar a depósito.

## Confirmación de entrega

Al pulsar ENTREGAR: pantalla de confirmación con cuenta regresiva
automática 5-4-3-2-1 y botón Cancelar. Si nadie cancela, se registra la
entrega automáticamente: historial, dashboard, reportes y estados se
actualizan.

## Depósito

Enviar a depósito / bajar de depósito, optimizado para escaneo, con
búsqueda rápida, confirmaciones e historial. *(Implementado — Módulo 3.
Página `/deposito` con dos pestañas: "Enviar a depósito" (escaneo
continuo, sin confirmar uno por uno) y "Bajar de depósito" (lista en
vivo de "Pendiente de bajar" + escaneo para confirmar la bajada física).
Reutiliza las mismas funciones de transición de
`src/lib/package-transitions.ts` que ya usa Entrega:
`enviarADeposito`, `solicitarBajarDeposito` y `bajarDeDeposito`.)*

## Generación de etiquetas

Únicamente códigos de barras Code 128 (1D) — nunca QR. Vista previa, PDF
listo para imprimir, impresión optimizada para etiquetas. *(Implementado
— Módulo 5. Página `/etiquetas` con tres pestañas: **Generar**
(solo Administrador — tipo/inicial libre con auto-creación de serie si es
nueva, fecha por Hoy/Mañana/Fecha específica/Semana completa/Rango,
cantidad, consecutivo inicial con "Continuar lote" o "Nuevo lote", letra
de cada mes editable y nunca codificada — tabla `MonthLetter` — vista
previa en vivo con `bwip-js` y descarga de PDF), **Reimprimir** (código
específico, rango o varios códigos, disponible también para Recepción) e
**Historial** (buscar/filtrar lotes — tabla `LabelBatch` —, reimprimir
cualquier lote anterior, duplicar cambiando fecha/consecutivo). Formato
del código: `{inicial}{día 2 dígitos}{letra del mes}-{consecutivo}` (ej.
`M24J-1`). PDF con `pdf-lib` + `bwip-js`, hoja carta, exactamente 30
etiquetas por hoja (3×10). Toda generación verifica contra
`GeneratedCode` y `Package` reales antes de crear códigos — nunca se
repiten ni se inventan.)*

## Reportes

Exportar a PDF, Excel y CSV. Filtrar por fecha, operador, estado, tipo.
*(Implementado — Módulo 6. Página `/reportes` (Administrador y
Supervisor) con un centro de reportes real, no un botón suelto: filtro
compartido (Hoy/Ayer/Esta semana/Este mes/Fecha específica/Rango +
estado/usuario/tipo/texto libre) aplicado a 5 reportes — Paquetes,
Financiero, Operadores, Depósito y Etiquetas —, cada uno con resumen,
gráfica (`recharts`, misma paleta que el dashboard) y tablas reales.
Exportación a PDF (`pdf-lib`, hoja carta horizontal con logo, encabezado,
pie de página y numeración), Excel (`exceljs`, hojas con formato y
autofiltro) y CSV (UTF-8 con BOM), siempre respetando los filtros
activos. Impresión directa vía `window.print()` con la barra lateral y
los filtros ocultos en la hoja impresa. Cada exportación queda auditada
en la tabla `ReportLog` (usuario, filtros, formato) y es consultable
desde la pestaña "Historial" del propio módulo. Reutiliza
`sumarCosto`/`fechaReferencia` (antes duplicados entre `dashboard-data.ts`
y `package-detail.ts`, ahora consolidados), el filtro de texto del
Buscador y el listado de lotes de Etiquetas — nada de esto se
recalculó.)*

## Configuración

Empresa, logo, tarifa base, costo diario, domingos, feriados, tipos de
paquetes, series de códigos, respaldos, usuarios, permisos. *(Implementado
— Módulo 7. Página `/configuracion` (solo Administrador) con 13
pestañas: Empresa (nombre/logo/dirección/teléfono/email/sitio
web/ciudad/país/horario — usados automáticamente en Reportes, PDF,
Etiquetas e impresiones), Usuarios (crear/editar/desactivar/reactivar/
bloquear/desbloquear/restablecer contraseña/buscar/filtrar, con estado
Activo/Inactivo/Bloqueado y último acceso/último inicio de sesión —
ambos ahora campos reales, `ultimoAccesoAt` y `ultimoLoginAt`), Roles y
Permisos (solo informativo, lee directamente `PERMISOS_POR_MODULO`, sin
lógica nueva), Tarifas, Feriados (CRUD + importar), Meses (reutiliza el
mismo componente y API del Módulo 5), Tipos de código (PackageSeries,
eliminar solo si nunca se usó), Respaldos (copia real del archivo SQLite,
descarga, historial — arquitectura lista para una futura restauración
automática), Preferencias (idioma/zona horaria/formatos/sonidos — el
interruptor de sonidos ahora silencia de verdad `playSound` en todo el
sistema), Seguridad (tiempos de sesión/inactividad/intentos de login,
aplicados en tiempo real por `getSession()` y por la ruta de login, no
solo al reiniciar), Auditoría (tabla nueva `AuditLog`, con búsqueda y
filtros, registrada desde login/logout, cambios de estado de paquetes,
etiquetas, reportes y toda la propia Configuración), Notificaciones
(vista filtrada del mismo `AuditLog`, sin tabla nueva) y Mantenimiento
(solo lectura: versiones, conexión a la base, conteo de registros,
espacio en disco, último respaldo).)*

## Calidad del código

Sin código muerto, sin componentes sin uso, sin mocks, sin TODOs, sin
duplicados; imports, rutas y estados correctos; sin errores de
TypeScript ni de ESLint.

## Roadmap de módulos (orden acordado con el dueño del producto)

0. ✅ Fundaciones (Next.js + TypeScript + Prisma + auth + diseño + dashboard)
1. ✅ Recepción (lector USB + cámara, Code128 1D)
2. ✅ Entrega (tarjeta grande + confirmación con cuenta regresiva)
3. ✅ Depósito (enviar / bajar)
4. ✅ Buscador avanzado (código, teléfono, remitente, destinatario, estado)
5. ✅ Etiquetas (Code128 + PDF listo para imprimir)
6. ✅ Reportes (exportar PDF / Excel / CSV)
7. ✅ Configuración (empresa, logo, tarifas, feriados, series, respaldos, usuarios, permisos)
8. ⬜ Pulido final: QA responsive en todos los dispositivos + pase de performance + resolver vulnerabilidades de `npm audit` + actualizar Next.js a una versión sin el aviso de seguridad de diciembre 2025 — **siguiente**