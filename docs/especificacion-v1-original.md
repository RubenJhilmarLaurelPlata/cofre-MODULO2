# Cofre Express V1 — Documento de Requerimientos Funcionales (original)

> Este es el contenido íntegro del PDF original (`cofre_express_sistema_v1.pdf`)
> que definió el sistema. Se preserva aquí para que cualquier desarrollador
> o agente pueda consultarlo sin depender de una conversación externa.
>
> **Cuando exista un conflicto entre este documento y
> `docs/especificacion-nivel-empresarial.md`, prevalece el documento de nivel
> empresarial, excepto en los puntos donde éste indique explícitamente que
> continúa vigente la lógica del documento V1.**

---

# Introducción

La idea es que el sistema se adapte a la forma de trabajar de Cofre Express, ya que manejan un volumen muy alto de paquetes y necesitan que la operación sea lo más rápida posible.

Este documento no describe cómo debe desarrollarse técnicamente el sistema; únicamente explica cómo debe funcionar y cuáles son los requerimientos funcionales.

---

# 1. Objetivo del sistema

El sistema es una plataforma web para administrar todos los paquetes de Cofre Express.

Debe poder utilizarse desde cualquier navegador.

Toda la información debe sincronizarse en tiempo real entre los dispositivos conectados.

El sistema debe ser rápido, simple y pensado para trabajar principalmente mediante lectores de códigos de barras.

La prioridad es minimizar el uso del teclado y del mouse.

---

# 2. Usuarios (definición original)

**Administrador**

Tiene acceso completo.

Puede:

- Buscar cualquier paquete.
- Ver todos los reportes.
- Ver estadísticas.
- Modificar configuraciones.
- Modificar observaciones.
- Enviar paquetes a depósito.
- Bajar paquetes del depósito.
- Generar códigos.
- Generar etiquetas PDF.
- Configurar tarifas.
- Configurar feriados.
- Configurar el formato de códigos.

**Operador de entrega**

Accede desde tablet o celular.

Puede únicamente:

- Buscar paquetes.
- Escanear códigos.
- Escribir códigos manualmente.
- Entregar paquetes.
- Solicitar bajar paquetes de depósito.
- Modificar observaciones.

No tiene acceso a configuraciones ni reportes.

---

# 3. Dispositivos

Inicialmente existen:

- Una computadora para administración.
- Un lector de códigos para recepción.
- Una tablet o celular para entrega.
- Un lector de códigos para entrega.

El sistema debe quedar preparado para soportar muchos más dispositivos en el futuro.

---

# 4. Lectores de códigos de barras

Existen dos lectores.

## Lector de recepción

Registra automáticamente paquetes.

También sirve para:

- enviar a depósito
- bajar de depósito

No hace falta un lector exclusivo para depósito.

Su comportamiento depende del módulo abierto.

### Recepción

Cada escaneo:

- registra el paquete
- guarda fecha
- guarda hora
- estado En Paquetería
- aplica tarifa base

### Enviar a depósito

Todo código escaneado cambia automáticamente a En Depósito.

### Bajar de depósito

Todo código escaneado cambia automáticamente de Pendiente de bajar a En Paquetería.

## Lector de entrega

Su única función es:

- buscar
- entregar

No registra ingresos.

No hace tareas administrativas.

---

# 5. Recepción de paquetes

No debe existir una pantalla exclusiva.

Debe funcionar completamente en segundo plano.

Flujo:

1. Se pega la etiqueta.
2. Se escanea.

El sistema registra automáticamente:

- código
- fecha
- hora
- estado En Paquetería
- tarifa base

No debe existir formulario.

No debe existir botón Guardar.

Simplemente registra y queda listo para el siguiente paquete.

Cada ingreso correcto genera una confirmación sonora.

Si el código ya existe:

- mostrar error
- no registrar nuevamente

---

# 6. Entrega de paquetes

El operador puede:

- escanear
- escribir el código

Debe mostrarse:

- código
- fecha ingreso
- hora ingreso
- tiempo almacenado
- costo acumulado
- estado
- observaciones editables

Debe existir un botón pequeño:

