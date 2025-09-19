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
//     🔁 Si se pasa ?ignorarSede=true, NO se filtra por sede (mezcla todas).
router.get('/unificado/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { inicio, fin, soloSedePrincipal, ignorarSede } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ message: "Parámetros 'inicio' y 'fin' requeridos." });
    }

    // Rango de fechas para filtrar por detalle.fechaHora
    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);
    fechaFin.setHours(23, 59, 59, 999);

    // Trabajador
    const trabajador = await Trabajador.findById(id).lean();
    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }

    // Sede base y foráneas (compat con campo antiguo)
    const sedeBase = trabajador.sedePrincipal ?? trabajador.sede;
    const sedesForaneas = Array.isArray(trabajador.sedesForaneas) ? trabajador.sedesForaneas : [];
    const sedesPermitidas = [...new Set([sedeBase, ...sedesForaneas])].filter((s) => s != null);

    // En Asistencia.trabajador guardas id_checador (string). Fallback al _id por históricos.
    const idChecador = (trabajador.id_checador ?? '').toString();
    const posiblesIds = [trabajador?._id?.toString()].filter(Boolean);
    if (idChecador) posiblesIds.push(idChecador);

    // 🔧 Parse robusto de flags truthy (true/1/on/yes/si/sí)
    const isTruthy = (v) => ['true', '1', 'on', 'yes', 'si', 'sí'].includes(String(v ?? '').toLowerCase());
    const ignoreAllSede = isTruthy(ignorarSede);
    const onlyMainSede  = isTruthy(soloSedePrincipal);

    // 🔧 Filtro de sede
    let filtroSede = {};
    if (ignoreAllSede) {
      filtroSede = {}; // NO filtramos por sede (mezcla todas)
    } else if (onlyMainSede) {
      filtroSede = (sedeBase != null) ? { sede: sedeBase } : {};
    } else if ((sedesPermitidas || []).length) {
      filtroSede = { sede: { $in: sedesPermitidas } };
    } else {
      filtroSede = {}; // sin filtro si no hay foráneas registradas
    }

    // 🧵 Cargas en paralelo
    const [asistencias, calendarioTrabajador, calendarioSede] = await Promise.all([
      Asistencia.find({
        trabajador: { $in: posiblesIds },
        ...filtroSede,
        $or: [
          { fecha: { $gte: inicio, $lte: fin } },                         // por string YYYY-MM-DD
          { 'detalle.fechaHora': { $gte: fechaInicio, $lte: fechaFin } }  // por Date en marcas
        ]
      }).lean(),
      CalendarioTrabajador.findOne({
        trabajador: trabajador._id,
        $or: [{ anio: fechaInicio.getFullYear() }, { ['año']: fechaInicio.getFullYear() }]
      }).lean(),
      // calendario SOLO de la sede principal (para eventos de sede)
      Calendario.findOne({
        sedes: sedeBase,
        $or: [{ anio: fechaInicio.getFullYear() }, { ['año']: fechaInicio.getFullYear() }]
      }).lean()
    ]);

    // 📦 Normaliza detalle y asegura que cada marca traiga "sede"
    const asistenciasFormateadas = (asistencias || []).map((a) => ({
      ...a,
      detalle: (a.detalle || []).map((d) => ({
        tipo: d.tipo,
        fechaHora: new Date(d.fechaHora).toISOString(),  // ISO consistente
        salida_automatica: !!d.salida_automatica,
        sincronizado: !!d.sincronizado,
        sede: (d.sede != null) ? d.sede : (a.sede ?? null)
      }))
    }));

    return res.json({
      asistencias: asistenciasFormateadas,
      eventosTrabajador: calendarioTrabajador?.diasEspeciales || [],
      eventosSede: calendarioSede?.diasEspeciales || []
    });
  } catch (error) {
    console.error('❌ Error en /unificado:', error);
    return res.status(500).json({ message: 'Error interno al obtener datos unificados.' });
  }
});

