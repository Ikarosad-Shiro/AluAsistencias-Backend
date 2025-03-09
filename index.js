require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require("node-cron");
const User = require("./models/User");
const bodyParser = require('body-parser');

// 🔥 Importar rutas y middleware
const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/authMiddleware");
const trabajadoresRoutes = require('./routes/trabajadoresRoutes');

const app = express();
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// 🌍 Middlewares
app.use(express.json());

const corsOptions = {
    origin: process.env.FRONTEND_URL || "http://localhost:4200",  // 🌟 Permitir solo peticiones desde el frontend
    optionsSuccessStatus: 200  // Evitar errores en algunos navegadores viejitos
};
app.use(cors(corsOptions));

app.use(bodyParser.json());

// 📌 Rutas
app.use("/api/auth", authRoutes);
app.use('/api/trabajadores', trabajadoresRoutes);

// 📌 Conexión a MongoDB Atlas
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Conectado a MongoDB Atlas"))
    .catch(err => console.error("❌ Error conectando a MongoDB:", err));

// 🛠 Ruta de prueba para verificar que el servidor corre bien
app.get("/", (req, res) => {
    res.send("🚀 Backend corriendo correctamente");
});

// 📌 Ruta protegida
app.get("/api/protegido", authMiddleware, (req, res) => {
    res.json({ message: "🔒 Acceso permitido", usuario: req.user });
});

// 🔥 Cron job que se ejecuta todos los días a la medianoche
cron.schedule("0 0 * * *", async () => {
    try {
        const ahora = new Date();

        // 📌 Eliminar usuarios no verificados en 7 días
        const hace7dias = new Date();
        hace7dias.setDate(ahora.getDate() - 7);

        const usuariosNoVerificados = await User.deleteMany({
            verificado: false,
            fechaRegistro: { $lte: hace7dias }
        });

        console.log(`🗑️ Usuarios no verificados eliminados: ${usuariosNoVerificados.deletedCount}`);

        // 📌 Eliminar usuarios verificados pero inactivos en 30 días
        const hace30dias = new Date();
        hace30dias.setDate(ahora.getDate() - 30);

        const usuariosInactivos = await User.deleteMany({
            verificado: true,
            activo: false,
            fechaRegistro: { $lte: hace30dias }
        });

        console.log(`🗑️ Usuarios inactivos eliminados: ${usuariosInactivos.deletedCount}`);

    } catch (error) {
        console.error("❌ Error en el cron job de eliminación de usuarios:", error);
    }
});

// 🚀 Iniciar el servidor
app.listen(PORT, () => {
    console.log(`🔥 Servidor corriendo en http://localhost:${PORT}`);
});