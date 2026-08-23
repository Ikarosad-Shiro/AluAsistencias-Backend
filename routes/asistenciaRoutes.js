// routes/asistencias.js
const express = require('express');
const { DateTime } = require('luxon');

const Asistencia = require('../models/Asistencia');
const Trabajador = require('../models/Trabajador');
const Sede = require('../models/Sede');
const Calendario = require('../models/Calendario');
const CalendarioTrabajador = require('../models/CalendarioTrabajador');

const { obtenerReportePorTrabajador } = require('../controllers/asistenciaController');

const {
  ZONE,
  dayMX,
  parseDateTimeMX,
  extraerMarcasDelDia,
  interpretarDia
} = require('../services/asistenciaRulesService');

const router = express.Router();

// 🧩 Helpers
const isoDay = dayMX;

const isTruthy = (v) =>
  ['true', '1', 'on', 'yes', 'si', 'sí'].includes(String(v ?? '').toLowerCase());

const fmtHoraMX = (iso) => {
  const dt = parseDateTimeMX(iso);
  return dt?.isValid ? dt.toFormat('hh:mm a') : '';
};

// Detecta si una asistencia pertenece a una fecha específica,
// compatible con formato viejo y nuevo.
function asistenciaPerteneceAlDia(a, fechaStr) {
  if (!a) return false;
  if (a.fecha === fechaStr) return true;

  if ((a.detalle || []).some((d) => isoDay(d.fechaHora) === fechaStr)) return true;
  if ((a.registros || []).some((r) => isoDay(r.fechaHora) === fechaStr)) return true;
  if (a.primerRegistro?.fechaHora && isoDay(a.primerRegistro.fechaHora) === fechaStr) return true;
  if (a.ultimoRegistro?.fechaHora && isoDay(a.ultimoRegistro.fechaHora) === fechaStr) return true;

  return false;
}

// Filtro de rango compatible con formato viejo y nuevo.
function filtroRangoAsistencias(inicio, fin, fechaInicio, fechaFin) {
  return {
    $or: [
      { fecha: { $gte: inicio, $lte: fin } },

      // Formato viejo
      { 'detalle.fechaHora': { $gte: fechaInicio, $lte: fechaFin } },

      // Formato nuevo
      { 'registros.fechaHora': { $gte: fechaInicio, $lte: fechaFin } },
      { 'primerRegistro.fechaHora': { $gte: fechaInicio, $lte: fechaFin } },
      { 'ultimoRegistro.fechaHora': { $gte: fechaInicio, $lte: fechaFin } }
    ]
  };
}

// Convierte formato nuevo a detalle[] para no romper el front/PDF/Excel.
function normalizarDetalleCompatible(a) {
  const detalle = [];

  // Formato viejo
  if (Array.isArray(a.detalle) && a.detalle.length > 0) {
    for (const d of a.detalle) {
      detalle.push({
        tipo: d.tipo,
        fechaHora: d.fechaHora,
        salida_automatica: !!d.salida_automatica,
        sincronizado: !!d.sincronizado,
        sede: d.sede != null ? d.sede : (a.sede ?? null)
      });
    }
  }

  // Formato nuevo: registros[]
  if (Array.isArray(a.registros) && a.registros.length > 0) {
    const registros = [...a.registros]
      .filter((r) => r?.fechaHora)
      .sort((x, y) => new Date(x.fechaHora) - new Date(y.fechaHora));

    if (registros.length > 0) {
      const primero = registros[0];

      detalle.push({
        tipo: 'Entrada',
        fechaHora: primero.fechaHora,
        salida_automatica: false,
        sincronizado: !!primero.sincronizado,
        sede: primero.sede != null ? primero.sede : (a.sede ?? null)
      });

      if (registros.length > 1) {
        const ultimo = registros[registros.length - 1];

        detalle.push({
          tipo: 'Salida',
          fechaHora: ultimo.fechaHora,
          salida_automatica: false,
          sincronizado: !!ultimo.sincronizado,
          sede: ultimo.sede != null ? ultimo.sede : (a.sede ?? null)
        });
      }
    }
  }

  // Formato nuevo: primerRegistro / ultimoRegistro
  if (detalle.length === 0 && a.primerRegistro?.fechaHora) {
    detalle.push({
      tipo: 'Entrada',
      fechaHora: a.primerRegistro.fechaHora,
      salida_automatica: false,
      sincronizado: false,
      sede: a.primerRegistro.sede != null ? a.primerRegistro.sede : (a.sede ?? null)
    });

    if (Number(a.totalRegistros || 0) > 1 && a.ultimoRegistro?.fechaHora) {
      detalle.push({
        tipo: 'Salida',
        fechaHora: a.ultimoRegistro.fechaHora,
        salida_automatica: false,
        sincronizado: false,
        sede: a.ultimoRegistro.sede != null ? a.ultimoRegistro.sede : (a.sede ?? null)
      });
    }
  }

  return detalle;
}

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
    case 'media jornada': return '🌓 Media Jornada';
    case 'Evento': return '🎤 Evento';
    case 'evento': return '🎤 Evento';
    case 'Capacitación': return '📚 Capacitación';
    case 'capacitación': return '📚 Capacitación';
    case 'Festivo': return '🎉 Festivo';
    case 'festivo': return '🎉 Festivo';
    case 'Descanso': return '😴 Descanso';
    case 'descanso': return '😴 Descanso';
    case 'Puente': return '🌉 Puente';
    case 'puente': return '🌉 Puente';
    case 'Suspensión': return '🚫 Suspensión';
    case 'suspensión': return '🚫 Suspensión';
    default: return tipo;
  }
}

