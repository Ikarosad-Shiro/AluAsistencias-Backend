// controllers/asistenciaController.js
const Asistencia = require('../models/Asistencia');
const Calendario = require('../models/Calendario');
const CalendarioTrabajador = require('../models/CalendarioTrabajador');
const Trabajador = require('../models/Trabajador');
const { DateTime } = require('luxon');

// 🧠 Utilidad: hora HH:mm en zona CDMX
const horaMX = (fecha) => {
  try {
    return DateTime.fromJSDate(new Date(fecha))
      .setZone('America/Mexico_City')
      .toFormat('HH:mm');
  } catch {
    return '';
  }
};

// 🧠 Utilidad: YYYY-MM-DD
const isoDate = (fecha) => {
  try {
    return DateTime.fromJSDate(new Date(fecha)).toISODate();
  } catch {
    return '';
  }
};

// 🔎 Calendario sede con fallback anio/año
async function findCalendarioSede(year, sedeBase) {
  return await Calendario.findOne({
    sedes: sedeBase,
    $or: [{ anio: year }, { ['año']: year }]
  });
}

// 🔎 Calendario trabajador con fallback anio/año
async function findCalendarioTrabajador(year, trabajadorId) {
  return await CalendarioTrabajador.findOne({
    trabajador: trabajadorId,
    $or: [{ anio: year }, { ['año']: year }]
  });
}

// 📌 Obtener reporte de asistencias por trabajador y rango de fechas (multi-sede)
const obtenerReportePorTrabajador = async (req, res) => {
  try {
    const { trabajadorId } = req.params;
    const { inicio, fin, soloSedePrincipal } = req.query;

    if (!trabajadorId || !inicio || !fin) {
      return res.status(400).json({ message: 'Faltan parámetros: trabajadorId, inicio o fin.' });
    }

    const trabajador = await Trabajador.findById(trabajadorId);
    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }

    // 🧠 Sedes permitidas del trabajador (principal + foráneas)
    const sedeBase = trabajador.sedePrincipal ?? trabajador.sede;
    const sedesForaneas = Array.isArray(trabajador.sedesForaneas) ? trabajador.sedesForaneas : [];
    const sedesPermitidas = [...new Set([sedeBase, ...sedesForaneas])].filter((s) => s != null);

    // 🆔 MUY IMPORTANTE: en Asistencia.trabajador guardas el id_checador (string)
    const idChecador = (trabajador.id_checador ?? '').toString();

    // 🗓️ Normalizar rango
    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);
    fechaFin.setHours(23, 59, 59, 999);

    // 🎯 Filtro de sede (todas las permitidas, o solo principal si te lo piden)
    const filtroSede =
      soloSedePrincipal === 'true'
        ? { sede: sedeBase }
        : { sede: { $in: sedesPermitidas } };

    // 1) Asistencias en rango
    const asistencias = await Asistencia.find({
      trabajador: idChecador,
      ...filtroSede,
      $or: [
        { fecha: { $gte: inicio, $lte: fin } },
        { 'detalle.fechaHora': { $gte: fechaInicio, $lte: fechaFin } }
      ]
    }).lean();

    // 2) Calendarios (solo sede principal; trabajador por _id)
    const [calendarioSede, calendarioTrabajador] = await Promise.all([
      findCalendarioSede(fechaInicio.getFullYear(), sedeBase),
      findCalendarioTrabajador(fechaInicio.getFullYear(), trabajador._id)
    ]);

    // 3) Generar reporte día por día
    const resultado = [];
    const cursor = new Date(fechaInicio);

    while (cursor <= fechaFin) {
      const fechaStr = cursor.toISOString().split('T')[0];

      // Asistencias que caen este día (por a.fecha o por detalle.fechaHora)
      const delDia = asistencias.filter(
        (a) =>
          a.fecha === fechaStr ||
          (a.detalle || []).some((d) => isoDate(d.fechaHora) === fechaStr)
      );

      // Seleccionar primera Entrada y última Salida del día
      let entrada = null;
      let salida = null;
      delDia.forEach((a) => {
        (a.detalle || []).forEach((d) => {
          if (isoDate(d.fechaHora) !== fechaStr) return;
          if (d.tipo === 'Entrada' && !entrada) entrada = d;
          if (d.tipo === 'Salida') {
            if (!salida) salida = d;
            else if (new Date(d.fechaHora) > new Date(salida.fechaHora)) salida = d;
          }
        });
      });

      // Eventos
      const eventoSede = calendarioSede?.diasEspeciales?.find(
        (e) => isoDate(e.fecha) === fechaStr
      );
      const eventoTrabajador = calendarioTrabajador?.diasEspeciales?.find(
        (e) => isoDate(e.fecha) === fechaStr
      );

      // Jerarquía: eventoTrabajador > (entrada/salida) > eventoSede > falta
      let estado = 'Falta';
      let entTxt = entrada ? horaMX(entrada.fechaHora) : '';
      let salTxt = salida ? horaMX(salida.fechaHora) : '';

      if (eventoTrabajador) {
        if (
          (eventoTrabajador.tipo || '').toLowerCase().trim() === 'asistencia' &&
          eventoTrabajador.horaEntrada &&
          eventoTrabajador.horaSalida
        ) {
          estado = 'Asistencia Manual';
          entTxt = eventoTrabajador.horaEntrada;
          salTxt = eventoTrabajador.horaSalida;
        } else {
          estado = eventoTrabajador.tipo;
        }
      } else if (entrada && salida) {
        estado = 'Asistencia Completa';
      } else if (entrada && !salida) {
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
        estado
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    res.json(resultado);
  } catch (error) {
    console.error('❌ Error al generar reporte:', error);
    res.status(500).json({ message: 'Error interno al generar reporte.' });
  }
};

module.exports = {
  obtenerReportePorTrabajador
};
