const express = require('express');
const router = express.Router();
const Sede = require('../models/Sede');

// 🌐 Obtener todas las sedes
router.get('/', async (req, res) => {
  try {
    const sedes = await Sede.find();
    res.json(sedes);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener sedes', error });
  }
});

module.exports = router;
