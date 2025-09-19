// routes/asistencias.js
const express = require('express');
const { DateTime } = require('luxon');

const Asistencia = require('../models/Asistencia');
const Trabajador = require('../models/Trabajador');
const Sede = require('../models/Sede');
const Calendario = require('../models/Calendario');
const CalendarioTrabajador = require('../models/CalendarioTrabajador');

const { obtenerReportePorTrabajador } = require('../controllers/asistenciaController');

const router = express.Router();

// 🧩 Helpers
const isoDay = (d) => {
  if (!d) return '';
  const dt = typeof d === 'string' ? DateTime.fromISO(d) : DateTime.fromJSDate(new Date(d));
  return dt.setZone('America/Mexico_City').toISODate();
};

// Emojis para tipos de evento (para PDFs/visuales)
function obtenerEmojiPorTipo(tipo) {
  switch (tipo) {
    case 'Vacaciones': return '🌴 Vacaciones';
    case 'Vacaciones Pagadas': return '💰 Vacaciones Pagadas';
    case 'Permiso': return '📄 Permiso';
    case 'Permiso con goce de sueldo': return '📄 Permiso con Goce';
    case 'Incapacidad': return '🩺 Incapacidad';
    case 'Falta': return '❌ Falta Manual';
    case 'Media Jornada': return '🌓 Media Jornada';
    case 'Evento': return '🎤 Evento';
    case 'Capacitación': return '📚 Capacitación';
    case 'Festivo': return '🎉 Festivo';
    case 'Descanso': return '😴 Descanso';
    case 'Puente': return '🌉 Puente';
    case 'Suspensión': return '🚫 Suspensión';
    default: return tipo;
  }
}

// 📌 Registrar asistencia (desde servidor local)
router.post('/registrar', async (req, res) => {
  try {
    const { trabajadorId, sede, tipo } = req.body;
    if (!['Entrada', 'Salida'].includes(tipo)) {
      return res.status(400).json({ message: 'Tipo de asistencia inválido.' });
    }

    // Hora CDMX
    const now = DateTime.now().setZone('America/Mexico_City');
    const ahoraISO = now.toISO();       // 2025-05-13T10:00:00-06:00
    const fechaStr = now.toISODate();   // 2025-05-13

    // Evitar duplicados por tipo en el día
    const existe = await Asistencia.findOne({
      trabajador: trabajadorId, // aquí se espera el id_checador (string)
      fecha: fechaStr,
      'detalle.tipo': tipo
    });

    if (existe) {
      return res.status(409).json({ message: `Ya existe una ${tipo} registrada para hoy.` });
    }

    const nuevaAsistencia = new Asistencia({
      trabajador: trabajadorId, // id_checador
      sede,
      fecha: fechaStr,
      detalle: [{ tipo, fechaHora: ahoraISO }]
    });

    await nuevaAsistencia.save();
    res.json({ message: '✅ Asistencia registrada correctamente.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '❌ Error al registrar asistencia.', error });
  }
});

// 📌 Reporte por trabajador (usa el controlador multi-sede)
router.get('/reporte/trabajador/:trabajadorId', obtenerReportePorTrabajador);

// 📌 Ruta unificada para PDF/Excel del TRABAJADOR
//     (multi-sede para asistencias, calendario de sede principal)
//     🔁 NUEVO: si se pasa ?ignorarSede=true, NO se filtra por sede (para el calendario del detalle).
router.get('/unificado/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { inicio, fin, soloSedePrincipal, ignorarSede } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ message: "Parámetros 'inicio' y 'fin' requeridos." });
    }

    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);
    fechaFin.setHours(23, 59, 59, 999);

    const trabajador = await Trabajador.findById(id).lean();
    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }

    const sedeBase = trabajador.sedePrincipal ?? trabajador.sede;
    const sedesForaneas = Array.isArray(trabajador.sedesForaneas) ? trabajador.sedesForaneas : [];
    const sedesPermitidas = [...new Set([sedeBase, ...sedesForaneas])].filter((s) => s != null);

    // id_checador como string + fallback _id (por registros históricos)
    const idChecador = (trabajador.id_checador ?? '').toString();
    const posiblesIds = [trabajador?._id?.toString()].filter(Boolean);
    if (idChecador) posiblesIds.push(idChecador);

    // 🔧 Filtro de sede
    //     - Por defecto: misma lógica previa (respeta principal/foráneas).
    //     - Si ignorarSede === 'true': NO filtramos por sede (para mezclar todas en el calendario).
    let filtroSede = {};
    if (ignorarSede === 'true') {
      filtroSede = {};
    } else if (soloSedePrincipal === 'true') {
      filtroSede = (sedeBase != null) ? { sede: sedeBase } : {};
    } else if ((sedesPermitidas || []).length) {
      filtroSede = { sede: { $in: sedesPermitidas } };
    } else {
      filtroSede = {}; // sin filtro si no hay foráneas registradas
    }

    const [asistencias, calendarioTrabajador, calendarioSede] = await Promise.all([
      Asistencia.find({
        trabajador: { $in: posiblesIds },
        ...filtroSede,
        $or: [
          { fecha: { $gte: inicio, $lte: fin } },
          { 'detalle.fechaHora': { $gte: fechaInicio, $lte: fechaFin } }
        ]
      }).lean(),
      CalendarioTrabajador.findOne({
        trabajador: trabajador._id,
        $or: [{ anio: fechaInicio.getFullYear() }, { ['año']: fechaInicio.getFullYear() }]
      }).lean(),
      // calendario SOLO de la sede principal
      Calendario.findOne({
        sedes: sedeBase,
        $or: [{ anio: fechaInicio.getFullYear() }, { ['año']: fechaInicio.getFullYear() }]
      }).lean()
    ]);

    // Aplana y normaliza el detalle (incluye sede por registro)
    const asistenciasFormateadas = (asistencias || []).map((a) => ({
      ...a,
      detalle: (a.detalle || []).map((d) => ({
        tipo: d.tipo,
        fechaHora: new Date(d.fechaHora).toISOString(),
        salida_automatica: !!d.salida_automatica,
        sincronizado: !!d.sincronizado,
        sede: d.sede ?? a.sede ?? null
      }))
    }));

    res.json({
      asistencias: asistenciasFormateadas,
      eventosTrabajador: calendarioTrabajador?.diasEspeciales || [],
      eventosSede: calendarioSede?.diasEspeciales || []
    });
  } catch (error) {
    console.error('❌ Error en /unificado:', error);
    res.status(500).json({ message: 'Error interno al obtener datos unificados.' });
  }
});

