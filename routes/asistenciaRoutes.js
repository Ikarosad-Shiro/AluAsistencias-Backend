const express = require("express");
const Asistencia = require("../models/Asistencia");

const Trabajador = require("../models/Trabajador");
const Sede = require("../models/Sede");
const Calendario = require("../models/Calendario");
const CalendarioTrabajador = require("../models/CalendarioTrabajador"); // Añade esta línea

const router = express.Router();
const { DateTime } = require('luxon'); // Asegúrate de tener luxon instalado: npm install luxon

// 📌 Registrar asistencia desde el servidor local
router.post("/registrar", async (req, res) => {
  try {
    const { trabajadorId, sede, tipo } = req.body;

    if (!["Entrada", "Salida"].includes(tipo)) {
      return res.status(400).json({ message: "Tipo de asistencia inválido." });
    }

    // ✅ Hora real de México como string ISO con zona
    const ahoraLuxon = DateTime.now().setZone('America/Mexico_City');
    const ahoraISO = ahoraLuxon.toISO(); // ⏰ "2025-05-13T10:00:00-06:00"
    const fechaStr = ahoraLuxon.toISODate(); // 📅 "2025-05-13"

    // ✅ Verificar si ya existe una entrada/salida para hoy
    const existe = await Asistencia.findOne({
      trabajador: trabajadorId,
      fecha: fechaStr,
      'detalle.tipo': tipo
    });

    if (existe) {
      return res.status(409).json({ message: `Ya existe una ${tipo} registrada para hoy.` });
    }

    // ✅ Crear nuevo registro
    const nuevaAsistencia = new Asistencia({
      trabajador: trabajadorId,
      sede,
      fecha: fechaStr,
      detalle: [
        {
          tipo,
          fechaHora: ahoraISO // ⏰ Guardamos ISO string con zona incluida
        }
      ]
    });

    await nuevaAsistencia.save();
    res.json({ message: "✅ Asistencia registrada en MongoDB correctamente." });

  } catch (error) {
    res.status(500).json({ message: "❌ Error al registrar asistencia.", error });
  }
});

// En el backend (routes/asistencias.js)
router.get("/reporte/trabajador/:id", async (req, res) => {
  try {
    const trabajadorId = req.params.id;
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ 
        message: "Debes proporcionar los parámetros 'inicio' y 'fin' en formato YYYY-MM-DD" 
      });
    }

    // ✅ Normalizar fechas para consulta (considerar zona horaria)
    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);
    
    // Ajustar a inicio y fin del día
    fechaInicio.setUTCHours(0, 0, 0, 0);
    fechaFin.setUTCHours(23, 59, 59, 999);

    // Verificar existencia del trabajador
    const trabajador = await Trabajador.findById(trabajadorId);
    if (!trabajador) {
      return res.status(404).json({ message: "Trabajador no encontrado." });
    }

    // 1. Obtener asistencias REALES en el rango de fechas
    const asistenciasReales = await Asistencia.find({
      trabajador: trabajadorId,
      $or: [
        // Caso 1: Fecha exacta (formato YYYY-MM-DD)
        { fecha: { $gte: inicio, $lte: fin } },
        
        // Caso 2: Fecha en detalle (formato ISODate)
        { 
          "detalle.fechaHora": { 
            $gte: fechaInicio,
            $lte: fechaFin
          }
        }
      ]
    }).lean();

    console.log("🔍 Asistencias encontradas en MongoDB:", asistenciasReales);

    // 2. Obtener calendarios (sede y trabajador)
    const [calendarioSede, calendarioTrabajador] = await Promise.all([
      Calendario.findOne({ sedes: trabajador.sede, año: fechaInicio.getFullYear() }),
      CalendarioTrabajador.findOne({ trabajador: trabajadorId, anio: fechaInicio.getFullYear() })
    ]);

    // 3. Procesar cada día del rango
    const resultado = [];
    const fechaActual = new Date(fechaInicio);
    
    while (fechaActual <= fechaFin) {
      const fechaStr = fechaActual.toISOString().split('T')[0];
      
      // Buscar asistencia REAL para este día
      const asistenciaDia = asistenciasReales.find(a => 
        a.fecha === fechaStr || 
        a.detalle?.some(d => 
          new Date(d.fechaHora).toISOString().split('T')[0] === fechaStr
        )
      );
      
      // Buscar eventos
      const eventoSede = calendarioSede?.diasEspeciales?.find(e => 
        new Date(e.fecha).toISOString().split('T')[0] === fechaStr
      );
      
      const eventoTrabajador = calendarioTrabajador?.diasEspeciales?.find(e => 
        new Date(e.fecha).toISOString().split('T')[0] === fechaStr
      );

      // Estructura de respuesta
      const registro = {
        fecha: fechaStr,
        estado: asistenciaDia?.estado || null,
        detalle: asistenciaDia?.detalle?.map(d => ({
          tipo: d.tipo,
          fechaHora: d.fechaHora,
          ...(d.salida_automatica && { salida_automatica: true })
        })) || []
      };

      resultado.push(registro);
      fechaActual.setDate(fechaActual.getDate() + 1);
    }

    res.json(resultado);

  } catch (error) {
    console.error("❌ Error en el reporte:", error);
    res.status(500).json({ 
      message: "Error al generar reporte.",
      error: error.message 
    });
  }
});

