// src/app/api/configuracion/tarifas/route.ts
// Tarifa base, dias incluidos y costo adicional diario: los mismos
// campos que ya usa pricing.ts (calcularCosto) en todo el sistema, asi
// que cualquier cambio aqui se aplica de inmediato a los calculos
// nuevos, sin tocar la logica de negocio existente.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { getCompanyConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { registrarAuditoria, extraerContextoRequest } from '@/lib/auditoria';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }
  const company = await getCompanyConfig();
  return NextResponse.json({
    tarifaBase: company.tarifaBase,
    diasIncluidos: company.diasIncluidos,
    costoAdicionalDia: company.costoAdicionalDia,
    montosPagoRapido: company.montosPagoRapido,
    entregaCountdownSegundos: company.entregaCountdownSegundos,
    cierreAutomaticoHabilitado: company.cierreAutomaticoHabilitado,
    horaCierreAutomatico: company.horaCierreAutomatico,
  });
}

const bodySchema = z.object({
  // Enteros: la especificacion es explicita en que el costo por dia
  // nunca genera centavos ni se prorratea (ver pricing.ts:calcularCosto,
  // que suma estos valores directamente sin dividir nada) — permitir un
  // valor fraccionario aqui filtraria centavos a cada paquete calculado.
  tarifaBase: z.number().int().min(0).max(1_000_000),
  diasIncluidos: z.number().int().min(0).max(365),
  costoAdicionalDia: z.number().int().min(0).max(1_000_000),
  // Lista separada por comas de montos rapidos en Recepcion, ej "2,3,5,7".
  montosPagoRapido: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .refine((v) => v.split(',').every((n) => n.trim() !== '' && Number(n.trim()) > 0), 'Usa números positivos separados por comas, ej: 2,3,5,7'),
  entregaCountdownSegundos: z.number().int().min(1).max(30),
  cierreAutomaticoHabilitado: z.boolean(),
  horaCierreAutomatico: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM, ej: 20:00'),
});

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No tienes permiso para esta acción' }, { status: 403 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos.' }, { status: 400 });
  }

  const anterior = await getCompanyConfig();
  const actualizado = await prisma.company.update({ where: { id: 1 }, data: parsed.data });

  const { ip, userAgent } = extraerContextoRequest(req);
  await registrarAuditoria({
    userId: session.id,
    accion: 'TARIFAS_ACTUALIZADAS',
    modulo: 'configuracion',
    valorAnterior: { tarifaBase: anterior.tarifaBase, diasIncluidos: anterior.diasIncluidos, costoAdicionalDia: anterior.costoAdicionalDia },
    valorNuevo: parsed.data,
    ip,
    userAgent,
  });

  return NextResponse.json({
    tarifaBase: actualizado.tarifaBase,
    diasIncluidos: actualizado.diasIncluidos,
    costoAdicionalDia: actualizado.costoAdicionalDia,
    montosPagoRapido: actualizado.montosPagoRapido,
    entregaCountdownSegundos: actualizado.entregaCountdownSegundos,
    cierreAutomaticoHabilitado: actualizado.cierreAutomaticoHabilitado,
    horaCierreAutomatico: actualizado.horaCierreAutomatico,
  });
}
