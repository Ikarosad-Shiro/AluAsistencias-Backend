const mongoose = require('mongoose');

const TrabajadorSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },

  // 🧭 Sede principal + espejo legacy
  sede: { type: Number, default: null },            // espejo para compatibilidad
  sedePrincipal: { type: Number, default: null },

  // 🌎 Foráneas (sin límite; deduplicadas y sin la principal)
  sedesForaneas: { type: [Number], default: [] },

  // ⏱️ Checador
  id_checador: { type: Number, required: true, unique: false }, // pon unique:true cuando no tengas duplicados

  // 🔄 Estado de sincronización
  sincronizado: { type: Boolean, default: false },

  // 📇 Datos de contacto
  correo: { type: String, default: '' },
  telefono: { type: String, default: '' },
  telefonoEmergencia: { type: String, default: '' },
  direccion: { type: String, default: '' },
  puesto: { type: String, default: '' },

  // 🚥 Estatus laboral
  estado: { type: String, enum: ['activo', 'inactivo'], default: 'activo' },
  fechaAlta: { type: Date, default: null },

  // 🗂️ Historial de sedes
  historialSedes: [{
    idSede: Number,
    nombre: String,
    fechaInicio: Date,
    fechaFin: { type: Date, default: null }
  }]
}, { timestamps: true, collection: 'trabajadores' });

/* =========================
   Setters / Hooks de limpieza
   ========================= */

// Quita duplicados y la principal de sedesForaneas
TrabajadorSchema.path('sedesForaneas').set(function (v) {
  const arr = Array.isArray(v) ? v.map(Number).filter(n => !Number.isNaN(n)) : [];
  const principal = this.sedePrincipal ?? this.sede ?? null;
  const unique = [...new Set(arr)];
  return principal == null ? unique : unique.filter(x => x !== Number(principal));
});

// Espejo sede <-> sedePrincipal en save
TrabajadorSchema.pre('save', function (next) {
  if (this.isModified('sedePrincipal')) this.sede = this.sedePrincipal;
  if (this.isModified('sede') && (this.sedePrincipal == null || this.isModified('sede'))) {
    this.sedePrincipal = this.sede;
  }
  next();
});

// Espejo + limpieza en updates tipo findOneAndUpdate
TrabajadorSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate() || {};
  const $set = update.$set || update;

  if ($set.sedePrincipal != null) $set.sede = $set.sedePrincipal;
  else if ($set.sede != null) $set.sedePrincipal = $set.sede;

  if ($set.sedesForaneas) {
    const principal = $set.sedePrincipal ?? $set.sede ?? undefined;
    let arr = Array.isArray($set.sedesForaneas) ? $set.sedesForaneas.map(Number) : [];
    arr = [...new Set(arr)];
    if (principal != null) arr = arr.filter(x => x !== Number(principal));
    $set.sedesForaneas = arr;
  }

  if (!update.$set && update !== $set) this.setUpdate($set);
  next();
});

/* =========
   Índices
   ========= */
TrabajadorSchema.index({ id_checador: 1 }); // cambia a { unique: true } cuando limpies duplicados
TrabajadorSchema.index({ sedePrincipal: 1 });
TrabajadorSchema.index({ estado: 1 });

module.exports = mongoose.model('Trabajador', TrabajadorSchema);
