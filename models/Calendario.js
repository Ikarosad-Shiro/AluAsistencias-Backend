const mongoose = require('mongoose');

const diaEspecialSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    required: true
  },
  tipo: {
    type: String,
    required: true,
    enum: ['festivo', 'vacaciones', 'puente', 'descanso', 'media jornada']
  },
  descripcion: {
    type: String,
    default: ''
  }
});

const calendarioSchema = new mongoose.Schema({
  año: {
    type: Number,
    required: true
  },
  sedes: {
    type: [Number], // IDs de sedes a las que aplica este calendario
    required: true
  },
  diasEspeciales: {
    type: [diaEspecialSchema],
    default: []
  }
});

module.exports = mongoose.model('Calendario', calendarioSchema);
