// controllers/asistenciaController.js
const Asistencia = require('../models/Asistencia');
const Calendario = require('../models/Calendario');
const CalendarioTrabajador = require('../models/CalendarioTrabajador');
const Trabajador = require('../models/Trabajador');
const Sede = require('../models/Sede');
const { DateTime } = require('luxon');

const {
  ZONE,
  dayMX,
  extraerMarcasDelDia,
  interpretarDia
} = require('../services/asistenciaRulesService');

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
  const yEnd = DateTime.fromJSDate(fechaFin).setZone(ZONE).year;

  const years = [];
  for (let y = yStart; y <= yEnd; y++) {
    years.push(y);
  }

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

// ===================== Reporte por trabajador =====================
const obtenerReportePorTrabajador = async (req, res) => {
  try {
    const { trabajadorId } = req.params;
    const { inicio, fin, soloSedePrincipal } = req.query;

    if (!trabajadorId || !inicio || !fin) {
      return res.status(400).json({
        message: 'Faltan parámetros: trabajadorId, inicio o fin.'
      });
    }

    const trabajador = await Trabajador.findById(trabajadorId).lean();

    if (!trabajador) {
      return res.status(404).json({
        message: 'Trabajador no encontrado.'
      });
    }

    // Sede principal / compatibilidad con campo antiguo
    const sedeBase = trabajador.sedePrincipal ?? trabajador.sede;
    const sedesForaneas = Array.isArray(trabajador.sedesForaneas)
      ? trabajador.sedesForaneas
      : [];

    // Sede principal completa, para obtener horarioBase si existe
    const sedeDoc = sedeBase != null
      ? await Sede.findOne({ id: Number(sedeBase) }).lean()
      : null;

    // En Asistencia.trabajador guardamos el id_checador como string.
    // Se deja fallback con _id por históricos.
    const idChecador = (trabajador.id_checador ?? '').toString();

    const posiblesIds = [trabajador?._id?.toString()].filter(Boolean);
    if (idChecador) posiblesIds.push(idChecador);

    // Rango de fechas
    const fechaInicio = DateTime.fromISO(inicio, { zone: ZONE }).startOf('day').toJSDate();
    const fechaFin = DateTime.fromISO(fin, { zone: ZONE }).endOf('day').toJSDate();

    // Filtro de sede
    const hasForaneas = sedesForaneas.length > 0;
    let filtroSede = {};

    if (soloSedePrincipal === 'true') {
      filtroSede = sedeBase != null ? { sede: sedeBase } : {};
    } else if (hasForaneas) {
      const sedesIn = [...new Set([sedeBase, ...sedesForaneas])]
        .filter((s) => s != null)
        .map(Number);

      filtroSede = { sede: { $in: sedesIn } };
    } else {
      // Si no tiene foráneas, mantenemos compatibilidad leyendo todas.
      filtroSede = {};
    }

    // 1) Asistencias en rango.
    // Compatible con formato viejo y formato nuevo.
    const asistencias = await Asistencia.find({
      trabajador: { $in: posiblesIds },
      ...filtroSede,
      $or: [
        // Formato general por fecha YYYY-MM-DD
        { fecha: { $gte: inicio, $lte: fin } },

        // Formato viejo
        { 'detalle.fechaHora': { $gte: fechaInicio, $lte: fechaFin } },

        // Formato nuevo
        { 'registros.fechaHora': { $gte: fechaInicio, $lte: fechaFin } },
        { 'primerRegistro.fechaHora': { $gte: fechaInicio, $lte: fechaFin } },
        { 'ultimoRegistro.fechaHora': { $gte: fechaInicio, $lte: fechaFin } }
      ]
    }).lean();

    // 2) Calendarios para todos los años del rango
    const { sedeMap, trabMap } = await loadCalendariosRango(
      fechaInicio,
      fechaFin,
      sedeBase,
      trabajador._id
    );

    // 3) Generar reporte día por día
    const resultado = [];

    let cursor = DateTime.fromJSDate(fechaInicio).setZone(ZONE).startOf('day');
    const finDT = DateTime.fromJSDate(fechaFin).setZone(ZONE).startOf('day');

    for (; cursor <= finDT; cursor = cursor.plus({ days: 1 })) {
      const fechaStr = cursor.toISODate();
      const year = cursor.year;

      // Asistencias que corresponden a este día.
      // Incluye formato viejo y nuevo.
      const asistenciasDelDia = (asistencias || []).filter((a) => {
        if (a.fecha === fechaStr) return true;

        const enDetalle = (a.detalle || []).some((x) => dayMX(x.fechaHora) === fechaStr);
        const enRegistros = (a.registros || []).some((x) => dayMX(x.fechaHora) === fechaStr);
        const enPrimer = a.primerRegistro?.fechaHora && dayMX(a.primerRegistro.fechaHora) === fechaStr;
        const enUltimo = a.ultimoRegistro?.fechaHora && dayMX(a.ultimoRegistro.fechaHora) === fechaStr;

        return enDetalle || enRegistros || enPrimer || enUltimo;
      });

      const calendarioSede = sedeMap.get(year);
      const calendarioTrab = trabMap.get(year);

      const eventoSede = calendarioSede?.diasEspeciales?.find(
        (e) => dayMX(e.fecha) === fechaStr
      );

      const eventoTrabajador = calendarioTrab?.diasEspeciales?.find(
        (e) => dayMX(e.fecha) === fechaStr
      );

      // Extrae entrada/salida compatible con formato viejo y nuevo.
      const marcas = extraerMarcasDelDia(asistenciasDelDia, fechaStr);

      // Interpreta el estado final con la nueva jerarquía:
      // evento trabajador > asistencia real > evento sede > descanso > falta
      const interpretacion = interpretarDia({
        fechaStr,
        sedeDoc,
        marcas,
        eventoTrabajador,
        eventoSede
      });

      resultado.push({
        fecha: fechaStr,
        entrada: interpretacion.entrada,
        salida: interpretacion.salida,

        eventoSede: eventoSede?.tipo || '',
        eventoTrabajador: eventoTrabajador?.tipo || '',

        estado: interpretacion.estado,

        // Información multi-sede
        sedeEntrada: marcas.entradaReg?.sede ?? null,
        sedeSalida: marcas.salidaReg?.sede ?? null,
        sedesPresentes: marcas.sedesPresentes || [],

        // Información nueva útil para depurar o mostrar después
        totalRegistros: marcas.totalRegistros || 0,
        tipoJornada: interpretacion.horario?.tipoJornada || '',
        entradaEsperada: interpretacion.horario?.entradaEsperada || '',
        salidaEsperada: interpretacion.horario?.salidaEsperada || '',
        fuenteHorario: interpretacion.horario?.fuente || '',
        fuenteEstado: interpretacion.fuenteEstado || ''
      });
    }

    return res.json(resultado);
  } catch (error) {
    console.error('❌ Error al generar reporte:', error);
    return res.status(500).json({
      message: 'Error interno al generar reporte.'
    });
  }
};

module.exports = {
  obtenerReportePorTrabajador
};