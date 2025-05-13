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
        const fechaOriginal = DateTime.fromJSDate(new Date(d.fechaHora)).plus({ hours: 3 }); // ⏰ Sumar 6h reales
      
        return {
          tipo: d.tipo,
          fechaHora: fechaOriginal.toFormat("yyyy-MM-dd'T'HH:mm:ss"), // Hora ya corregida
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

module.exports = router;