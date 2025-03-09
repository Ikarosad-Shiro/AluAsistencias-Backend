const mongoose = require("mongoose");

const sedeSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  ubicacion: { type: String, required: true },
  checadores: [{ type: String }] // Lista de IDs o nombres de checadores
});

module.exports = mongoose.model("Sede", sedeSchema);
