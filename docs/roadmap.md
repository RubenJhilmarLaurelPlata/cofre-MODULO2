# Roadmap

## Finalizado

✅ Arquitectura
✅ Prisma
✅ Autenticación
✅ Roles
✅ Dashboard
✅ Recepción
✅ Entrega
✅ Depósito
✅ Buscador
✅ Etiquetas
✅ Reportes
✅ Configuración
✅ Backups
✅ Auditoría
✅ QA Responsive (revisión de código en PC/laptop/tablet/celular — patrones responsive verificados en los 8 módulos)
✅ Optimización (índices Prisma, deduplicación de sesión por request, cálculo de costos sin recomputar, dependencias actualizadas)

## ✅ Proyecto listo para producción (Módulo 8 completado)

El sistema funciona sobre SQLite, que ya es apto para producción a la
escala actual de la empresa (ver notas de arquitectura en
`docs/especificacion-nivel-empresarial.md`). Los siguientes puntos son
mejoras de infraestructura **opcionales**, no bloqueantes, a evaluar
según necesidad futura de escalar a múltiples sucursales o mayor
concurrencia:

⬜ Docker (contenedorización para despliegue)
⬜ PostgreSQL (migrar de SQLite solo si se necesita una base de datos
compartida entre servidores/sucursales — el cambio es de una sola línea
en `schema.prisma` gracias a que todo el acceso a datos pasa por Prisma)