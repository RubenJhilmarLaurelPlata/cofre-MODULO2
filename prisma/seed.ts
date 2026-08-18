// prisma/seed.ts
// Datos iniciales para poder entrar al sistema la primera vez.
// Ejecutar con: npm run db:seed

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const branch = await prisma.branch.upsert({
    where: { nombre: 'Principal' },
    update: {},
    create: { nombre: 'Principal', activo: true },
  });

  await prisma.company.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      nombre: 'Cofre Express',
      moneda: 'Bs',
      tarifaBase: 2,
      diasIncluidos: 4,
      costoAdicionalDia: 1,
      formatoLetra: 'L',
      formatoSeparador: '-',
      formatoDigitos: 3,
      sucursalActualId: branch.id,
    },
  });

  // Definido localmente (no se importa el alias "@/types" aqui porque este
  // script corre con "tsx" fuera del pipeline normal de Next.js, y no hay
  // garantia de que resuelva los path aliases de tsconfig.json).
  type RoleSeed = 'ADMIN' | 'SUPERVISOR' | 'RECEPCION' | 'ENTREGA' | 'CONSULTA' | 'ADMIN_CAJA';

  const usuarios: Array<{ username: string; password: string; nombre: string; role: RoleSeed }> = [
    { username: 'admin', password: 'admin123', nombre: 'Administrador', role: 'ADMIN' },
    { username: 'supervisor1', password: 'supervisor123', nombre: 'Supervisor 1', role: 'SUPERVISOR' },
    { username: 'recepcion1', password: 'recepcion123', nombre: 'Recepción 1', role: 'RECEPCION' },
    { username: 'entrega1', password: 'entrega123', nombre: 'Operador de entrega 1', role: 'ENTREGA' },
    { username: 'consulta1', password: 'consulta123', nombre: 'Consulta 1', role: 'CONSULTA' },
    { username: 'caja1', password: 'caja123', nombre: 'Administrador de Caja 1', role: 'ADMIN_CAJA' },
  ];

  for (const u of usuarios) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        passwordHash,
        nombre: u.nombre,
        role: u.role,
        branchId: branch.id,
      },
    });
  }

  const feriados: Array<{ fecha: string; nombre: string }> = [
    { fecha: '2026-01-01', nombre: 'Año Nuevo' },
    { fecha: '2026-01-02', nombre: 'Año Nuevo (traslado)' },
    { fecha: '2026-01-06', nombre: 'Día de Reyes' },
    { fecha: '2026-04-02', nombre: 'Viernes Santo' },
    { fecha: '2026-05-01', nombre: 'Día del Trabajador' },
    { fecha: '2026-06-21', nombre: 'Año Nuevo Andino' },
    { fecha: '2026-08-06', nombre: 'Día de la Patria' },
    { fecha: '2026-08-15', nombre: 'Asunción de la Virgen' },
  ];

  for (const f of feriados) {
    const existente = await prisma.holiday.findFirst({ where: { fecha: f.fecha } });
    if (!existente) {
      await prisma.holiday.create({ data: { fecha: f.fecha, nombre: f.nombre, activo: true } });
    }
  }

  const series: Array<{ inicial: string; descripcion: string }> = [
    { inicial: 'S', descripcion: 'Pequeño / Delicado' },
    { inicial: 'M', descripcion: 'Mediano / Ropa' },
    { inicial: 'L', descripcion: 'Grande' },
    { inicial: 'X', descripcion: 'Extra Grande' },
  ];

  for (const s of series) {
    await prisma.packageSeries.upsert({
      where: { inicial: s.inicial },
      update: {},
      create: { inicial: s.inicial, descripcion: s.descripcion, correlativo: 0 },
    });
  }

  // Letra del mes para el codigo de las etiquetas (Modulo 5), editable
  // despues por el administrador — estos son solo valores iniciales.
  const letrasMes: Array<{ mes: number; letra: string }> = [
    { mes: 1, letra: 'E' },
    { mes: 2, letra: 'F' },
    { mes: 3, letra: 'M' },
    { mes: 4, letra: 'A' },
    { mes: 5, letra: 'Y' },
    { mes: 6, letra: 'J' },
    { mes: 7, letra: 'L' },
    { mes: 8, letra: 'G' },
    { mes: 9, letra: 'S' },
    { mes: 10, letra: 'O' },
    { mes: 11, letra: 'N' },
    { mes: 12, letra: 'D' },
  ];

  for (const m of letrasMes) {
    await prisma.monthLetter.upsert({
      where: { mes: m.mes },
      update: {},
      create: { mes: m.mes, letra: m.letra },
    });
  }

  console.log('Seed completado:');
  console.log('  Sucursal:', branch.nombre);
  console.log('  Usuarios de prueba (usuario / contraseña):');
  usuarios.forEach((u) => console.log(`    ${u.username} / ${u.password}  (${u.role})`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
