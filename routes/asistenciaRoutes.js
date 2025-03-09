const express = require("express");
const Asistencia = require("../models/Asistencia");

const router = express.Router();

// API para que el servidor local registre asistencias en MongoDB
router.post("/registrar", async (req, res) => {
  try {
    const { trabajadorId, sede, tipo } = req.body;

    if (!["Entrada", "Salida"].includes(tipo)) {
      return res.status(400).json({ message: "Tipo de asistencia inválido." });
    }

    const nuevaAsistencia = new Asistencia({
      trabajador: trabajadorId,
      sede,
      tipo,
    });

    await nuevaAsistencia.save();
    res.json({ message: "Asistencia registrada en MongoDB correctamente." });

  } catch (error) {
    res.status(500).json({ message: "Error al registrar asistencia.", error });
  }
});

module.exports = router;
