// controllers/asistenciaController.js
const Asistencia = require('../models/Asistencia');
const Calendario = require('../models/Calendario');
const CalendarioTrabajador = require('../models/CalendarioTrabajador');
const Trabajador = require('../models/Trabajador');
const { DateTime } = require('luxon');

/* =========================
 * Helpers de fecha/hora
 * ========================= */

// HH:mm en zona CDMX
const horaMX = (fecha) => {
  try {
    return DateTime.fromJSDate(new Date(fecha))
      .setZone('America/Mexico_City')
      .toFormat('HH:mm');
  } catch {
    return '';
  }
};

// YYYY-MM-DD en zona CDMX (evita desfaces)
const isoDateMX = (fecha) => {
  try {
    return DateTime.fromJSDate(new Date(fecha))
      .setZone('America/Mexico_City')
      .toISODate();
  } catch {
    return '';
  }
};

// normaliza a number y filtra NaN
const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// quita duplicados y NaN
const uniqNumbers = (arr) =>
  Array.from(new Set((arr || []).map(toNumber).filter((n) => n !== null)));

/* =========================
 * Búsqueda de calendarios
 * ========================= */

async function findCalendarioSede(year, sedeBase) {
  return Calendario.findOne({
    sedes: sedeBase,
    $or: [{ anio: year }, { ['año']: year }]
  });
}

async function findCalendarioTrabajador(year, trabajadorId) {
  return CalendarioTrabajador.findOne({
    trabajador: trabajadorId,
    $or: [{ anio: year }, { ['año']: year }]
  });
}

/* =========================================================
 * Reporte por trabajador y rango de fechas (multi-sede)
 * - req.params.trabajadorId  = _id de Trabajador (Mongo)
 * - req.query.inicio / fin   = 'YYYY-MM-DD'
 * - req.query.soloSedePrincipal = 'true' | 'false' (opcional)
 * ========================================================= */
const obtenerReportePorTrabajador = async (req, res) => {
  try {
    const { trabajadorId } = req.params;
    const { inicio, fin, soloSedePrincipal } = req.query;

    if (!trabajadorId || !inicio || !fin) {
      return res
        .status(400)
        .json({ message: 'Faltan parámetros: trabajadorId, inicio o fin.' });
    }

    // 1) Trabajador
    const trabajador = await Trabajador.findById(trabajadorId);
    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }

    // id_checador debe consultarse como string
    const idChecador = (trabajador.id_checador ?? '').toString().trim();
    if (!idChecador) {
      return res
        .status(400)
        .json({ message: 'El trabajador no tiene id_checador configurado.' });
    }

    // 2) Sedes permitidas (principal + foráneas) como NUMBER
    const sedeBaseN = toNumber(trabajador.sedePrincipal ?? trabajador.sede);
    const sedesForaneasN = uniqNumbers(trabajador.sedesForaneas || []);
    const sedesPermitidas = uniqNumbers([sedeBaseN, ...sedesForaneasN]);

    // 3) Rango de fechas (como textos YYYY-MM-DD y objeto Date para límites)
    const inicioStr = String(inicio);
    const finStr = String(fin);

    const fechaInicio = new Date(inicioStr);
    const fechaFin = new Date(finStr);
    // incluye todo el día fin
    fechaFin.setHours(23, 59, 59, 999);

    // 4) Filtro de sede
    const filtroSede =
      soloSedePrincipal === 'true'
        ? { sede: sedeBaseN }
        : { sede: { $in: sedesPermitidas } };

    // 5) Asistencias: **solo por campo estable 'fecha'**
    const asistencias = await Asistencia.find({
      trabajador: idChecador,
      ...filtroSede,
      fecha: { $gte: inicioStr, $lte: finStr }
    }).lean();

    // 6) Calendarios (sede principal y del trabajador)
    const [calendarioSede, calendarioTrabajador] = await Promise.all([
      findCalendarioSede(fechaInicio.getFullYear(), sedeBaseN),
      findCalendarioTrabajador(fechaInicio.getFullYear(), trabajador._id)
    ]);

    // 7) Generar el reporte día por día (incluyendo ambos extremos)
    const resultado = [];
    let cursor = DateTime.fromJSDate(fechaInicio)
      .setZone('America/Mexico_City')
      .startOf('day');
    const finL = DateTime.fromJSDate(fechaFin)
      .setZone('America/Mexico_City')
      .startOf('day');

    while (cursor <= finL) {
      const fechaStr = cursor.toISODate(); // YYYY-MM-DD en CDMX

      // Asistencias del día (por 'fecha' exacta)
      const delDia = asistencias.filter((a) => a.fecha === fechaStr);

      // Selección de primera Entrada y última Salida del día
      let entrada = null;
      let salida = null;

      delDia.forEach((a) => {
        (a.detalle || []).forEach((d) => {
          // Solo considera marcas cuyo detalle cae en el mismo día en CDMX
          const dDia = isoDateMX(d.fechaHora);
          if (dDia !== fechaStr) return;

          if (d.tipo === 'Entrada') {
            if (!entrada || new Date(d.fechaHora) < new Date(entrada.fechaHora)) {
              entrada = d;
            }
          }
          if (d.tipo === 'Salida') {
            if (!salida || new Date(d.fechaHora) > new Date(salida.fechaHora)) {
              salida = d;
            }
          }
        });
      });

      // Eventos del día
      const eventoSede =
        calendarioSede?.diasEspeciales?.find((e) => isoDateMX(e.fecha) === fechaStr) ||
        null;
      const eventoTrabajadorDia =
        calendarioTrabajador?.diasEspeciales?.find(
          (e) => isoDateMX(e.fecha) === fechaStr
        ) || null;

      // Estado (prioridad: eventoTrabajador > (entrada/salida) > eventoSede > Falta)
      let estado = 'Falta';
      let entTxt = entrada ? horaMX(entrada.fechaHora) : '';
      let salTxt = salida ? horaMX(salida.fechaHora) : '';

      if (eventoTrabajadorDia) {
        const tipo = (eventoTrabajadorDia.tipo || '').toLowerCase().trim();
        if (
          tipo === 'asistencia' &&
          eventoTrabajadorDia.horaEntrada &&
          eventoTrabajadorDia.horaSalida
        ) {
          estado = 'Asistencia Manual';
          entTxt = eventoTrabajadorDia.horaEntrada;
          salTxt = eventoTrabajadorDia.horaSalida;
        } else {
          estado = eventoTrabajadorDia.tipo || 'Evento';
        }
      } else if (entrada && salida) {
        estado = 'Asistencia Completa';
      } else if (entrada && !salida) {
        // si ya pasó el día sin salida, lo marcamos como salida automática
        const hoyMX = DateTime.now().setZone('America/Mexico_City').toISODate();
        estado = fechaStr < hoyMX ? 'Salida Automática' : 'Entrada sin salida';
      } else if (eventoSede) {
        estado = eventoSede.tipo || 'Evento';
      } else {
        estado = 'Falta';
      }

      resultado.push({
        fecha: fechaStr,
        entrada: entTxt,
        salida: salTxt,
        eventoSede: eventoSede?.tipo || '',
        eventoTrabajador: eventoTrabajadorDia?.tipo || '',
        estado
      });

      cursor = cursor.plus({ days: 1 });
    }

    return res.json(resultado);
  } catch (error) {
    console.error('❌ Error al generar reporte:', error);
    return res
      .status(500)
      .json({ message: 'Error interno al generar reporte.', detail: error?.message });
  }
};

module.exports = {
  obtenerReportePorTrabajador
};
