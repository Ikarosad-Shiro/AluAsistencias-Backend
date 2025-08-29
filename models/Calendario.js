// models/Calendario.js
const mongoose = require('mongoose');

// ---------- Helpers ----------
const HHMM_STRICT = /^(\d{2}):(\d{2})$/;

const normalizeHHMM = (val) => {
  if (val === undefined || val === null || val === '') return null;
  const s = String(val).trim();
  // Acepta "9:05" o "09:05" y normaliza a "09:05"
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s; // si viene raro, el validador de abajo lo detiene
  let h = parseInt(m[1], 10);
  let min = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(min)) return s;
  if (h < 0 || h > 23 || min < 0 || min > 59) return s;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

const toMinutes = (hhmm) =>
  parseInt(hhmm.slice(0, 2), 10) * 60 + parseInt(hhmm.slice(3), 10);

// Normaliza la fecha a medianoche UTC (YYYY-MM-DDT00:00:00.000Z)
const normalizeDateToUTC0 = (d) => {
  if (!d) return d;
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
};

// ---------- Subdocumento: Día Especial ----------
const diaEspecialSchema = new mongoose.Schema(
  {
    fecha: { type: Date, required: true },

    tipo: {
      type: String,
      required: true,
      enum: [
        'festivo',
        'puente',
        'descanso',
        'media jornada',
        'capacitación',
        'evento',
        'suspensión'
      ]
    },

    // Horario solo aplica a "media jornada"
    horaInicio: { type: String, default: null, set: normalizeHHMM }, // 'HH:mm'
    horaFin: { type: String, default: null, set: normalizeHHMM },    // 'HH:mm'

    descripcion: { type: String, default: '' },

    // Metadatos opcionales (para asistente / auditoría / undo por lote)
    source: { type: String, default: null },    // p.ej. 'asistente-domingo'
    batchId: { type: String, default: null },   // UUID del lote
    createdBy: { type: String, default: null }, // email o _id del usuario
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

// Validaciones “pro” y normalización de fecha
diaEspecialSchema.pre('validate', function (next) {
  // Normaliza fecha a 00:00:00Z
  if (this.isModified('fecha') && this.fecha) {
    this.fecha = normalizeDateToUTC0(this.fecha);
  }

  if (this.tipo === 'media jornada') {
    // Requiere horas válidas
    if (!HHMM_STRICT.test(this.horaInicio || '') || !HHMM_STRICT.test(this.horaFin || '')) {
      return next(new Error('Media jornada requiere horaInicio y horaFin en formato HH:mm'));
    }
    if (toMinutes(this.horaFin) <= toMinutes(this.horaInicio)) {
      return next(new Error('horaFin debe ser mayor que horaInicio'));
    }
  } else {
    // Para otros tipos, limpia las horas
    this.horaInicio = null;
    this.horaFin = null;
  }

  return next();
});

// ---------- Documento: Calendario ----------
const calendarioSchema = new mongoose.Schema({
  año: { type: Number, required: true },
  sedes: { type: [Number], required: true },           // IDs de sedes
  diasEspeciales: { type: [diaEspecialSchema], default: [] }
});

// Índices para acelerar las consultas típicas
calendarioSchema.index({ año: 1, sedes: 1 });                       // findOne({año, sedes: {$in: [sede]}})
calendarioSchema.index({ año: 1, 'diasEspeciales.fecha': 1 });      // filtrar por fecha dentro de un año

// Limpieza de salida JSON
calendarioSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_, ret) => ret
});

module.exports = mongoose.model('Calendario', calendarioSchema);
