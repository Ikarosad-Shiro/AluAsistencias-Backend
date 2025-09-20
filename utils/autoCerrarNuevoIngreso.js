// utils/autoCerrarNuevoIngreso.js
const { DateTime } = require('luxon');
const Trabajador = require('../models/Trabajador');
const Sede = require('../models/Sede');

const ZONE = 'America/Mexico_City';

function dtStartMX(any) {
  const raw = typeof any === 'string' ? any : (any?.$date ?? any);
  return DateTime.fromJSDate(new Date(raw)).setZone(ZONE).startOf('day');
}
function weekdayToDow(dt) { // Luxon: 1=Lun..7=Dom → 1..6,0
  return dt.weekday % 7;
}

// Cuenta días activos (según dows con jornadas) entre start..end (incl.)
function countActiveDays(start, end, activeDows) {
  let c = 0;
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    if (activeDows.has(weekdayToDow(d))) c++;
  }
  return c;
}

/**
 * Cierra "nuevoIngreso" de trabajadores activos según la configuración de su sede.
 * - Respeta horarioBase.nuevoIngreso: { activo, duracionDias, aplicarSoloDiasActivosBase }
 * - Si la sede NO tiene nuevoIngreso.activo === true → se omite a esos trabajadores
 *
 * @param {Object} opts
 * @param {boolean} [opts.dryRun=false] Solo simula
 * @param {Date} [opts.ahora=new Date()] Momento de referencia
 * @param {boolean} [opts.setFechaFin=true] Guardar fechaFinNuevoIngreso
 * @param {Console} [opts.logger=console]
 */
async function autoCerrarNuevoIngreso({
  dryRun = false,
  ahora = new Date(),
  setFechaFin = true,
  logger = console,
} = {}) {
  const hoy = DateTime.fromJSDate(ahora).setZone(ZONE).startOf('day');

  // 1) Candidatos
  const candidatos = await Trabajador.find(
    { estado: 'activo', nuevoIngreso: true, fechaAlta: { $ne: null } },
    '_id nombre sede sedePrincipal fechaAlta'
  ).lean();

  if (!candidatos.length) {
    return { ok: true, total: 0, cerrados: 0, omitidos: 0, detalle: [] };
  }

  // 2) Cargar sedes involucradas (mapa id → sede)
  const sedeIds = [
    ...new Set(
      candidatos
        .map(t => t.sedePrincipal ?? t.sede)
        .filter(x => x !== null && x !== undefined)
    ),
  ];
  const sedes = await Sede.find({ id: { $in: sedeIds } }, 'id nombre horarioBase').lean();
  const sedeMap = new Map(sedes.map(s => [s.id, s]));

  // 3) Decidir cierres
  const updates = [];
  const detalle = [];
  let omitidos = 0;

  for (const t of candidatos) {
    const alta = dtStartMX(t.fechaAlta);
    if (!alta.isValid) { omitidos++; continue; }

    const sedeId = t.sedePrincipal ?? t.sede;
    const sede = sedeMap.get(sedeId);
    const hb = sede?.horarioBase;
    const niCfg = hb?.nuevoIngreso;

    // Si la sede no tiene NI activo, lo omitimos (respeta intención de sede)
    if (!niCfg || niCfg.activo === false) { omitidos++; continue; }

    const duracion = Number(niCfg.duracionDias) > 0 ? Number(niCfg.duracionDias) : 30;
    const soloActivos = niCfg.aplicarSoloDiasActivosBase !== false;

    const desdeHB = hb?.desde ? dtStartMX(hb.desde) : null;
    const start = (soloActivos && desdeHB && desdeHB > alta) ? desdeHB : alta;

    let cumple = false;

    if (soloActivos) {
      // Construir set de dows activos (jornadas > 0)
      const reglas = Array.isArray(hb?.reglas) ? hb.reglas : [];
      const activeDows = new Set();
      for (const r of reglas) {
        if (Array.isArray(r.jornadas) && r.jornadas.length > 0) {
          activeDows.add(Number(r.dow));
        }
      }
      const count = countActiveDays(start, hoy, activeDows);
      cumple = count >= duracion;
      detalle.push({ trabajador: t._id, sedeId, metodo: 'dias_activos', count, duracion });
    } else {
      const diff = Math.floor(hoy.diff(start, 'days').days) + 1; // inclusivo
      cumple = diff >= duracion;
      detalle.push({ trabajador: t._id, sedeId, metodo: 'dias_calendario', diff, duracion });
    }

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