// 📌 Ruta unificada para PDF y calendario del trabajador
router.get('/unificado/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ message: "Parámetros 'inicio' y 'fin' requeridos." });
    }

    const fechaInicio = new Date(inicio);
    const fechaFin = new Date(fin);
    fechaFin.setHours(23, 59, 59, 999);

    const trabajador = await Trabajador.findById(id);
    if (!trabajador) {
      return res.status(404).json({ message: 'Trabajador no encontrado.' });
    }

    const [asistencias, calendarioTrabajador, calendarioSede] = await Promise.all([
      Asistencia.find({
        trabajador: trabajador.id_checador.toString(),
        sede: trabajador.sede,
        $or: [
          { fecha: { $gte: inicio, $lte: fin } },
          { "detalle.fechaHora": { $gte: fechaInicio, $lte: fechaFin } }
        ]
      }),
      CalendarioTrabajador.findOne({ trabajador: trabajador._id, anio: fechaInicio.getFullYear() }),
      Calendario.findOne({ sedes: trabajador.sede, año: fechaInicio.getFullYear() })
    ]);

    // 🧼 Formatear y aplanar correctamente cada fechaHora y detalle con +6h
    const asistenciasFormateadas = asistencias.map(asistencia => {
      const obj = asistencia.toObject();
    
      const detallePlano = (obj.detalle || []).map(d => {
        const fechaOriginal = DateTime.fromISO(d.fechaHora, { zone: 'utc' }).setZone('America/Mexico_City');
      
        return {
          tipo: d.tipo,
          fechaHora: fechaOriginal.toFormat("yyyy-MM-dd'T'HH:mm:ss"),
          salida_automatica: d.salida_automatica || false,
          sincronizado: d.sincronizado || false
        };
      });           
    
      return {
        ...obj,
        detalle: detallePlano
      };
    });
    

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

