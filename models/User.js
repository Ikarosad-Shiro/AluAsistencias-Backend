const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  rol: { 
    type: String, 
    enum: ["Dios", "Administrador", "Revisor"], 
    default: "Revisor" 
  },
  activo: { type: Boolean, default: false }, // 🔥 Solo el admin lo activa
  verificado: { type: Boolean, default: false }, // 📩 Se cambia cuando el usuario verifica su correo
  fechaRegistro: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
