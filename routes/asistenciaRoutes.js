const express = require("express");
const Asistencia = require("../models/Asistencia");

const Trabajador = require("../models/Trabajador");
const Sede = require("../models/Sede");
const Calendario = require("../models/Calendario");
const CalendarioTrabajador = require("../models/CalendarioTrabajador"); // Añade esta línea

const router = express.Router();

// 📌 Registrar asistencia desde el servidor local
router.post("/registrar", async (req, res) => {
  try {
    const { trabajadorId, sede, tipo } = req.body;

    if (!["Entrada", "Salida"].includes(tipo)) {
      return res.status(400).json({ message: "Tipo de asistencia inválido." });
    }

    // ✅ Normalizar fecha actual (solo YYYY-MM-DD)
    const ahora = new Date();
    const fechaStr = ahora.toISOString().split("T")[0];

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
          fechaHora: ahora
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

module.exports = router;
