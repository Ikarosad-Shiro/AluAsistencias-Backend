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

module.exports = mongoose.model('CalendarioTrabajador', calendarioTrabajadorSchema);
