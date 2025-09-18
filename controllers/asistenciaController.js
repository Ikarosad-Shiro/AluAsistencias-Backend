const Asistencia = require('../models/Asistencia');
const Calendario = require('../models/Calendario');
const CalendarioTrabajador = require('../models/CalendarioTrabajador');
const Trabajador = require('../models/Trabajador');
const { DateTime } = require('luxon');

// ===== Zona horaria (CDMX) =============================================
const ZONE = 'America/Mexico_City';

// Día YYYY-MM-DD en CDMX a partir de cualquier tipo (string ISO o Date)
const dayMX = (value) => {
  if (!value) return '';
  const dt = typeof value === 'string'
    ? DateTime.fromISO(value) // respeta offset si viene "-06:00" o "Z"
    : DateTime.fromJSDate(new Date(value));
  return dt.setZone(ZONE).toISODate(); // día en CDMX, sin saltos raros
};

// Hora HH:mm (24h) en CDMX
const timeMX = (value) => {
  if (!value) return '';
  try {
    const dt = typeof value === 'string'
      ? DateTime.fromISO(value)
      : DateTime.fromJSDate(new Date(value));
    return dt.setZone(ZONE).toFormat('HH:mm');
  } catch {
    return '';
  }
};

// ====== Calendarios con fallback anio/año ==============================
async function findCalendarioSede(year, sedeBase) {
  if (sedeBase == null) return null;
  return Calendario.findOne({
    sedes: sedeBase,
    $or: [{ anio: year }, { ['año']: year }]
  }).lean();
}

async function findCalendarioTrabajador(year, trabajadorId) {
  if (!trabajadorId) return null;
  return CalendarioTrabajador.findOne({
    trabajador: trabajadorId,
    $or: [{ anio: year }, { ['año']: year }]
  }).lean();
}

// Carga calendarios de todos los años involucrados en el rango [inicio, fin]
async function loadCalendariosRango(fechaInicio, fechaFin, sedeBase, trabajadorId) {
  const yStart = DateTime.fromJSDate(fechaInicio).setZone(ZONE).year;
  const yEnd   = DateTime.fromJSDate(fechaFin).setZone(ZONE).year;
  const years = [];
  for (let y = yStart; y <= yEnd; y++) years.push(y);

  const [sedeArr, trabArr] = await Promise.all([
    Promise.all(years.map((y) => findCalendarioSede(y, sedeBase))),
    Promise.all(years.map((y) => findCalendarioTrabajador(y, trabajadorId)))
  ]);

  const sedeMap = new Map();
  const trabMap = new Map();
  years.forEach((y, idx) => {
    if (sedeArr[idx]) sedeMap.set(y, sedeArr[idx]);
    if (trabArr[idx]) trabMap.set(y, trabArr[idx]);
  });
  return { sedeMap, trabMap };
}