// 📌 Registrar asistencia (desde servidor local / legado)
router.post('/registrar', async (req, res) => {
  try {
    const { trabajadorId, sede, tipo } = req.body;

    if (!['Entrada', 'Salida'].includes(tipo)) {
      return res.status(400).json({ message: 'Tipo de asistencia inválido.' });
    }

    const now = DateTime.now().setZone(ZONE);
    const ahoraISO = now.toISO();
    const fechaStr = now.toISODate();

    const existe = await Asistencia.findOne({
      trabajador: trabajadorId,
      fecha: fechaStr,
      'detalle.tipo': tipo
    });

    if (existe) {
      return res.status(409).json({ message: `Ya existe una ${tipo} registrada para hoy.` });
    }

    const nuevaAsistencia = new Asistencia({
      trabajador: trabajadorId,
      sede,
      fecha: fechaStr,
      detalle: [
        {
          trabajador: trabajadorId,
          tipo,
          fechaHora: ahoraISO,
          sede
        }
      ]
    });

    await nuevaAsistencia.save();
    res.json({ message: '✅ Asistencia registrada correctamente.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: '❌ Error al registrar asistencia.', error });
  }
});

// 📌 Reporte por trabajador
router.get('/reporte/trabajador/:trabajadorId', obtenerReportePorTrabajador);

// 📌 Ruta unificada para PDF/Excel del TRABAJADOR
router.get('/unificado/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { inicio, fin, soloSedePrincipal, ignorarSede } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ message: "Parámetros 'inicio' y 'fin' requeridos." });
    }

    const fechaInicio = DateTime.fromISO(inicio, { zone: ZONE }).startOf('day').toJSDate();
    const fechaFin = DateTime.fromISO(fin, { zone: ZONE }).endOf('day').toJSDate();

    const trabajador = await Trabajador.findById(id).lean();

    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }

    const sedeBase = trabajador.sedePrincipal ?? trabajador.sede;
    const sedesForaneas = Array.isArray(trabajador.sedesForaneas) ? trabajador.sedesForaneas : [];
    const sedesPermitidas = [...new Set([sedeBase, ...sedesForaneas])]
      .filter((s) => s != null)
      .map(Number);

    const idChecador = (trabajador.id_checador ?? '').toString();
    const posiblesIds = [trabajador?._id?.toString()].filter(Boolean);

    if (idChecador) posiblesIds.push(idChecador);

    const ignoreAllSede = isTruthy(ignorarSede);
    const onlyMainSede = isTruthy(soloSedePrincipal);

    let filtroSede = {};

    if (ignoreAllSede) {
      filtroSede = {};
    } else if (onlyMainSede) {
      filtroSede = sedeBase != null ? { sede: Number(sedeBase) } : {};
    } else if (sedesPermitidas.length) {
      filtroSede = { sede: { $in: sedesPermitidas } };
    } else {
      filtroSede = {};
    }

    const [asistencias, calendarioTrabajador, calendarioSede] = await Promise.all([
      Asistencia.find({
        trabajador: { $in: posiblesIds },
        ...filtroSede,
        ...filtroRangoAsistencias(inicio, fin, fechaInicio, fechaFin)
      }).lean(),

      CalendarioTrabajador.findOne({
        trabajador: trabajador._id,
        $or: [
          { anio: DateTime.fromISO(inicio, { zone: ZONE }).year },
          { ['año']: DateTime.fromISO(inicio, { zone: ZONE }).year }
        ]
      }).lean(),

      Calendario.findOne({
        sedes: sedeBase,
        $or: [
          { anio: DateTime.fromISO(inicio, { zone: ZONE }).year },
          { ['año']: DateTime.fromISO(inicio, { zone: ZONE }).year }
        ]
      }).lean()
    ]);

    const asistenciasFormateadas = (asistencias || []).map((a) => ({
      ...a,
      detalle: normalizarDetalleCompatible(a),
      primerRegistro: a.primerRegistro || null,
      ultimoRegistro: a.ultimoRegistro || null,
      totalRegistros: a.totalRegistros || 0,
      registros: a.registros || []
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

// 🆕 Unificado por SEDE
// 🆕 Unificado por SEDE
router.get('/unificado-sede/:sedeId', async (req, res) => {
  try {
    const { sedeId } = req.params;
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({
        message: "Parámetros 'inicio' y 'fin' requeridos."
      });
    }

    const sedeNum = Number(sedeId);

    const fechaInicio = DateTime
      .fromISO(inicio, { zone: ZONE })
      .startOf('day');

    const fechaFin = DateTime
      .fromISO(fin, { zone: ZONE })
      .endOf('day');

    const fechaInicioJS = fechaInicio.toJSDate();
    const fechaFinJS = fechaFin.toJSDate();


    // =====================================================
    // SEDE DEL REPORTE
    // =====================================================

    const sedeDoc = await Sede.findOne({
      id: sedeNum
    }).lean();


    // =====================================================
    // TRABAJADORES DE LA SEDE
    // =====================================================

    const trabajadores = await Trabajador.find({
      $or: [
        { sede: sedeNum },
        { sedePrincipal: sedeNum }
      ]
    }).lean();


    if (!trabajadores.length) {
      return res.status(404).json({
        message: 'No hay trabajadores en esta sede.'
      });
    }


    // =====================================================
    // CALENDARIO DE LA SEDE
    // =====================================================

    const calendarioSede = await Calendario.findOne({
      sedes: sedeNum,
      $or: [
        { anio: fechaInicio.year },
        { ['año']: fechaInicio.year }
      ]
    }).lean();


    const resultados = [];


    // =====================================================
    // RECORRER TRABAJADORES
    // =====================================================

    for (const trabajador of trabajadores) {

      const idChecador =
        (trabajador.id_checador ?? '').toString();

      const posiblesIds = [
        trabajador?._id?.toString()
      ].filter(Boolean);


      if (idChecador) {
        posiblesIds.push(idChecador);
      }


      // ===================================================
      // A) REGISTROS ÚNICAMENTE DE LA SEDE DEL REPORTE
      //
      // Estos NO serán usados para calcular Entrada/Salida.
      //
      // Sirven para saber si el trabajador tuvo
      // físicamente alguna marca en esta sede.
      // ===================================================

      const asistenciasSede = await Asistencia.find({
        trabajador: {
          $in: posiblesIds
        },

        sede: sedeNum,

        ...filtroRangoAsistencias(
          inicio,
          fin,
          fechaInicioJS,
          fechaFinJS
        )
      }).lean();


      // ===================================================
      // B) REGISTROS DE TODAS LAS SEDES
      //
      // Esta colección SÍ se utilizará para determinar:
      //
      // - Primera marca global
      // - Última marca global
      // - Entrada
      // - Salida
      // - Estado
      //
      // Esto permite:
      //
      // 08:03 Los Reyes
      // 18:15 Texcoco
      //
      // = Asistencia Completa
      // ===================================================

      const asistenciasAll = await Asistencia.find({
        trabajador: {
          $in: posiblesIds
        },

        ...filtroRangoAsistencias(
          inicio,
          fin,
          fechaInicioJS,
          fechaFinJS
        )
      }).lean();


      // ===================================================
      // CALENDARIO DEL TRABAJADOR
      // ===================================================

      const calendarioTrabajador =
        await CalendarioTrabajador.findOne({

          trabajador:
            trabajador._id,

          $or: [
            { anio: fechaInicio.year },
            { ['año']: fechaInicio.year }
          ]

        }).lean();


      const datosPorDia = {};

      let cursor =
        fechaInicio.startOf('day');

      const finCursor =
        fechaFin.startOf('day');


      // ===================================================
      // RECORRER CADA DÍA
      // ===================================================

      while (cursor <= finCursor) {

        const fechaStr =
          cursor.toISODate();


        // ===============================================
        // REGISTROS DE LA SEDE ACTUAL
        // ===============================================

        const asistenciasSedeDia =
          (asistenciasSede || []).filter(
            (a) =>
              asistenciaPerteneceAlDia(
                a,
                fechaStr
              )
          );


        // ===============================================
        // TODOS LOS REGISTROS DEL TRABAJADOR
        // EN TODAS LAS SEDES
        // ===============================================

        const asistenciasAllDia =
          (asistenciasAll || []).filter(
            (a) =>
              asistenciaPerteneceAlDia(
                a,
                fechaStr
              )
          );


        // ===============================================
        // EVENTO DEL TRABAJADOR
        // ===============================================

        const eventoTrab =
          calendarioTrabajador
            ?.diasEspeciales
            ?.find(
              (e) =>
                isoDay(e.fecha) === fechaStr
            );


        // ===============================================
        // EVENTO DE LA SEDE
        // ===============================================

        const eventoSed =
          calendarioSede
            ?.diasEspeciales
            ?.find(
              (e) =>
                isoDay(e.fecha) === fechaStr
            );


        // ===============================================
        // MARCAS DE LA SEDE DEL REPORTE
        //
        // Solo sirven para determinar si estuvo
        // físicamente en esta sede.
        // ===============================================

        const marcasSede =
          extraerMarcasDelDia(
            asistenciasSedeDia,
            fechaStr
          );


        // ===============================================
        // MARCAS GLOBALES
        //
        // Aquí juntamos:
        //
        // Los Reyes
        // Texcoco
        // Chalco
        // etc.
        // ===============================================

        const marcasGlobales =
          extraerMarcasDelDia(
            asistenciasAllDia,
            fechaStr
          );


        // ===============================================
        // INTERPRETAR EL DÍA
        //
        // IMPORTANTE:
        //
        // Ahora usamos marcasGlobales.
        // ===============================================

        const interpretacion =
          interpretarDia({

            fechaStr,

            sedeDoc,

            marcas:
              marcasGlobales,

            eventoTrabajador:
              eventoTrab,

            eventoSede:
              eventoSed
          });


        let entrada =
          interpretacion.entrada || '';

        let salida =
          interpretacion.salida || '';

        let estado =
          interpretacion.estado || '';


        // ===============================================
        // EVENTOS
        //
        // Conservamos el comportamiento anterior.
        // ===============================================

        if (
          (
            interpretacion.fuenteEstado ===
              'eventoTrabajador' ||

            interpretacion.fuenteEstado ===
              'eventoSede'
          ) &&

          !entrada &&
          !salida
        ) {

          entrada = estado;

          salida = '';
        }


        // ===============================================
        // SALIDA AUTOMÁTICA
        // ===============================================

        if (
          estado === 'Salida Automática' &&
          entrada &&
          !salida
        ) {

          salida = '⏳';
        }


        // ===============================================
        // FALTA
        // ===============================================

        if (estado === 'Falta') {

          entrada = '—';

          salida = '—';
        }


        // ===============================================
        // DESCANSO
        // ===============================================

        if (estado === 'Descanso') {

          entrada = 'Descanso';

          salida = '';
        }


        // ===============================================
        // DETECTAR PRESENCIA EN SEDE ACTUAL
        // ===============================================

        const hayMarcaEnSede =
          !!(
            marcasSede.entradaReg ||
            marcasSede.salidaReg
          );


        const hayMarcaGlobal =
          !!(
            marcasGlobales.entradaReg ||
            marcasGlobales.salidaReg
          );


        // ===============================================
        // OTRA SEDE
        //
        // Solo usamos "Otra Sede" cuando:
        //
        // 1. NO marcó en la sede del reporte.
        // 2. SÍ marcó en alguna otra sede.
        // 3. No tiene un evento especial.
        //
        // IMPORTANTE:
        //
        // Si:
        //
        // Los Reyes 08:03
        // Texcoco   18:15
        //
        // hayMarcaEnSede = true
        //
        // por lo tanto NO será "Otra Sede".
        //
        // Será Asistencia Completa.
        // ===============================================

        if (
          !hayMarcaEnSede &&
          hayMarcaGlobal &&
          !eventoTrab &&
          !eventoSed
        ) {

          estado =
            'Otra Sede';


          entrada =
            marcasGlobales
              .entradaReg
              ?.fechaHora
                ? fmtHoraMX(
                    marcasGlobales
                      .entradaReg
                      .fechaHora
                  )
                : '—';


          salida =
            marcasGlobales
              .salidaReg
              ?.fechaHora
                ? fmtHoraMX(
                    marcasGlobales
                      .salidaReg
                      .fechaHora
                  )
                : '—';
        }


        // ===============================================
        // RESULTADO DEL DÍA
        // ===============================================

        datosPorDia[fechaStr] = {

          entrada,

          salida,

          estado,

          // Dejamos estos datos disponibles
          // por si después queremos mostrarlos
          // en PDF/Excel o tooltips.

          sedeEntrada:
            interpretacion.sedeEntrada ??
            marcasGlobales.sedeEntrada ??
            null,

          sedeSalida:
            interpretacion.sedeSalida ??
            marcasGlobales.sedeSalida ??
            null
        };


        cursor =
          cursor.plus({
            days: 1
          });
      }


      // ===================================================
      // RESULTADO DEL TRABAJADOR
      // ===================================================

      resultados.push({

        nombre: [
          trabajador.nombre,
          trabajador.apellido,
          trabajador.segundoApellido
        ]
          .filter(Boolean)
          .join(' '),

        id:
          trabajador._id,

        datosPorDia
      });
    }


    // =====================================================
    // RESPUESTA
    // =====================================================

    res.json({

      sede:
        sedeNum,

      rango: {
        inicio,
        fin
      },

      trabajadores:
        resultados
    });


  } catch (error) {

    console.error(
      '❌ Error en /unificado-sede:',
      error
    );


    res.status(500).json({
      message:
        'Error al obtener datos por sede.',

      error
    });
  }
});
// 📌 Asistencias de HOY
router.get('/hoy', async (req, res) => {
  try {
    const hoy = DateTime.now().setZone(ZONE).toISODate();

    // Ya no filtramos por estado, porque el formato nuevo puede no traer estado calculado.
    const asistencias = await Asistencia.find({
      fecha: hoy
    }).lean();

    const asistenciasFiltradas = (asistencias || []).filter((a) => {
      const marcas = extraerMarcasDelDia([a], hoy);
      return !!marcas.entradaReg;
    });

    const resultado = await Promise.all(
      asistenciasFiltradas.map(async (a) => {
        const marcas = extraerMarcasDelDia([a], hoy);

        const trabajadorDoc = await Trabajador.findOne({
          id_checador: Number(a.trabajador),
          $or: [
            { sede: a.sede },
            { sedePrincipal: a.sede }
          ]
        }).lean();

        const sedeDoc = await Sede.findOne({ id: a.sede }).lean();

        const nombreCompleto = [
          trabajadorDoc?.nombre,
          trabajadorDoc?.apellido,
          trabajadorDoc?.segundoApellido
        ].filter(Boolean).join(' ');

        return {
          _id: trabajadorDoc?._id,
          nombre: nombreCompleto || 'Desconocido',
          hora: marcas.entradaReg?.fechaHora ? fmtHoraMX(marcas.entradaReg.fechaHora) : null,
          sede: sedeDoc?.nombre || 'Sin sede'
        };
      })
    );

    resultado.sort((a, b) => {
      if (!a.hora) return 1;
      if (!b.hora) return -1;

      const horaA = DateTime.fromFormat(a.hora, 'hh:mm a');
      const horaB = DateTime.fromFormat(b.hora, 'hh:mm a');

      if (!horaA.isValid || !horaB.isValid) return 0;

      return horaA.toMillis() - horaB.toMillis();
    });

    res.json(resultado);
  } catch (error) {
    console.error('❌ Error al obtener asistencias de hoy:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

module.exports = router;