// 🆕 Ruta: Obtener asistencias unificadas por sede CON jerarquía
router.get('/unificado-sede/:sedeId', async (req, res) => {
  try {
    const { sedeId } = req.params;
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ message: "Parámetros 'inicio' y 'fin' requeridos." });
    }

    const fechaInicio = DateTime.fromISO(inicio).startOf('day');
    const fechaFin = DateTime.fromISO(fin).endOf('day');

    const trabajadores = await Trabajador.find({ sede: sedeId });
    if (!trabajadores.length) {
      return res.status(404).json({ message: "No hay trabajadores en esta sede." });
    }

    const calendarioSede = await Calendario.findOne({ sedes: sedeId, año: fechaInicio.year });

    const resultados = [];

    for (const trabajador of trabajadores) {
      const asistencias = await Asistencia.find({
        trabajador: trabajador.id_checador.toString(),
        sede: sedeId,
        $or: [
          { fecha: { $gte: inicio, $lte: fin } },
          { "detalle.fechaHora": { $gte: fechaInicio.toJSDate(), $lte: fechaFin.toJSDate() } }
        ]
      }).lean();

      const calendarioTrabajador = await CalendarioTrabajador.findOne({
        trabajador: trabajador._id,
        anio: fechaInicio.year
      });

      const datosPorDia = {};
      let fechaCursor = fechaInicio;

      while (fechaCursor <= fechaFin) {
        const fechaStr = fechaCursor.toISODate();
        const diaSemana = fechaCursor.setLocale('es').toFormat('cccc');

        const entradas = asistencias.flatMap(a => a.detalle || []).filter(d =>
          d.tipo === 'Entrada' && DateTime.fromJSDate(new Date(d.fechaHora)).toISODate() === fechaStr
        );

        const salidas = asistencias.flatMap(a => a.detalle || []).filter(d =>
          d.tipo === 'Salida' && DateTime.fromJSDate(new Date(d.fechaHora)).toISODate() === fechaStr
        );

        const eventoTrab = calendarioTrabajador?.diasEspeciales?.find(e =>
          DateTime.fromJSDate(new Date(e.fecha)).toISODate() === fechaStr
        );

        const eventoSede = calendarioSede?.diasEspeciales?.find(e =>
          DateTime.fromJSDate(new Date(e.fecha)).toISODate() === fechaStr
        );

        let entrada = entradas.length > 0 ? DateTime.fromISO(entradas[0].fechaHora, { zone: 'utc' }).setZone('America/Mexico_City').toFormat('hh:mm a') : '';
        let salida = salidas.length > 0 ? DateTime.fromJSDate(salidas[0].fechaHora).plus({ hours: 6 }).toFormat('hh:mm a') : '';

        // 🧠 Aplicar jerarquía: eventoTrab > asistencia > eventoSede > falta
        let estado = '';

        if (eventoTrab) {
          if (
            eventoTrab.tipo.toLowerCase().trim() === 'asistencia' &&
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
        } else if (eventoSede) {
          estado = obtenerEmojiPorTipo(eventoSede.tipo);
          entrada = estado;
          salida = '';
        } else {
          estado = '❌ Falta';
          entrada = '—';
          salida = '—';
        }

        datosPorDia[fechaStr] = { entrada, salida, estado };
        fechaCursor = fechaCursor.plus({ days: 1 });
      }

      resultados.push({
        nombre: [trabajador.nombre, trabajador.apellido].filter(Boolean).join(' '),
        id: trabajador._id,
        datosPorDia
      });
    }

    res.json({
      sede: sedeId,
      rango: { inicio, fin },
      trabajadores: resultados
    });

  } catch (error) {
    console.error('❌ Error en /unificado-sede:', error);
    res.status(500).json({ message: 'Error al obtener datos por sede.', error });
  }
});

function obtenerEmojiPorTipo(tipo) {
  switch (tipo) {
    case "Vacaciones": return "🌴 Vacaciones";
    case "Vacaciones Pagadas": return "💰 Vacaciones Pagadas";
    case "Permiso": return "📄 Permiso";
    case "Permiso con goce de sueldo": return "📄 Permiso con Goce";
    case "Incapacidad": return "🩺 Incapacidad";
    case "Falta": return "❌ Falta Manual";
    case "Media Jornada": return "🌓 Media Jornada";
    case "Evento": return "🎤 Evento";
    case "Capacitación": return "📚 Capacitación";
    case "Festivo": return "🎉 Festivo";
    case "Descanso": return "😴 Descanso";
    case "Puente": return "🌉 Puente";
    case "Suspensión": return "🚫 Suspensión";
    default: return tipo;
  }
}

module.exports = router;