// 🆕 Unificado por SEDE (reporte sede → mantiene filtro por sede estricta)
router.get('/unificado-sede/:sedeId', async (req, res) => {
  try {
    const { sedeId } = req.params;
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ message: "Parámetros 'inicio' y 'fin' requeridos." });
    }

    const fechaInicio = DateTime.fromISO(inicio).startOf('day');
    const fechaFin = DateTime.fromISO(fin).endOf('day');

    const trabajadores = await Trabajador.find({ sede: Number(sedeId) }).lean();
    if (!trabajadores.length) {
      return res.status(404).json({ message: 'No hay trabajadores en esta sede.' });
    }

    const calendarioSede = await Calendario.findOne({
      sedes: Number(sedeId),
      $or: [{ anio: fechaInicio.year }, { ['año']: fechaInicio.year }]
    }).lean();

    const resultados = [];

    for (const trabajador of trabajadores) {
      const asistencias = await Asistencia.find({
        trabajador: (trabajador.id_checador ?? '').toString(),
        sede: Number(sedeId),
        $or: [
          { fecha: { $gte: inicio, $lte: fin } },
          { 'detalle.fechaHora': { $gte: fechaInicio.toJSDate(), $lte: fechaFin.toJSDate() } }
        ]
      }).lean();

      const calendarioTrabajador = await CalendarioTrabajador.findOne({
        trabajador: trabajador._id,
        $or: [{ anio: fechaInicio.year }, { ['año']: fechaInicio.year }]
      }).lean();

      const datosPorDia = {};
      let cursor = fechaInicio;

      while (cursor <= fechaFin) {
        const fechaStr = cursor.toISODate();

        const entradas = asistencias
          .flatMap((a) => a.detalle || [])
          .filter((d) => d.tipo === 'Entrada' && isoDay(d.fechaHora) === fechaStr);
        const salidas = asistencias
          .flatMap((a) => a.detalle || [])
          .filter((d) => d.tipo === 'Salida' && isoDay(d.fechaHora) === fechaStr);

        const eventoTrab = calendarioTrabajador?.diasEspeciales?.find(
          (e) => isoDay(e.fecha) === fechaStr
        );
        const eventoSed = calendarioSede?.diasEspeciales?.find(
          (e) => isoDay(e.fecha) === fechaStr
        );

        // Formato visual (para PDF de sede)
        const fmt = (iso) =>
          DateTime.fromJSDate(new Date(iso))
            .setZone('America/Mexico_City')
            .toFormat('hh:mm a');

        let entrada = entradas.length ? fmt(entradas[0].fechaHora) : '';
        let salida = salidas.length ? fmt(salidas[salidas.length - 1].fechaHora) : '';

        let estado = '';
        if (eventoTrab) {
          if (
            (eventoTrab.tipo || '').toLowerCase().trim() === 'asistencia' &&
            eventoTrab.horaEntrada &&
            eventoTrab.horaSalida
          ) {
            estado = '✅ Asistencia Manual';
            entrada = eventoTrab.horaEntrada;
            salida = eventoTrab.horaSalida;
          } else {
            estado = obtenerEmojiPorTipo(eventoTrab.tipo);
            entrada = estado;
            salida = '';
          }
        } else if (entrada && salida) {
          estado = '✅ Asistencia Completa';
        } else if (entrada && !salida) {
          estado = '⏳ Entrada sin salida';
          salida = '⏳';
        } else if (eventoSed) {
          estado = obtenerEmojiPorTipo(eventoSed.tipo);
          entrada = estado;
          salida = '';
        } else {
          estado = '❌ Falta';
          entrada = '—';
          salida = '—';
        }

        datosPorDia[fechaStr] = { entrada, salida, estado };
        cursor = cursor.plus({ days: 1 });
      }

      resultados.push({
        nombre: [trabajador.nombre, trabajador.apellido, trabajador.segundoApellido].filter(Boolean).join(' '),
        id: trabajador._id,
        datosPorDia
      });
    }

    res.json({
      sede: Number(sedeId),
      rango: { inicio, fin },
      trabajadores: resultados
    });
  } catch (error) {
    console.error('❌ Error en /unificado-sede:', error);
    res.status(500).json({ message: 'Error al obtener datos por sede.', error });
  }
});

