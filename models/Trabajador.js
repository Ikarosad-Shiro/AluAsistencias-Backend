// models/Trabajador.js
const mongoose = require('mongoose');
// (opcional) si quieres normalizar fecha a CDMX:
// const { DateTime } = require('luxon');
// const ZONE = 'America/Mexico_City';

const TrabajadorSchema = new mongoose.Schema({
  nombre: { type: String, required: true, trim: true },

  sede: { type: Number, default: null },
  sedePrincipal: { type: Number, default: null },
  sedesForaneas: { type: [Number], default: [] },

  id_checador: { type: Number, required: true, unique: false },

  sincronizado: { type: Boolean, default: false },

  correo: { type: String, default: '' },
  telefono: { type: String, default: '' },
  telefonoEmergencia: { type: String, default: '' },
  direccion: { type: String, default: '' },
  puesto: { type: String, default: '' },

  estado: { type: String, enum: ['activo', 'inactivo'], default: 'activo' },

  // 🆕 Nuevo ingreso + fechaAlta
  nuevoIngreso: { type: Boolean, default: false },
  fechaAlta: { type: Date, default: null },

  historialSedes: [{
    idSede: Number,
    nombre: String,
    fechaInicio: Date,
    fechaFin: { type: Date, default: null }
  }]
}, { timestamps: true, collection: 'trabajadores' });

// Limpieza de foráneas como ya lo tenías…
TrabajadorSchema.path('sedesForaneas').set(function (v) {
  const arr = Array.isArray(v) ? v.map(Number).filter(n => !Number.isNaN(n)) : [];
  const principal = this.sedePrincipal ?? this.sede ?? null;
  const unique = [...new Set(arr)];
  return principal == null ? unique : unique.filter(x => x !== Number(principal));
});

// Espejo sede <-> sedePrincipal
TrabajadorSchema.pre('save', function (next) {
  if (this.isModified('sedePrincipal')) this.sede = this.sedePrincipal;
  if (this.isModified('sede') && (this.sedePrincipal == null || this.isModified('sede'))) {
    this.sedePrincipal = this.sede;
  }

  // 🆕 Si viene nuevoIngreso=true y no hay fechaAlta, le ponemos hoy (UTC simple).
  if (this.nuevoIngreso && !this.fechaAlta) {
    this.fechaAlta = new Date();
    // (opcional con CDMX):
    // this.fechaAlta = DateTime.now().setZone(ZONE).startOf('day').toJSDate();
  }
  next();
});

// También contempla updates findOneAndUpdate
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

  // 🆕 Normaliza fechaAlta si viene como string y falta cuando nuevoIngreso=true
  if ($set.nuevoIngreso === true && ($set.fechaAlta == null)) {
    $set.fechaAlta = new Date();
    // (opcional CDMX):
    // $set.fechaAlta = DateTime.now().setZone(ZONE).startOf('day').toJSDate();
  }

  if (!update.$set && update !== $set) this.setUpdate($set);
  next();
});

TrabajadorSchema.index({ id_checador: 1 });
TrabajadorSchema.index({ sedePrincipal: 1 });
TrabajadorSchema.index({ estado: 1 });

module.exports = mongoose.model('Trabajador', TrabajadorSchema);
