require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cron = require("node-cron");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const bodyParser = require("body-parser");
const User = require("./models/User");

// 🔥 Importar rutas y middleware
const authRoutes = require("./routes/authRoutes");
const authMiddleware = require("./middleware/authMiddleware");
const trabajadoresRoutes = require("./routes/trabajadoresRoutes");
const sedeRoutes = require('./routes/sedeRoutes');

const app = express();
const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// 🌟 Seguridad: Helmet para proteger contra vulnerabilidades comunes
app.use(helmet());

// 🌟 Comprimir respuestas para mejorar el rendimiento
app.use(compression());

// 🌟 Limitar peticiones para prevenir ataques de fuerza bruta y DDoS
app.set("trust proxy", 1);  // 🌟 Confía en el proxy de Render

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutos
    max: 100,  // Máximo 100 peticiones por IP cada 15 minutos
    message: "⚠️ Demasiadas peticiones. Intenta de nuevo más tarde."
});
app.use(limiter);

// 🌍 Middlewares
app.use(express.json());
app.use(bodyParser.json());

// 🌟 Configurar CORS con opciones específicas para producción
const allowedOrigins = [
    "http://localhost:4200", 
    "https://alu-asistencias.onrender.com",
    "https://aluasistencias-backend.onrender.com"
];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("CORS bloqueado"));
        }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

// 🔒 Ocultar el header X-Powered-By para mayor seguridad
app.disable("x-powered-by");

// 📌 Conexión a MongoDB Atlas con opciones para producción
mongoose.connect(MONGO_URI)
.then(() => console.log("✅ Conectado a MongoDB Atlas"))
.catch(err => console.error("❌ Error conectando a MongoDB:", err));

// 📌 Rutas
app.use("/api/auth", authRoutes);
app.use("/api/trabajadores", trabajadoresRoutes);
app.use('/api/sedes', sedeRoutes);

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

        // 📌 Eliminar sedes en estado "eliminacion_pendiente" hace más de 15 días
        const hace15Dias = new Date();
        hace15Dias.setDate(ahora.getDate() - 15);
    
        const sedesEliminadas = await Sede.deleteMany({
          estado: 'eliminacion_pendiente',
          fechaEliminacionIniciada: { $lte: hace15Dias }
        });
    
        console.log(`🏢 Sedes eliminadas permanentemente: ${sedesEliminadas.deletedCount}`);    
});

//Ruta del configuracion del calendario
app.use('/api/calendario', require('./routes/calendarioRoutes'));

// 📌 Calendario de Trabajador (personal)
app.use('/api/calendario-trabajador', require('./routes/calendarioTrabajadorRoutes'));

//nueva funcion
app.use('/api/asistencias', require('./routes/asistenciaRoutes'));

// 🛑 Manejo de errores global
app.use((err, req, res, next) => {
    console.error("❌ Error no manejado:", err);
    res.status(500).json({ message: "Error interno del servidor" });
});

// 🚀 Iniciar el servidor
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🔥 Servidor corriendo en el puerto ${PORT}`);
});