// ===================== Reporte por trabajador (multi-sede) =====================
const obtenerReportePorTrabajador = async (req, res) => {
  try {
    const { trabajadorId } = req.params;
    const { inicio, fin, soloSedePrincipal } = req.query;

    if (!trabajadorId || !inicio || !fin) {
      return res.status(400).json({ message: 'Faltan parámetros: trabajadorId, inicio o fin.' });
    }

    const trabajador = await Trabajador.findById(trabajadorId).lean();
    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }

    // Sede principal / compatibilidad con campo antiguo
    const sedeBase = (trabajador.sedePrincipal ?? trabajador.sede);
    const sedesForaneas = Array.isArray(trabajador.sedesForaneas) ? trabajador.sedesForaneas : [];

    // IMPORTANTE: en Asistencia.trabajador guardas el id_checador (string)
    const idChecador = (trabajador.id_checador ?? '').toString();

    // Rango de fechas (límite a fin de día)
    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);
    fechaFin.setHours(23, 59, 59, 999);

    // --- Filtro de sede (CORREGIDO) ---
    const hasForaneas = sedesForaneas.length > 0;
    let filtroSede = {};

    if (soloSedePrincipal === 'true') {
      filtroSede = (sedeBase != null) ? { sede: sedeBase } : {};
    } else if (hasForaneas) {
      const sedesIn = [...new Set([sedeBase, ...sedesForaneas])].filter((s) => s != null);
      filtroSede = { sede: { $in: sedesIn } };
    } else {
      // Sin foráneas registradas: NO filtrar por sede (leer todas)
      filtroSede = {};
    }

    // 1) Asistencias en rango (por fecha YYYY-MM-DD o por detalle.fechaHora)
    const asistencias = await Asistencia.find({
      trabajador: idChecador,
      ...filtroSede,
      $or: [
        { fecha: { $gte: inicio, $lte: fin } },
        { 'detalle.fechaHora': { $gte: fechaInicio, $lte: fechaFin } }
      ]
    }).lean();

    // 2) Calendarios para todos los años del rango (sede principal y trabajador)
    const { sedeMap, trabMap } = await loadCalendariosRango(fechaInicio, fechaFin, sedeBase, trabajador._id);

    // 3) Generar reporte día a día (en CDMX)
    const resultado = [];
    let d = DateTime.fromJSDate(fechaInicio).setZone(ZONE).startOf('day');
    const finDT = DateTime.fromJSDate(fechaFin).setZone(ZONE).startOf('day');

    for (; d <= finDT; d = d.plus({ days: 1 })) {
      const fechaStr = d.toISODate();
      const year = d.year;

      // Asistencias que caen en ese día (por string fecha o por detalle dentro del día)
      const delDia = (asistencias || []).filter((a) =>
        a.fecha === fechaStr || (a.detalle || []).some((x) => dayMX(x.fechaHora) === fechaStr)
      );

      // Calcular primera Entrada y última Salida del día, guardando sede
      let entradaReg = null;
      let salidaReg = null;
      const sedesDia = new Set();

      for (const a of delDia) {
        if (a.sede != null) sedesDia.add(a.sede);
        for (const reg of (a.detalle || [])) {
          const sedeReg = (reg.sede != null) ? reg.sede : a.sede;
          if (sedeReg != null) sedesDia.add(sedeReg);
          if (dayMX(reg.fechaHora) !== fechaStr) continue;

          if (reg.tipo === 'Entrada') {
            if (!entradaReg || new Date(reg.fechaHora) < new Date(entradaReg.fechaHora)) {
              entradaReg = { ...reg, sede: sedeReg };
            }
          }
          if (reg.tipo && reg.tipo.startsWith('Salida')) {
            if (!salidaReg || new Date(reg.fechaHora) > new Date(salidaReg.fechaHora)) {
              salidaReg = { ...reg, sede: sedeReg };
            }
          }
        }
      }

      // Eventos del día (de sede principal y del trabajador)
      const calendarioSede = sedeMap.get(year);
      const calendarioTrab = trabMap.get(year);

      const eventoSede = calendarioSede?.diasEspeciales?.find((e) => dayMX(e.fecha) === fechaStr);
      const eventoTrabajador = calendarioTrab?.diasEspeciales?.find((e) => dayMX(e.fecha) === fechaStr);

      // Jerarquía: eventoTrabajador > (entrada/salida) > eventoSede > falta
      let estado = 'Falta';
      let entTxt = entradaReg ? timeMX(entradaReg.fechaHora) : '';
      let salTxt = salidaReg ? timeMX(salidaReg.fechaHora) : '';

      if (eventoTrabajador) {
        const tipoEvt = (eventoTrabajador.tipo || '').toLowerCase().trim();
        if (tipoEvt === 'asistencia' && eventoTrabajador.horaEntrada && eventoTrabajador.horaSalida) {
          estado = 'Asistencia Manual';
          entTxt = eventoTrabajador.horaEntrada;
          salTxt = eventoTrabajador.horaSalida;
        } else {
          estado = eventoTrabajador.tipo;
        }
      } else if (entradaReg && salidaReg) {
        estado = 'Asistencia Completa';
      } else if (entradaReg && !salidaReg) {
        // Si quieres marcar Pendiente SOLO para el día actual en CDMX, descomenta:
        // const hoyMX = DateTime.now().setZone(ZONE).toISODate();
        // estado = (fechaStr === hoyMX) ? 'Pendiente' : 'Salida Automática';
        estado = 'Salida Automática';
      } else if (eventoSede) {
        estado = eventoSede.tipo;
      } else {
        estado = 'Falta';
      }

      resultado.push({
        fecha: fechaStr,
        entrada: entTxt,
        salida: salTxt,
        eventoSede: eventoSede?.tipo || '',
        eventoTrabajador: eventoTrabajador?.tipo || '',
        estado,
        // 👇 Info multi‑sede para usar en el PDF
        sedeEntrada: entradaReg?.sede ?? null,
        sedeSalida: salidaReg?.sede ?? null,
        sedesPresentes: Array.from(sedesDia)
      });
    }

    return res.json(resultado);
  } catch (error) {
    console.error('❌ Error al generar reporte:', error);
    return res.status(500).json({ message: 'Error interno al generar reporte.' });
  }
};

module.exports = {
  obtenerReportePorTrabajador,
};
