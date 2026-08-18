# Cofre Express V1 — Documento de Requerimientos Funcionales (original)

> Este es el contenido íntegro del PDF original (`cofre_express_sistema_v1.pdf`)
> que definió el sistema. Se preserva aquí tal cual para que cualquier
> desarrollador o agente (incluido Claude Code) pueda consultarlo sin
> depender de una conversación de chat externa. **Donde este documento y
> el de nivel empresarial (`docs/especificacion-nivel-empresarial.md`)
> entren en conflicto, gana el de nivel empresarial por ser la
> instrucción más reciente y explícita del dueño del producto — excepto
> en los puntos donde el dueño del producto indicó explícitamente lo
> contrario (ver ese documento).**

## Introducción

La idea es que el sistema se adapte a la forma de trabajar de Cofre Express, ya que manejan un volumen muy alto de paquetes y necesitan que la operación sea lo más rápida posible. No describe cómo debe desarrollarse técnicamente el sistema; únicamente explica cómo debe funcionar y cuáles son los requerimientos.

## 1. Objetivo del sistema

El sistema es una plataforma web para administrar todos los paquetes de Cofre Express. Debe poder utilizarse desde cualquier navegador. Toda la información debe sincronizarse en tiempo real entre los dispositivos conectados. El sistema debe ser rápido, simple y pensado para trabajar principalmente mediante lectores de códigos de barras. La prioridad es minimizar el uso del teclado y del mouse.

## 2. Usuarios (definición original — ver documento de nivel empresarial para los 5 roles actuales)

**Administrador**: acceso completo. Puede buscar cualquier paquete, ver todos los reportes, ver estadísticas, modificar configuraciones, modificar observaciones, enviar paquetes a depósito, bajar paquetes del depósito, generar códigos, generar etiquetas en PDF, configurar tarifas, configurar feriados, configurar el formato de los códigos.

**Operador de entrega**: accede desde una tablet o celular. Únicamente puede buscar paquetes, escanear códigos, escribir códigos manualmente, entregar paquetes, solicitar bajar paquetes del depósito, modificar observaciones. No tiene acceso a configuraciones ni reportes.

## 3. Dispositivos

Inicialmente: una computadora o celular para el administrador, un lector de códigos de barras para recepción, una tablet o celular para el operador de entrega, un lector de códigos de barras para entrega. El sistema debe quedar preparado para soportar más dispositivos en el futuro.

## 4. Lectores de códigos de barras

Inicialmente existen únicamente dos lectores. El **lector de recepción** está conectado al dispositivo de Entregas; registra automáticamente los paquetes que ingresan, y también se usa para enviar/bajar de depósito (no hace falta un lector exclusivo para depósito). El **lector de entrega** está conectado a la tablet/celular del operador; su única función es buscar y entregar paquetes, no registra ingresos ni hace funciones administrativas.

El comportamiento del lector de recepción depende del módulo abierto por el administrador:

- **Modo normal (Recepción)**: cada escaneo registra automáticamente el paquete, guarda fecha y hora de ingreso, asigna el estado "En Paquetería", aplica la tarifa base configurada.
- **Modo "Enviar a depósito"**: todos los códigos escaneados o ingresados pasan automáticamente a "En Depósito". El administrador finaliza el proceso cuando quiere.
- **Modo "Bajar de depósito"**: los códigos escaneados/escritos cambian de "Pendiente de bajar" a "En Paquetería".

## 5. Recepción de paquetes

No se quiere una pantalla exclusiva para recepción; debe funcionar en segundo plano. El operador: (1) pega una etiqueta previamente impresa al paquete, (2) escanea el código. Al escanear, el sistema registra automáticamente código, fecha de ingreso, hora de ingreso, estado inicial "En Paquetería", tarifa base configurada. No debe aparecer ningún formulario ni requerir un botón para guardar — simplemente registra y queda listo para el siguiente escaneo. Cada ingreso correcto genera una confirmación sonora. Si el código ya existe, se muestra una notificación de error y no se registra de nuevo.

## 6. Entrega de paquetes

Se realiza desde tablet o celular. El operador puede escanear o escribir el código manualmente. Al encontrar un paquete debe mostrarse: código, fecha de ingreso, hora de ingreso, tiempo almacenado, costo total acumulado (el costo base puede ser editable para ese único paquete, sumándose el costo extra después de los días incluidos si corresponde), estado, observaciones (editables). Debe existir un botón pequeño "Denegar" para anular un código registrado por error o que nunca ingresó realmente. Un paquete denegado no genera cobros, no cuenta en finanzas, no puede entregarse, y permanece registrado como DENEGADO.

