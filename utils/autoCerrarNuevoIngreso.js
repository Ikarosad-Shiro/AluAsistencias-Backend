// utils/autoCerrarNuevoIngreso.js
const { DateTime } = require('luxon');
const Trabajador = require('../models/Trabajador');
const Sede = require('../models/Sede');

const ZONE = 'America/Mexico_City';

function dtStartMX(any) {
  const raw = typeof any === 'string' ? any : (any?.$date ?? any);
  return DateTime.fromJSDate(new Date(raw)).setZone(ZONE).startOf('day');
}

/**
 * Cierra "nuevoIngreso" comparando SIEMPRE días calendario entre fechaAlta y hoy.
 * Usa horarioBase.nuevoIngreso.duracionDias si existe; en su defecto, 30 días.
 * (Ignora horarioBase.desde y aplicarSoloDiasActivosBase.)
 */
async function autoCerrarNuevoIngreso({
  dryRun = false,
  ahora = new Date(),
  setFechaFin = true,
  logger = console,
} = {}) {
  const hoy = DateTime.fromJSDate(ahora).setZone(ZONE).startOf('day');

  // 1) Candidatos: activos con NI=true y fechaAlta
  const candidatos = await Trabajador.find(
    { estado: 'activo', nuevoIngreso: true, fechaAlta: { $ne: null } },
    '_id nombre sede sedePrincipal fechaAlta'
  ).lean();

  if (!candidatos.length) {
    return { ok: true, total: 0, cerrados: 0, omitidos: 0, detalle: [] };
  }

  // 2) Sedes involucradas
  const sedeIds = [
    ...new Set(
      candidatos
        .map(t => t.sedePrincipal ?? t.sede)
        .filter(x => x !== null && x !== undefined)
    ),
  ];
  const sedes = await Sede.find({ id: { $in: sedeIds } }, 'id nombre horarioBase').lean();
  const sedeMap = new Map(sedes.map(s => [s.id, s]));

  // 3) Decidir cierres SOLO por días calendario
  const updates = [];
  const detalle = [];
  let omitidos = 0;

  for (const t of candidatos) {
    const alta = dtStartMX(t.fechaAlta);
    if (!alta.isValid) { omitidos++; continue; }

    const sedeId = t.sedePrincipal ?? t.sede;
    const sede = sedeMap.get(sedeId);

    // duracionDias desde la sede si existe; si no, 30
    const niCfg = sede?.horarioBase?.nuevoIngreso;
    const duracion = Number(niCfg?.duracionDias) > 0 ? Number(niCfg.duracionDias) : 30;

    // días calendario transcurridos (incluyendo el día de alta)
    const dias = Math.floor(hoy.diff(alta, 'days').days) + 1;

    const cumple = dias >= duracion;
    detalle.push({ trabajador: t._id, sedeId, metodo: 'dias_calendario', dias, duracion });

    if (cumple) {
      updates.push({
        updateOne: {
          filter: { _id: t._id },
          update: setFechaFin
            ? { $set: { nuevoIngreso: false, fechaFinNuevoIngreso: hoy.toJSDate() } }
            : { $set: { nuevoIngreso: false } },
        },
      });
    }
  }

  // 4) Aplicar cambios
  let result = null;
  if (!dryRun && updates.length) {
    result = await Trabajador.bulkWrite(updates, { ordered: false });
    logger.info(`🧹 NI: cerrados=${result.modifiedCount} / candidatos=${candidatos.length}`);
  } else {
    logger.info(`🧹 NI dry-run: cerraría=${updates.length} / candidatos=${candidatos.length}`);
  }

  return {
    ok: true,
    total: candidatos.length,
    cerrados: updates.length,
    omitidos,
    dryRun,
    mongo: result,
    detalle,
  };
}

module.exports = { autoCerrarNuevoIngreso };
