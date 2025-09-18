// controllers/asistenciaController.js
const Asistencia = require('../models/Asistencia');
const Calendario = require('../models/Calendario');
const CalendarioTrabajador = require('../models/CalendarioTrabajador');
const Trabajador = require('../models/Trabajador');
const { DateTime } = require('luxon');

// ===== Helpers de zona horaria (CDMX) =========================
const ZONE = 'America/Mexico_City';

// Día YYYY-MM-DD en CDMX a partir de cualquier tipo (string ISO o Date)
const dayMX = (value) => {
  if (!value) return '';
  const dt = typeof value === 'string'
    ? DateTime.fromISO(value)                 // respeta offset si viene "-06:00" o "Z"
    : DateTime.fromJSDate(new Date(value));  // normaliza si viene como Date
  return dt.setZone(ZONE).toISODate();       // <-- día en CDMX, sin saltarse al siguiente
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

// Calendarios con fallback anio/año
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

// ===================== Reporte por trabajador (multi-sede) =====================
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

    // Sedes del trabajador
    const sedeBase = trabajador.sedePrincipal ?? trabajador.sede;
    const sedesForaneas = Array.isArray(trabajador.sedesForaneas) ? trabajador.sedesForaneas : [];
    const sedesPermitidas = [...new Set([sedeBase, ...sedesForaneas])].filter((s) => s != null);

    // MUY IMPORTANTE: en Asistencia.trabajador guardas el id_checador (string)
    const idChecador = (trabajador.id_checador ?? '').toString();

    // Rango de fechas (límite de día)
    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);
    fechaFin.setHours(23, 59, 59, 999);

    // 🔧 Filtro de sede:
    // - Si piden solo principal → filtra
    // - Si NO piden solo principal y no hay sedesForaneas registradas → NO filtra por sede (trae todas)
    // - Si hay sedesForaneas → usa $in
    let filtroSede = {};
    if (soloSedePrincipal === 'true') {
      filtroSede = { sede: sedeBase };
    } else if ((sedesPermitidas || []).length) {
      filtroSede = { sede: { $in: sedesPermitidas } };
    } else {
      filtroSede = {}; // sin filtro: multi-sede “libre”
    }

    // 1) Asistencias en rango
    const asistencias = await Asistencia.find({
      trabajador: idChecador,
      ...filtroSede,
      $or: [
        { fecha: { $gte: inicio, $lte: fin } },                 // campo string YYYY-MM-DD
        { 'detalle.fechaHora': { $gte: fechaInicio, $lte: fechaFin } } // por fechaHora
      ]
    }).lean();

    // 2) Calendarios (solo sede principal; trabajador por _id)
    const [calendarioSede, calendarioTrabajador] = await Promise.all([
      findCalendarioSede(fechaInicio.getFullYear(), sedeBase),
      findCalendarioTrabajador(fechaInicio.getFullYear(), trabajador._id)
    ]);

    // 3) Generar reporte día a día (en CDMX)
    const resultado = [];
    const cursor = DateTime.fromJSDate(fechaInicio).setZone(ZONE).startOf('day');
    const finDT  = DateTime.fromJSDate(fechaFin).setZone(ZONE).startOf('day');

    for (let d = cursor; d <= finDT; d = d.plus({ days: 1 })) {
      const fechaStr = d.toISODate();

      // Asistencias que “caen” en ese día en CDMX
      const delDia = asistencias.filter(a =>
        a.fecha === fechaStr ||
        (a.detalle || []).some(x => dayMX(x.fechaHora) === fechaStr)
      );

      // Tomar primera Entrada y última Salida del día
      let entrada = null;
      let salida = null;
      delDia.forEach(a => {
        (a.detalle || []).forEach(reg => {
          if (dayMX(reg.fechaHora) !== fechaStr) return;
          if (reg.tipo === 'Entrada' && !entrada) entrada = reg;
          if (reg.tipo === 'Salida') {
            if (!salida) salida = reg;
            else if (new Date(reg.fechaHora) > new Date(salida.fechaHora)) salida = reg;
          }
        });
      });

      // Eventos del día (en CDMX)
      const eventoSede = calendarioSede?.diasEspeciales?.find(e => dayMX(e.fecha) === fechaStr);
      const eventoTrabajador = calendarioTrabajador?.diasEspeciales?.find(e => dayMX(e.fecha) === fechaStr);

      // Jerarquía: eventoTrabajador > (entrada/salida) > eventoSede > falta
      let estado = 'Falta';
      let entTxt = entrada ? timeMX(entrada.fechaHora) : '';
      let salTxt = salida ? timeMX(salida.fechaHora) : '';

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
    }

    res.json(resultado);
  } catch (error) {
    console.error('❌ Error al generar reporte:', error);
    res.status(500).json({ message: 'Error interno al generar reporte.' });
  }
};

module.exports = { obtenerReportePorTrabajador };
