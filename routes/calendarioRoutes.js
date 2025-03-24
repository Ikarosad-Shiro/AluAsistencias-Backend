const express = require('express');
const router = express.Router();
const Calendario = require('../models/Calendario');

router.get('/ping', (req, res) => {
    res.send('💖 ¡La ruta calendario está viva!');
  });  

router.get('/todos', async (req, res) => {
    const calendarios = await Calendario.find();
    res.json(calendarios);
  });
  

// 🔍 Obtener calendario por año y sede específica
router.get('/:año/:sede', async (req, res) => {
    try {
      const año = parseInt(req.params.año);
      const sede = parseInt(req.params.sede);
  
      const calendario = await Calendario.findOne({
        año,
        sedes: { $in: [sede] }
      });
  
      if (!calendario) {
        return res.status(404).json({ message: 'Calendario no encontrado para esta sede y año.' });
      }
  
      res.json(calendario);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });  

// ➕ Agregar un día especial
router.post('/agregar-dia', async (req, res) => {
  try {
    const { año, sede, fecha, tipo, descripcion } = req.body;

    let calendario = await Calendario.findOne({ año, sedes: { $in: [sede] } });

    // Si no existe, lo creamos desde cero
    if (!calendario) {
      calendario = new Calendario({ año, sedes: [sede], diasEspeciales: [] });
    }

    // Revisamos si ya existe esa fecha
    const existe = calendario.diasEspeciales.some(d => d.fecha.toISOString().slice(0, 10) === fecha);
    if (existe) return res.status(400).json({ message: 'Ese día ya está configurado.' });

    calendario.diasEspeciales.push({ fecha, tipo, descripcion });
    await calendario.save();

    res.json({ message: 'Día especial agregado con éxito', calendario });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ✏️ Editar un día especial
router.put('/editar-dia', async (req, res) => {
  try {
    const { año, sede, fecha, nuevoTipo, nuevaDescripcion } = req.body;

    const calendario = await Calendario.findOne({ año, sedes: sede });
    if (!calendario) return res.status(404).json({ message: 'Calendario no encontrado.' });

    const dia = calendario.diasEspeciales.find(d => d.fecha.toISOString().slice(0, 10) === fecha);
    if (!dia) return res.status(404).json({ message: 'Día no encontrado en el calendario.' });

    dia.tipo = nuevoTipo;
    dia.descripcion = nuevaDescripcion;

    await calendario.save();
    res.json({ message: 'Día actualizado correctamente', calendario });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ❌ Eliminar un día especial
router.delete('/eliminar-dia', async (req, res) => {
  try {
    const { año, sede, fecha } = req.body;

    const calendario = await Calendario.findOne({ año, sedes: sede });
    if (!calendario) return res.status(404).json({ message: 'Calendario no encontrado.' });

    calendario.diasEspeciales = calendario.diasEspeciales.filter(
      d => d.fecha.toISOString().slice(0, 10) !== fecha
    );

    await calendario.save();
    res.json({ message: 'Día eliminado del calendario', calendario });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