Denegar.

Un paquete denegado:

- no genera cobros
- no aparece en finanzas
- no puede entregarse
- permanece registrado como DENEGADO

## Estado En Paquetería

Mostrar:

- fecha ingreso
- hora ingreso
- días almacenados
- costo acumulado

Botón:

Entregar.

Al entregar:

- registrar fecha
- registrar hora
- cambiar estado a Entregado

## Estado En Depósito

Mostrar claramente:

- está en depósito
- fecha ingreso
- fecha envío depósito

Botón:

Solicitar bajar de depósito.

Debe cambiar a:

Pendiente de bajar.

## Estado Pendiente de bajar

Indicar claramente que fue solicitado.

No puede entregarse.

## Estado Entregado

Mostrar:

- fecha entrega
- hora entrega

No permitir otra entrega.

El historial del operador muestra únicamente las entregas del día actual.

---

# 7. Estados del paquete

Los estados son:

- En Paquetería
- En Depósito
- Pendiente de bajar
- Entregado
- Denegado

Todo cambio debe quedar registrado.

---

# 8. Observaciones

Cada paquete posee observaciones editables.

Administrador y operador pueden modificarlas.

Ejemplos:

- Cliente llamó
- Cobrar monto especial
- Paquete frágil
- Revisar al entregar

---

# 9. Depósito

## Enviar a depósito

El administrador escanea varios paquetes.

Cada uno cambia automáticamente.

No debe pedir confirmación.

## Bajar de depósito

Solo aparecen paquetes Pendiente de bajar.

Al escanearlos vuelven automáticamente a En Paquetería.

Únicamente los Pendiente de bajar pueden regresar.

---

# 10. Tarifas

Configurable:

- tarifa base
- días incluidos
- costo diario

Configuración inicial:

Tarifa base:

Bs 2

Primeros:

4 días incluidos.

Desde el quinto día:

Bs 1 diario.

No contar:

- domingos
- feriados

Todos los valores deben ser modificables.

---

# 11. Cálculo del almacenamiento

No contar:

- domingos
- feriados

El administrador puede:

- agregar
- modificar
- eliminar

feriados.

---

# 12. Códigos

Los códigos:

- son únicos
- nunca se repiten

Un código entregado o denegado nunca puede reutilizarse.

El administrador configura:

- iniciales
- formato
- cantidad

---

# 13. Generación de etiquetas

Generar PDF listo para imprimir.

Permitir generar:

- hoy
- mañana
- fecha específica
- semana
- rango

Cada etiqueta contiene:

- código
- código de barras
- fecha

Se pueden utilizar iniciales:

- M
- S
- P
- L
- X

---

# 14. Dashboard

Debe mostrar:

## Paquetes

- hoy
- ayer
- semana
- mes
- rango

## Entregas

- hoy
- ayer
- semana
- mes
- rango

## Estados

- En Paquetería
- En Depósito
- Pendiente de bajar
- Entregado
- Denegado

## Finanzas

- cobrado hoy
- ayer
- semana
- mes
- rango

Además:

Cuánto debería cobrarse si todos los paquetes activos fueran retirados en ese momento.

---

# 15. Búsquedas

Buscar por:

- código exacto
- código parcial
- estado
- fecha
- hora
- rango
- descripción
- observaciones

---

# 16. Actualización en tiempo real

Todo el sistema trabaja en tiempo real.

Los cambios deben verse inmediatamente en todos los dispositivos.

Incluye:

- ingresos
- entregas
- observaciones
- tarifas
- notificaciones

---

# 17. Escalabilidad

Debe prepararse para crecer.

Ejemplos:

- más lectores
- más tablets
- remitentes
- fotografías
- tamaños
- sucursales

Sin rehacer el sistema.

---

# Objetivo principal

Construir un sistema:

- rápido
- intuitivo
- confiable
- fácil de usar

La operación diaria debe realizarse casi completamente mediante escaneo de códigos de barras.

El teclado y el mouse deben utilizarse lo menos posible.

El administrador tiene control total del sistema.

El operador únicamente ve las funciones necesarias para trabajar de forma rápida y eficiente.