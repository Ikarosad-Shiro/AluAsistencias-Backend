const mongoose = require('mongoose');

const diaEspecialSchema = new mongoose.Schema({
  fecha: { type: Date, required: true },
  tipo: {
    type: String,
    required: true,
    enum: [
      'festivo', 'puente', 'descanso', 'media jornada',
      'capacitación', 'evento', 'suspensión'
    ]
  },
  descripcion: { type: String, default: '' },

  // 👇 metadatos para asistente y "undo por lote"
  source:   { type: String, default: null },   // 'asistente-domingo'
  batchId:  { type: String, default: null },   // uuid del lote
  createdBy:{ type: String, default: null },   // email o _id
  createdAt:{ type: Date,   default: Date.now }
});

const calendarioSchema = new mongoose.Schema({
  año:    { type: Number, required: true },
  sedes:  { type: [Number], required: true }, // IDs de sedes que usan este calendario
  diasEspeciales: { type: [diaEspecialSchema], default: [] }
});

// 🔎 acelera consultas por año + sede
calendarioSchema.index({ año: 1, sedes: 1 });

module.exports = mongoose.model('Calendario', calendarioSchema);
