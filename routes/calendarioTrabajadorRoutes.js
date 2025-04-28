const express = require('express');
const router = express.Router();
const CalendarioTrabajador = require('../models/CalendarioTrabajador');
const authMiddleware = require('../middleware/authMiddleware');

// 📌 Obtener el calendario de un trabajador para un año específico
router.get('/:trabajador/:anio', authMiddleware, async (req, res) => {
  try {
    const { trabajador, anio } = req.params;
    const calendario = await CalendarioTrabajador.findOne({ trabajador, anio });
    res.status(200).json(calendario || null);
  } catch (error) {
    console.error('❌ Error al obtener calendario del trabajador:', error);
    res.status(500).json({ message: 'Error al obtener calendario del trabajador' });
  }
});

// 📌 Crear o actualizar días especiales del trabajador
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { trabajador, anio, diasEspeciales } = req.body;

    let calendario = await CalendarioTrabajador.findOne({ trabajador, anio });

    if (!calendario) {
      calendario = new CalendarioTrabajador({ trabajador, anio, diasEspeciales });
    } else {
      calendario.diasEspeciales = diasEspeciales; // Sobreescribir completamente
    }

    await calendario.save();
    res.status(200).json({ message: 'Calendario actualizado exitosamente', calendario });
  } catch (error) {
    console.error('❌ Error al guardar calendario del trabajador:', error);
    res.status(500).json({ message: 'Error al guardar calendario del trabajador' });
  }
});

// 📌 Eliminar un día especial del calendario del trabajador
router.put('/:trabajador/:anio', authMiddleware, async (req, res) => {
  try {
    const { trabajador, anio } = req.params;
    const { nuevaListaDias } = req.body;

    const calendario = await CalendarioTrabajador.findOneAndUpdate(
      { trabajador, anio },
      { diasEspeciales: nuevaListaDias },
      { new: true }
    );

    if (!calendario) {
      return res.status(404).json({ message: 'Calendario no encontrado' });
    }

    res.status(200).json({ message: 'Día eliminado exitosamente', calendario });
  } catch (error) {
    console.error('❌ Error al eliminar día del calendario del trabajador:', error);
    res.status(500).json({ message: 'Error al eliminar día del calendario' });
  }
});

module.exports = router;