// 🆕 Unificado por SEDE (con horas de "Otra Sede" y sin arrastrar día por solo-salida)
router.get('/unificado-sede/:sedeId', async (req, res) => {
  try {
    const { sedeId } = req.params;
    const { inicio, fin } = req.query;
    const { DateTime } = require('luxon');

    if (!inicio || !fin) {
      return res.status(400).json({ message: "Parámetros 'inicio' y 'fin' requeridos." });
    }

    const fechaInicio = DateTime.fromISO(inicio).startOf('day');
    const fechaFin    = DateTime.fromISO(fin).endOf('day');

    const Trabajador = require('../models/Trabajador');
    const Asistencia = require('../models/Asistencia');
    const Calendario = require('../models/Calendario');
    const CalendarioTrabajador = require('../models/CalendarioTrabajador');

    const ZONE = 'America/Mexico_City';
    const isoDay = (d) => {
      if (!d) return '';
      const dt = typeof d === 'string' ? DateTime.fromISO(d) : DateTime.fromJSDate(new Date(d));
      return dt.setZone(ZONE).toISODate();
    };
    const fmtHoraMX = (iso) =>
      DateTime.fromJSDate(new Date(iso)).setZone(ZONE).toFormat('hh:mm a');

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
      const idChecador = (trabajador.id_checador ?? '').toString();
      const posiblesIds = [trabajador?._id?.toString()].filter(Boolean);
      if (idChecador) posiblesIds.push(idChecador);

      // A) Solo sede actual (para celdas normales)
      const asistenciasSede = await Asistencia.find({
        trabajador: { $in: posiblesIds },
        sede: Number(sedeId),
        $or: [
          { fecha: { $gte: inicio, $lte: fin } },
          { 'detalle.fechaHora': { $gte: fechaInicio.toJSDate(), $lte: fechaFin.toJSDate() } }
        ]
      }).lean();

      // B) Todas las sedes (para detectar "Otra Sede" y extraer horas de ese día)
      const asistenciasAll = await Asistencia.find({
        trabajador: { $in: posiblesIds },
        $or: [
          { fecha: { $gte: inicio, $lte: fin } },
          { 'detalle.fechaHora': { $gte: fechaInicio.toJSDate(), $lte: fechaFin.toJSDate() } }
        ]
      }).lean();

      // Índice: fecha -> { entradaISO?, salidaISO? } SOLO de sedes != sedeId
      const horasOtraSede = new Map(); // Map<string, {entradaISO?:string, salidaISO?:string}>
      (asistenciasAll || []).forEach((a) => {
        const sedeDoc = a?.sede;
        (a?.detalle || []).forEach((d) => {
          const f = isoDay(d?.fechaHora);
          const sedeReg = (d?.sede != null) ? d.sede : sedeDoc;
          if (!f || String(sedeReg) === String(sedeId)) return; // solo otras sedes

          const cur = horasOtraSede.get(f) || {};
          if (d?.tipo === 'Entrada') {
            if (!cur.entradaISO || new Date(d.fechaHora) < new Date(cur.entradaISO)) cur.entradaISO = d.fechaHora;
          }
          if (String(d?.tipo || '').startsWith('Salida')) {
            if (!cur.salidaISO || new Date(d.fechaHora) > new Date(cur.salidaISO)) cur.salidaISO = d.fechaHora;
          }
          horasOtraSede.set(f, cur);
        });
      });

      const calendarioTrabajador = await CalendarioTrabajador.findOne({
        trabajador: trabajador._id,
        $or: [{ anio: fechaInicio.year }, { ['año']: fechaInicio.year }]
      }).lean();

      const datosPorDia = {};
      let cursor = fechaInicio;

      while (cursor <= fechaFin) {
        const fechaStr = cursor.toISODate();

        const entradas = asistenciasSede
          .flatMap((a) => a.detalle || [])
          .filter((d) => d.tipo === 'Entrada' && isoDay(d.fechaHora) === fechaStr);
        const salidas = asistenciasSede
          .flatMap((a) => a.detalle || [])
          .filter((d) => d.tipo === 'Salida' && isoDay(d.fechaHora) === fechaStr);

        const eventoTrab = calendarioTrabajador?.diasEspeciales?.find((e) => isoDay(e.fecha) === fechaStr);
        const eventoSed  = calendarioSede?.diasEspeciales?.find((e) => isoDay(e.fecha) === fechaStr);

        let entrada = entradas.length ? fmtHoraMX(entradas[0].fechaHora) : '';
        let salida  = salidas.length ? fmtHoraMX(salidas[salidas.length - 1].fechaHora) : '';
        let estado  = '';

        // Jerarquía base
        if (eventoTrab) {
          const tipoEvt = (eventoTrab.tipo || '').toLowerCase().trim();
          if (tipoEvt === 'asistencia' && eventoTrab.horaEntrada && eventoTrab.horaSalida) {
            estado = 'Asistencia Manual';
            entrada = eventoTrab.horaEntrada;
            salida  = eventoTrab.horaSalida;
          } else {
            estado = eventoTrab.tipo;
            entrada = estado;
            salida  = '';
          }
        } else if (entrada && salida) {
          estado = 'Asistencia Completa';
        } else if (entrada && !salida) {
          estado = 'Salida Automática';
          salida = '⏳';
        } else if (eventoSed) {
          estado = eventoSed.tipo;
          entrada = estado;
          salida  = '';
        } else {
          estado = 'Falta';
          entrada = '—';
          salida  = '—';
        }

        // 🔵 "Otra Sede": solo si NO hubo nada en sede actual y SÍ hay ENTRADA en otra sede ese día
        if (!entradas.length && !salidas.length && !eventoTrab && !eventoSed) {
          const otras = horasOtraSede.get(fechaStr);
          if (otras?.entradaISO) {
            estado  = 'Otra Sede';
            entrada = fmtHoraMX(otras.entradaISO);
            salida  = otras.salidaISO ? fmtHoraMX(otras.salidaISO) : '—';
          }
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
