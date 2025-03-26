const express = require('express');
const router = express.Router();
const Sede = require('../models/Sede');

// ➕ Agregar nueva sede
router.post('/agregar', async (req, res) => {
  try {
    const { id, nombre } = req.body;

    // Validación básica
    if (!id || !nombre) {
      return res.status(400).json({ message: 'Faltan campos requeridos.' });
    }

    // Verificar si ya existe esa sede
    const existe = await Sede.findOne({ id });
    if (existe) {
      return res.status(400).json({ message: 'La sede con este ID ya existe.' });
    }

    const nuevaSede = new Sede({ id, nombre });
    await nuevaSede.save();

    res.status(201).json({ message: 'Sede agregada correctamente.', sede: nuevaSede });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 📋 Obtener todas las sedes (para Angular)
router.get('/todas', async (req, res) => {
    try {
      const sedes = await Sede.find();
      res.json(sedes);
    } catch (error) {
      res.status(500).json({ message: 'Error al obtener sedes', error });
    }
  });

module.exports = router;
