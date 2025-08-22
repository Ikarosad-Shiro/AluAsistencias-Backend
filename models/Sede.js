// models/Sede.js
const mongoose = require('mongoose');

/* ===== Subesquemas para horario base ===== */
const JornadaSchema = new mongoose.Schema({
  ini: { type: String, required: true },     // "HH:mm"
  fin: { type: String, required: true },     // "HH:mm"
  overnight: { type: Boolean, default: false }
}, { _id: false });

const ReglaHorarioSchema = new mongoose.Schema({
  // 👇 usamos 0..6 (0=Domingo, 1=Lunes, ... 6=Sábado)
  dow: { type: Number, required: true, min: 0, max: 6 },
  jornadas: { type: [JornadaSchema], default: [] }
}, { _id: false });

const NuevoIngresoSchema = new mongoose.Schema({
  activo: { type: Boolean, default: false },
  duracionDias: { type: Number, default: 30, min: 1, max: 180 },
  aplicarSoloDiasActivosBase: { type: Boolean, default: true },
  jornadas: { type: [JornadaSchema], default: [] }
}, { _id: false });

const HorarioBaseSchema = new mongoose.Schema({
  desde: { type: Date, required: true },
  reglas: { type: [ReglaHorarioSchema], default: [] },
  nuevoIngreso: { type: NuevoIngresoSchema, default: () => ({}) },
  meta: {
    version: { type: Number, default: 1 }
  }
}, { _id: false });

/* ===== Esquema principal de Sede ===== */
const sedeSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  nombre: { type: String, required: true },
  direccion: { type: String, default: '' },
  zona: { type: String, default: '' },
  responsable: { type: String, default: '' },

  estado: { type: String, enum: ['activa', 'eliminacion_pendiente'], default: 'activa' },
  fechaEliminacionIniciada: { type: Date, default: null },

  // ✅ Sólo el horario base vive aquí
  horarioBase: { type: HorarioBaseSchema, default: null }

  // ❌ YA NO:
  // excepciones: [],
  // excepcionesRango: []
}, { timestamps: true });

module.exports = mongoose.model('Sede', sedeSchema);
