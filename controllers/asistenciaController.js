// 📁 controllers/asistenciaController.js
const Asistencia = require('../models/Asistencia');
const Calendario = require('../models/Calendario');
const CalendarioTrabajador = require('../models/CalendarioTrabajador');
const Trabajador = require('../models/Trabajador');

// 🧠 Utilidad para extraer hora HH:mm de un Date
const extraerHora = (fecha) => {
  const d = new Date(fecha);
  return d.toTimeString().split(':').slice(0, 2).join(':');
};

// 📌 Obtener reporte de asistencias por trabajador y rango de fechas
const obtenerReportePorTrabajador = async (req, res) => {
  try {
    const { trabajadorId } = req.params;
    const { inicio, fin } = req.query;
    if (!trabajadorId || !inicio || !fin) {
      return res.status(400).json({ message: 'Faltan parámetros: trabajadorId, inicio o fin.' });
    }

    const trabajador = await Trabajador.findById(trabajadorId);
    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }

    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);

    // Obtener asistencias reales
    const asistencias = await Asistencia.find({
      trabajador: trabajadorId,
      fecha: { $gte: fechaInicio, $lte: fechaFin }
    });

    // Obtener eventos del calendario de la sede
    const calendarioSede = await Calendario.findOne({
      anio: fechaInicio.getFullYear(),
      sedes: trabajador.sede
    });

    // Obtener eventos del calendario del trabajador
    const calendarioTrabajador = await CalendarioTrabajador.findOne({
      trabajador: trabajadorId,
      anio: fechaInicio.getFullYear()
    });

    // Armar reporte día por día
    const resultado = [];
    for (let d = new Date(fechaInicio); d <= fechaFin; d.setDate(d.getDate() + 1)) {
      const fechaStr = new Date(d).toISOString().split('T')[0];

      const asistencia = asistencias.find(a => a.fecha.toISOString().startsWith(fechaStr));
      const eventoSede = calendarioSede?.diasEspeciales?.find(e => e.fecha.toISOString().startsWith(fechaStr));
      const eventoTrabajador = calendarioTrabajador?.diasEspeciales?.find(e => e.fecha.toISOString().startsWith(fechaStr));

      const entrada = asistencia?.detalle?.find(e => e.tipo === 'Entrada');
      const salida = asistencia?.detalle?.find(e => e.tipo === 'Salida');

      let estado = 'Falta';
      if (eventoTrabajador) estado = eventoTrabajador.tipo;
      else if (eventoSede) estado = eventoSede.tipo;
      else if (entrada && salida) estado = 'Asistencia Completa';
      else if (entrada && !salida) estado = 'Salida Automática';

      resultado.push({
        fecha: fechaStr,
        entrada: entrada ? extraerHora(entrada.fechaHora) : '',
        salida: salida ? extraerHora(salida.fechaHora) : '',
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

module.exports = {
  obtenerReportePorTrabajador
};
