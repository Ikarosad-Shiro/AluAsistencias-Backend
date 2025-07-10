const mongoose = require('mongoose');

const AsistenciaSchema = new mongoose.Schema({
  trabajador: {
    type: String,         // ID del trabajador (id_checador)
    required: true
  },
  sede: {
    type: Number,         // ID de la sede
    required: true
  },
  fecha: {
    type: String,         // Formato: 'YYYY-MM-DD' como string
    required: true
  },
  estado: {
    type: String,         // Ej: 'Asistencia Completa', 'Falta', 'Pendiente'
    default: 'Pendiente'
  },
  detalle: [
    {
      trabajador: {
        type: String,    // ← ¡Agrega esto!
        required: true
      },
      tipo: {
        type: String,
        required: true
      },
      fechaHora: {
        type: String,
        required: true
      },
      sincronizado: {
        type: Boolean,
        default: false
      },
      salida_automatica: {
        type: Boolean,
        default: false
      }
    }
  ]  
});

module.exports = mongoose.model('Asistencia', AsistenciaSchema, 'asistencias');
