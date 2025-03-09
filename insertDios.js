const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// 🔗 Conexión a MongoDB Atlas
const mongoURI = "mongodb+srv://desconexionparcial:LwryVX9pbCjdM8ao@cluster0.7rjoqap.mongodb.net/Registro_Alu?retryWrites=true&w=majority";
mongoose.connect(mongoURI)
    .then(() => console.log("✅ Conectado a MongoDB Atlas correctamente."))
    .catch(err => console.error("❌ Error conectando a MongoDB Atlas", err));

// 📌 Definir el esquema del usuario (Asegúrate de que sea igual a los demás usuarios)
const userSchema = new mongoose.Schema({
    nombre: String,
    email: { type: String, unique: true },
    password: String,
    rol: String,
    activo: Boolean,
    fechaRegistro: { type: Date, default: Date.now } // ⏳ Fecha de registro automática
});

// 📌 Modelo de usuario basado en el esquema
const User = mongoose.model('users', userSchema);

// 🛠️ **Crear la cuenta Dios**
const crearCuentaDios = async () => {
    try {
        // 🔒 Contraseña cifrada (ya generaste una, pero puedes cambiarla si quieres)
        const passwordHash = "$2a$10$PvYrZs/BPxWfaDeH7JwKCekGB4loC4pvbbATCjTjwVMZh4fQPF29S"; 

        // 🌟 Datos de la cuenta Dios
        const usuarioDios = new User({
            nombre: "Dios",
            email: "dios@example.com", // Puedes cambiarlo
            password: passwordHash,
            rol: "Dios",
            activo: true, // Dios siempre activo
            fechaRegistro: new Date() // 🕒 Fecha exacta del momento de la creación
        });

        // 📌 Verificar si ya existe para evitar duplicados
        const existeDios = await User.findOne({ email: usuarioDios.email });
        if (existeDios) {
            console.log("⚠️ La cuenta Dios ya existe en la base de datos.");
        } else {
            await usuarioDios.save();
            console.log("✅ Cuenta Dios insertada exitosamente en la colección 'users'.");
        }

        // 🚀 Cerrar la conexión
        mongoose.connection.close();
    } catch (error) {
        console.error("❌ Error insertando usuario Dios", error);
    }
};

// 🚀 Ejecutar la función para insertar la cuenta Dios
crearCuentaDios();
