const express = require("express");
const Asistencia = require("../models/Asistencia");

const Trabajador = require("../models/Trabajador");
const Sede = require("../models/Sede");
const Calendario = require("../models/Calendario");

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

// 📌 Reporte por trabajador
router.get("/reporte/trabajador/:id", async (req, res) => {
  try {
    const trabajadorId = req.params.id;
    const { inicio, fin } = req.query;

    if (!inicio || !fin) {
      return res.status(400).json({ message: "Debes proporcionar 'inicio' y 'fin' en el query." });
    }

    // ✅ Normaliza fechas para evitar errores por zona horaria
    const fechaInicio = new Date(new Date(inicio).setUTCHours(0, 0, 0, 0));
    const fechaFin = new Date(new Date(fin).setUTCHours(23, 59, 59, 999));
    const hoy = new Date().toISOString().split("T")[0];

    const trabajador = await Trabajador.findById(trabajadorId);
    if (!trabajador) return res.status(404).json({ message: "Trabajador no encontrado." });

    const sedeId = trabajador.sede;
    const año = fechaInicio.getFullYear();

    const asistencias = await Asistencia.find({
      trabajador: trabajadorId,
      fecha: {
        $gte: fechaInicio.toISOString().split("T")[0],
        $lte: fechaFin.toISOString().split("T")[0]
      }
    });

    const calendarioSede = await Calendario.findOne({ sedes: sedeId, anio: año });
    const calendarioTrabajador = await Calendario.findOne({ trabajador: trabajadorId, anio: año });

    const resultado = [];
    for (let d = new Date(fechaInicio); d <= fechaFin; d.setDate(d.getDate() + 1)) {
      const fechaStr = new Date(d).toISOString().split("T")[0];

      const asistenciaDia = asistencias.find(a => a.fecha === fechaStr);
      const eventoSede = calendarioSede?.diasEspeciales?.find(e => e.fecha.startsWith(fechaStr));
      const eventoTrabajador = calendarioTrabajador?.diasEspeciales?.find(e => e.fecha.startsWith(fechaStr));

      const entrada = asistenciaDia?.detalle?.find(x => x.tipo === "Entrada")?.fechaHora || null;
      const salida = asistenciaDia?.detalle?.find(x => x.tipo === "Salida")?.fechaHora || null;

      let estado = "Falta";
      if (eventoTrabajador) estado = eventoTrabajador.tipo;
      else if (eventoSede) estado = eventoSede.tipo;
      else if (entrada && salida) estado = "Asistencia Completa";
      else if (entrada && !salida) estado = "Salida Automática";
      else if (!entrada && !salida && fechaStr === hoy) estado = "Pendiente";

      resultado.push({
        fecha: fechaStr,
        entrada,
        salida,
        eventoSede: eventoSede?.tipo || null,
        eventoTrabajador: eventoTrabajador?.tipo || null,
        estado
      });
    }

    res.json(resultado);

  } catch (error) {
    console.error("❌ Error en el reporte:", error);
    res.status(500).json({ message: "Error al generar reporte.", error });
  }
});

module.exports = router;
