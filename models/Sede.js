// models/Sede.js
const mongoose = require('mongoose');

/* ===== Subesquemas para horario base ===== */
const JornadaSchema = new mongoose.Schema({
  ini: { type: String, required: true },     // "HH:mm"
  fin: { type: String, required: true },     // "HH:mm"
  overnight: { type: Boolean, default: false }
}, { _id: false });

const ReglaHorarioSchema = new mongoose.Schema({
  dow: { type: Number, required: true },     // 0..6 (0=Domingo)
  jornadas: { type: [JornadaSchema], default: [] }
}, { _id: false });

const HorarioBaseSchema = new mongoose.Schema({
  desde: { type: Date, required: true },
  reglas: { type: [ReglaHorarioSchema], default: [] },
  meta: {
    version: { type: Number, default: 1 }
  }
}, { _id: false });

/* ===== Subesquema para excepciones por fecha ===== */
const ExcepcionHorarioSchema = new mongoose.Schema({
  fecha: { type: String, required: true }, // "YYYY-MM-DD"
  tipo: {
    type: String,
    enum: ['asistencia','descanso','media_jornada','festivo','evento','suspension','personalizado'],
    required: true
  },
  descripcion: { type: String, default: '' },
  horaEntrada: { type: String, default: '' }, // "HH:mm"
  horaSalida:  { type: String, default: '' }  // "HH:mm"
}, { timestamps: true });

// ⬇️ NUEVO: excepciones por rango (horario temporal)
const ExcepcionRangoSchema = new mongoose.Schema({
  desde: { type: String, required: true }, // "YYYY-MM-DD"
  hasta: { type: String, required: true }, // "YYYY-MM-DD"
  // qué días de la semana se aplican dentro del rango (0..6). Si no se envía, aplica a todos.
  dows: { type: [Number], default: [] }, 
  // jornadas que sustituyen al horario base en esas fechas
jornadas: { type: [JornadaSchema], required: true },
  descripcion: { type: String, default: '' }
}, { timestamps: true });

/* ===== Esquema principal de Sede (tu estructura + nuevos campos) ===== */
const sedeSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  nombre: { type: String, required: true },
  direccion: { type: String, default: '' },
  zona: { type: String, default: '' },
  responsable: { type: String, default: '' },

  estado: { type: String, enum: ['activa', 'eliminacion_pendiente'], default: 'activa' },
  fechaEliminacionIniciada: { type: Date, default: null },

  // ✅ NUEVO: horario base fijo y excepciones por fecha
  horarioBase: { type: HorarioBaseSchema, default: null },
  excepciones: { type: [ExcepcionHorarioSchema], default: [] },
  excepcionesRango: { type: [ExcepcionRangoSchema], default: [] }    // ⬅️ NUEVO
}, { timestamps: true });

module.exports = mongoose.model('Sede', sedeSchema);
