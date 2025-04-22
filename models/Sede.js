// ✅ models/Sede.js
const mongoose = require('mongoose');

const sedeSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true
  },
  nombre: {
    type: String,
    required: true
  },
  direccion: {
    type: String,
    default: ''
  },
  zona: {
    type: String,
    default: ''
  },
  responsable: {
    type: String,
    default: ''
  },
  estado: {
    type: String,
    enum: ['activa', 'eliminacion_pendiente'],
    default: 'activa'
  },
  fechaEliminacionIniciada: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('Sede', sedeSchema);
