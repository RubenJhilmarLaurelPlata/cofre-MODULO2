// src/app/api/recepcion/scan/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, TRANSACTION_OPTS } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { tienePermiso } from '@/lib/permisos';
import { getCompanyConfig, getHolidaySet } from '@/lib/config';
import { calcularCosto } from '@/lib/pricing';
import { normalizarCodigo, canonicalizarSeparadores } from '@/lib/codigo';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';
import { guardarFotoPaquete } from '@/lib/paquete-foto';
import { registrarPago } from '@/lib/package-transitions';
import { registrarPaqueteBasico } from '@/lib/paquete-registro';

const clienteSchema = z.object({
  nombre: z.string().trim().max(120).optional(),
  emprendimiento: z.string().trim().max(120).optional(),
  telefono: z.string().trim().max(30).optional(),
  observaciones: z.string().trim().max(500).optional(),
});

const bodySchema = z.object({
  code: z.string().trim().min(1, 'El código no puede estar vacío').max(40),
  // Datos opcionales de cliente/remitente (Recepcion): o bien se reenvia
  // el id de un cliente ya creado en un escaneo anterior de la misma
  // sesion (misma persona, varios paquetes), o se envian los datos para
  // crear uno nuevo. Nunca obligatorios.
  clienteId: z.string().optional(),
  cliente: clienteSchema.optional(),
  // Foto opcional del paquete, como data URL (camara o galeria).
  foto: z.string().max(4_500_000).optional(),
  // Nombre/descripcion breve del contenido, propia de este paquete
  // puntual (a diferencia de los datos de "cliente", que se reutilizan
  // entre varios paquetes de la misma persona).
  descripcion: z.string().trim().max(300).optional(),
  // Anticipo opcional pagado en este momento (no obligatorio, no congela
  // el calculo de dias — ver src/lib/package-transitions.ts:registrarPago).
  montoAnticipo: z.number().finite().min(0).max(1_000_000).optional(),
  // Tarifa acordada para ESTE paquete puntual, elegida en el selector de
  // pago de Recepcion (ej. "POR PAGAR Bs5" en vez del monto base
  // general). Distinta del anticipo: esto fija cuanto se cobra por dia,
  // se haya pagado algo ahora o no. Si no se envia, se usa la tarifa de
  // un codigo personalizado (GeneratedCode.tarifaOverride), la de la
  // serie, o la general de la empresa, en ese orden.
  tarifaAcordada: z.number().finite().min(0).max(1_000_000).optional(),
  // Datos opcionales de quien RECOGERA el paquete (Paso B): distintos de
  // "cliente" (quien lo deja). Tambien se pueden completar despues, desde
  // Entrega — nunca son obligatorios aqui.
  destinatario: z.string().trim().max(120).optional(),
  destinatarioTelefono: z.string().trim().max(30).optional(),
  destinatarioObservaciones: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  // El middleware ya filtra por rol a nivel de ruta, pero verificamos de
  // nuevo aqui (defensa en profundidad: esta API nunca debe confiar
  // unicamente en el middleware).
  const session = await getSession();
  if (!session || !(await tienePermiso(session, 'recepcion.registrar'))) {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Código inválido' }, { status: 400 });
  }

  // El S700 en modo HID puede enviar un apostrofe/acento grave en vez
  // del guion del codigo (ver src/lib/codigo.ts); se corrige aqui, antes
  // de guardarlo, para que el "code" impreso/almacenado quede igual al
  // de la etiqueta fisica ("M15A-1"), no "M15A'1". El resto de la
  // busqueda/duplicados sigue usando normalizarCodigo() para comparar.
  const code = canonicalizarSeparadores(parsed.data.code.trim()).toUpperCase();
  const inicialMatch = code.match(/^[A-Z]+/);
  const inicial = inicialMatch?.[0];

  if (!inicial) {
    return NextResponse.json(
      { error: 'El código no tiene un formato reconocible (debe iniciar con letras, ej: M26L-001).' },
      { status: 400 }
    );
  }

  try {
    const company = await getCompanyConfig();

    const serie = await prisma.packageSeries.findUnique({ where: { inicial } });
    if (!serie || !serie.activo) {
      return NextResponse.json(
        { error: `La serie "${inicial}" no está configurada o está inactiva. Pide a un administrador que la registre en Configuración.` },
        { status: 400 }
      );
    }

    const codigoNormalizado = normalizarCodigo(code);

    // Una sola consulta para las dos reglas de duplicado (antes eran dos
    // idas a la base de datos en el camino mas transitado del sistema:
    // cada escaneo de Recepcion pasa por aqui).
    const statusesBloqueados: string[] = [];
    if (company.impedirDuplicados) statusesBloqueados.push('EN_PAQUETERIA', 'EN_DEPOSITO', 'PENDIENTE_BAJAR');
    if (company.impedirReutilizarEntregadosDenegados) statusesBloqueados.push('ENTREGADO', 'DENEGADO');

    if (statusesBloqueados.length > 0) {
      const conflicto = await prisma.package.findFirst({
        where: { codigoNormalizado, status: { in: statusesBloqueados } },
        select: { status: true },
      });
      if (conflicto) {
        const yaFinalizado = conflicto.status === 'ENTREGADO' || conflicto.status === 'DENEGADO';
        return NextResponse.json(
          {
            error: yaFinalizado
              ? 'Este código ya fue entregado o denegado y no puede reutilizarse.'
              : 'Este código ya existe y está activo en el sistema.',
            tipo: 'duplicado',
          },
          { status: 409 }
        );
      }
    }

    const branchId = session.branchId ?? company.sucursalActualId ?? (await prisma.branch.findFirst({ where: { activo: true } }))?.id;
    if (!branchId) {
      return NextResponse.json({ error: 'No hay ninguna sucursal activa configurada.' }, { status: 400 });
    }

    // Cliente/remitente (opcional): si viene un clienteId, se reutiliza
    // (mismo cliente que dejo un paquete anterior en esta misma sesion de
    // recepcion). Si vienen datos nuevos y al menos uno no esta vacio, se
    // crea un registro de Cliente. Si no viene nada, el paquete queda sin
    // cliente asociado — nunca es obligatorio.
    let clienteId: string | null = null;
    if (parsed.data.clienteId) {
      const existente = await prisma.cliente.findUnique({ where: { id: parsed.data.clienteId }, select: { id: true } });
      if (!existente) {
        return NextResponse.json({ error: 'El cliente indicado ya no existe.' }, { status: 400 });
      }
      clienteId = existente.id;
    } else if (parsed.data.cliente) {
      const { nombre, emprendimiento, telefono, observaciones } = parsed.data.cliente;
      if (nombre || emprendimiento || telefono || observaciones) {
        const nuevoCliente = await prisma.cliente.create({
          data: { nombre: nombre || null, emprendimiento: emprendimiento || null, telefono: telefono || null, observaciones: observaciones || null },
        });
        clienteId = nuevoCliente.id;
      }
    }

    const pkg = await prisma.$transaction(
      (tx) =>
        registrarPaqueteBasico(
          tx,
          code,
          branchId,
          session.id,
          { tarifaBaseOverride: parsed.data.tarifaAcordada },
          {
            clienteId,
            descripcion: parsed.data.descripcion || null,
            destinatario: parsed.data.destinatario || null,
            destinatarioTelefono: parsed.data.destinatarioTelefono || null,
            destinatarioObservaciones: parsed.data.destinatarioObservaciones || null,
          }
        ),
      TRANSACTION_OPTS
    );

    // Foto (opcional): se guarda en disco despues de crear el paquete
    // (necesita el id). Si falla, no debe hacer fallar el registro del
    // paquete en si — la foto siempre es opcional.
    if (parsed.data.foto) {
      try {
        const nombreArchivo = await guardarFotoPaquete(pkg.id, parsed.data.foto);
        await prisma.package.update({ where: { id: pkg.id }, data: { fotoArchivo: nombreArchivo } });
      } catch (err) {
        console.error('No se pudo guardar la foto del paquete:', err);
      }
    }

    // Anticipo opcional (Modulo Pagos): no congela el calculo de dias, ver
    // registrarPago(). Se registra despues del alta para no acoplar el
    // ledger de pagos a la transaccion de creacion del paquete.
    let pkgConPago = pkg;
    if (parsed.data.montoAnticipo && parsed.data.montoAnticipo > 0) {
      pkgConPago = await registrarPago(pkg, 'ANTICIPO', parsed.data.montoAnticipo, session.id);
    }

    const feriados = await getHolidaySet();
    const costo = calcularCosto(
      pkg.ingresoAt,
      pkg.ingresoAt,
      { tarifaBase: company.tarifaBase, diasIncluidos: company.diasIncluidos, costoAdicionalDia: company.costoAdicionalDia },
      feriados,
      pkg.tarifaBaseOverride,
      pkg.diasIncluidosOverride
    );

    const { ip, userAgent } = extraerContextoRequest(req);
    await registrarAuditoria({
      userId: session.id,
      accion: 'PAQUETE_INGRESADO',
      modulo: 'recepcion',
      valorNuevo: { code: pkg.code, inicial: pkg.inicial, status: pkg.status },
      ip,
      userAgent,
    });

    return NextResponse.json({
      code: pkg.code,
      inicial: pkg.inicial,
      status: pkg.status,
      ingresoAt: pkg.ingresoAt,
      costoAcumulado: costo.total,
      moneda: company.moneda,
      serieDescripcion: serie.descripcion,
      clienteId,
      estadoPago: pkgConPago.estadoPago,
      montoPagado: pkgConPago.montoPagado,
    });
  } catch (err) {
    // Choque con el indice unico de "code" (carrera entre dos escaneos casi simultaneos).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'Este código ya fue registrado.', tipo: 'duplicado' }, { status: 409 });
    }
    console.error('Error registrando paquete en recepción:', err);
    return NextResponse.json({ error: 'Ocurrió un error al registrar el paquete. Intenta de nuevo.' }, { status: 500 });
  }
}