// 📌 Asistencias de HOY (panel)
router.get('/hoy', async (req, res) => {
  try {
    const hoy = DateTime.now().setZone('America/Mexico_City').toISODate();

    // Nota: si tu colección no guarda `estado` calculado, podrías quitar el filtro de estado.
    const asistencias = await Asistencia.find({
      fecha: hoy,
      estado: { $in: ['Asistencia Completa', 'Pendiente', 'Salida Automática'] }
    }).lean();

    // Al menos tenga una marca de inicio
    const asistenciasFiltradas = (asistencias || []).filter((a) =>
      (a.detalle || []).some((d) => ['Entrada', 'Asistencia', 'Entrada Manual'].includes(d.tipo))
    );

    const resultado = await Promise.all(
      asistenciasFiltradas.map(async (a) => {
        const trabajadorDoc = await Trabajador.findOne({
          id_checador: a.trabajador,
          sede: a.sede
        }).lean();

        const sedeDoc = await Sede.findOne({ id: a.sede }).lean();

        const nombreCompleto = [trabajadorDoc?.nombre, trabajadorDoc?.apellido, trabajadorDoc?.segundoApellido]
          .filter(Boolean)
          .join(' ');

        const entrada = (a.detalle || []).find((d) => ['Entrada', 'Asistencia', 'Entrada Manual'].includes(d.tipo));

        let horaEntrada = null;
        if (entrada?.fechaHora) {
          try {
            horaEntrada = DateTime.fromJSDate(new Date(entrada.fechaHora))
              .setZone('America/Mexico_City')
              .toFormat('hh:mm a');
          } catch (e) {
            console.error('❌ Error al formatear hora de entrada:', e.message);
          }
        }

        return {
          _id: trabajadorDoc?._id,
          nombre: nombreCompleto || 'Desconocido',
          hora: horaEntrada,
          sede: sedeDoc?.nombre || 'Sin sede'
        };
      })
    );

    // Orden por hora subida
    resultado.sort((a, b) => {
      if (!a.hora) return 1;
      if (!b.hora) return -1;
      const [hA, mAraw] = a.hora.split(':');
      const [hB, mBraw] = b.hora.split(':');
      const mA = parseInt(mAraw, 10);
      const mB = parseInt(mBraw, 10);
      const ampmA = a.hora.toLowerCase().includes('pm');
      const ampmB = b.hora.toLowerCase().includes('pm');
      const HH_A = (parseInt(hA, 10) % 12) + (ampmA ? 12 : 0);
      const HH_B = (parseInt(hB, 10) % 12) + (ampmB ? 12 : 0);
      return HH_A * 60 + mA - (HH_B * 60 + mB);
    });

    res.json(resultado);
  } catch (error) {
    console.error('❌ Error al obtener asistencias de hoy:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

module.exports = router;
