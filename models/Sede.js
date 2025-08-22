// models/Sede.js
const mongoose = require('mongoose');

const JornadaSchema = new mongoose.Schema({
  ini: { type: String, required: true },     // "HH:mm"
  fin: { type: String, required: true },     // "HH:mm"
  overnight: { type: Boolean, default: false }
}, { _id: false });

const ReglaHorarioSchema = new mongoose.Schema({
  dow: { type: Number, required: true },     // 0..6 (0=Domingo)
  jornadas: { type: [JornadaSchema], default: [] }
}, { _id: false });

const HorarioNuevoIngresoSchema = new mongoose.Schema({
  activo: { type: Boolean, default: false },
  duracionDias: { type: Number, default: 30 },        // ventana típica
  aplicarSoloDiasActivosBase: { type: Boolean, default: true }, // respeta días activos del base
  jornadas: { type: [JornadaSchema], default: [] }     // se aplican igual para cada día activo
}, { _id: false });

const HorarioBaseSchema = new mongoose.Schema({
  desde: { type: Date, required: true },
  reglas: { type: [ReglaHorarioSchema], default: [] },
  nuevoIngreso: { type: HorarioNuevoIngresoSchema, default: () => ({}) }, // ⬅️ NUEVO
  meta: {
    version: { type: Number, default: 1 }
  }
}, { _id: false });

const ExcepcionHorarioSchema = new mongoose.Schema({
  fecha: { type: String, required: true }, // "YYYY-MM-DD"
  tipo: {
    type: String,
    enum: ['asistencia','descanso','media_jornada','festivo','evento','suspension','personalizado'],
    required: true
  },
  descripcion: { type: String, default: '' },
  horaEntrada: { type: String, default: '' },
  horaSalida:  { type: String, default: '' }
}, { timestamps: true });

const ExcepcionRangoSchema = new mongoose.Schema({
  desde: { type: String, required: true },
  hasta: { type: String, required: true },
  dows: { type: [Number], default: [] },
  jornadas: { type: [JornadaSchema], required: true },
  descripcion: { type: String, default: '' }
}, { timestamps: true });

const sedeSchema = new mongoose.Schema({
  id: { type: Number, required: true, unique: true },
  nombre: { type: String, required: true },
  direccion: { type: String, default: '' },
  zona: { type: String, default: '' },
  responsable: { type: String, default: '' },
  estado: { type: String, enum: ['activa', 'eliminacion_pendiente'], default: 'activa' },
  fechaEliminacionIniciada: { type: Date, default: null },

  horarioBase: { type: HorarioBaseSchema, default: null },
  excepciones: { type: [ExcepcionHorarioSchema], default: [] },
  excepcionesRango: { type: [ExcepcionRangoSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Sede', sedeSchema);
