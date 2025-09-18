// models/Trabajador.js
const mongoose = require('mongoose');

const HistorialSedeSchema = new mongoose.Schema({
  idSede: { type: Number, required: true },
  nombre: { type: String, default: '' },     // opcional, por si quieres mostrar nombre directo
  fechaInicio: { type: Date, default: Date.now },
  fechaFin: { type: Date, default: null }
}, { _id: false });

const TrabajadorSchema = new mongoose.Schema({
  // --- Datos básicos
  nombre: { type: String, required: true, trim: true },

  // --- Compatibilidad legacy: `sede` se mantiene como espejo de `sedePrincipal`
  sede: { type: Number, required: false, default: null, index: true },

  // --- Nuevo modelo multisede
  sedePrincipal: { type: Number, default: null, index: true },
  sedesForaneas: { type: [Number], default: [] },

  historialSedes: { type: [HistorialSedeSchema], default: [] },

  // --- Checador
  // Si tu backend antes lo generaba automáticamente, puedes dejarlo opcional
  id_checador: { type: Number, required: false, unique: false },

  // --- Otros datos
  sincronizado: { type: Boolean, default: false },
  correo: { type: String, default: '' },
  telefono: { type: String, default: '' },
  telefonoEmergencia: { type: String, default: '' },
  direccion: { type: String, default: '' },
  puesto: { type: String, default: '' },
  estado: { type: String, enum: ['activo', 'inactivo'], default: 'activo' },

  // --- Alta (opcional)
  fechaAlta: { type: Date, default: null }
}, { timestamps: true });

/**
 * Helper para cambiar sede principal y mantener historial.
 * nombreSede es opcional (si quieres guardar el nombre para reportes rápidos).
 */
TrabajadorSchema.methods.cambiarSede = function (nuevaSede, nombreSede = '') {
  const ahora = new Date();

  // cierra historial abierto
  const abierto = this.historialSedes.find(h => !h.fechaFin);
  if (abierto) abierto.fechaFin = ahora;

  // crea nuevo historial
  if (nuevaSede !== null && nuevaSede !== undefined) {
    this.historialSedes.push({
      idSede: Number(nuevaSede),
      nombre: nombreSede || '',
      fechaInicio: ahora,
      fechaFin: null
    });
  }

  // actualiza campos espejo
  this.sedePrincipal = nuevaSede ?? null;
  this.sede = nuevaSede ?? null;

  return this;
};

module.exports = mongoose.model('Trabajador', TrabajadorSchema, 'trabajadores');
