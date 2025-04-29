const mongoose = require('mongoose');

const calendarioTrabajadorSchema = new mongoose.Schema({
  trabajador: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Trabajador',
    required: true
  },
  anio: {
    type: Number,
    required: true
  },
  diasEspeciales: [
    {
      fecha: {
        type: Date,
        required: true
      },
      tipo: {
        type: String,
        required: true
      }
    }
  ]
});

// 🔐 Índice compuesto para evitar duplicados por trabajador y año
calendarioTrabajadorSchema.index({ trabajador: 1, anio: 1 }, { unique: true });

module.exports = mongoose.model('CalendarioTrabajador', calendarioTrabajadorSchema);