### Según el estado del paquete

- **En Paquetería**: fecha/hora de ingreso, días en paquetería, costo acumulado, botón Entregar. Al entregar: registra fecha/hora de entrega, cambia estado a Entregado.
- **En Depósito**: indica claramente que está en depósito, muestra fecha/hora que ingresó y fecha/hora que se llevó a depósito. Existe el botón "Solicitar bajar de depósito", que cambia el estado a "Pendiente de bajar".
- **Pendiente de bajar**: indica que ya fue solicitado y está pendiente de ser bajado. No puede entregarse hasta volver a "En Paquetería".
- **Entregado**: muestra fecha y hora de entrega. No permite otra entrega.

El historial de entregas (vista del operador) muestra solo los paquetes entregados en la fecha actual.

## 7. Estados del paquete

En Paquetería, En Depósito, Pendiente de bajar, Entregado, Denegado. Todos los cambios de estado deben quedar registrados.

## 8. Observaciones

Cada paquete tiene un campo de observaciones, editable tanto por administrador como por operador de entrega. Ejemplos: "Cliente llamó", "Cobrar monto especial", "Paquete frágil", "Revisar al entregar".

## 9. Depósito

"Enviar a depósito": el administrador escanea varios paquetes consecutivos o ingresa códigos manualmente; cada uno cambia automáticamente a "En Depósito"; no hace falta confirmar uno por uno. "Bajar de depósito": el administrador ve únicamente los paquetes "Pendiente de bajar"; al bajarlos físicamente, los escanea o escribe de nuevo y su estado cambia automáticamente a "En Paquetería". **Nota**: solo los paquetes en estado "Pendiente de bajar" pueden volver a "En Paquetería" por esta vía.

## 10. Tarifas

Configurable: tarifa base, cantidad de días incluidos, costo diario adicional. Configuración inicial: tarifa base Bs 2, incluye los primeros 4 días, a partir del 5º día Bs 1 por día (sin contar domingos ni feriados). El primer día comienza desde el momento en que ingresa el paquete hasta las 00:00 de ese mismo día; luego se cuentan los días configurados y, superados, empieza a cobrarse el costo adicional. Todos los valores son modificables después.

## 11. Cálculo del almacenamiento

No deben contarse domingos ni feriados configurados. El administrador puede agregar, modificar o eliminar feriados.

## 12. Códigos

Los códigos son únicos, nunca se repiten. Un código entregado o denegado no puede reutilizarse. El administrador configura iniciales, formato, y cantidad de códigos a generar.

## 13. Generación de etiquetas

El sistema genera archivos PDF listos para imprimir (hojas tamaño carta). Se puede generar para: hoy, mañana, una fecha específica, una semana completa, un rango de fechas. Cada etiqueta contiene: código, código de barras, fecha correspondiente. Se pueden añadir una o más iniciales (M, S, P, L, X, etc.).

## 14. Dashboard del administrador

Panel en tiempo real con: **Paquetes** (ingresados hoy/ayer/semana/mes/rango), **Entregas** (entregados hoy/ayer/semana/mes/rango), **Estados** (en paquetería, en depósito, pendientes de bajar, entregados, denegados), **Finanzas** (cobrado hoy/ayer/semana/mes/rango, y cuánto debería cobrarse si todos los paquetes activos fueran retirados en ese momento).

## 15. Búsquedas

El administrador puede buscar por: código exacto, código parcial, estado, fecha, hora, rango de fechas, descripción u observaciones.

## 16. Actualización en tiempo real

Todo el sistema trabaja en tiempo real: un paquete registrado aparece inmediatamente en el panel del administrador y se refleja en la tablet de entrega; una entrega desde la tablet se refleja inmediatamente en la computadora del administrador; cambios de observación o tarifa se reflejan inmediatamente en todos los dispositivos donde esa información sea visible; confirmaciones y notificaciones de entrega se muestran inmediatamente en el dispositivo del operador.

## 17. Escalabilidad

Aunque inicialmente se trabaja con una computadora, una tablet y dos lectores, el sistema debe quedar preparado para crecer: más lectores de códigos, más tablets, registro de datos del remitente, fotografías de los paquetes, clasificación por tamaños, más sucursales — todo esto sin necesidad de rehacer el sistema.

## Objetivo principal

Sistema rápido, intuitivo, confiable y fácil de usar. La operación diaria debe realizarse casi por completo mediante escaneo de códigos de barras, reduciendo al mínimo el uso del teclado y evitando pasos innecesarios. El administrador tiene control total y acceso a información en tiempo real; el operador de entrega solo ve lo necesario para trabajar de forma ágil y eficiente.