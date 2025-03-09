const bcrypt = require('bcryptjs');
const User = require('../models/User'); // Importamos el modelo de usuario

// 🔥 Obtener la lista de usuarios (sin contraseñas)
const obtenerUsuarios = async (req, res) => {
    try {
        const usuarios = await User.find({}, '-password'); // Excluimos la contraseña
        res.status(200).json(usuarios);
    } catch (error) {
        console.error("❌ Error al obtener usuarios:", error);
        res.status(500).json({ message: "Error al obtener usuarios" });
    }
};

// 📌 Verificar contraseña antes de eliminar o desactivar usuario
const verificarContraseña = async (req, res) => {
    try {
        const { contraseña } = req.body;
        const usuario = await User.findById(req.user.id);

        if (!usuario) {
            return res.status(404).json({ message: 'Usuario no encontrado' });
        }

        const esValida = await bcrypt.compare(contraseña, usuario.password);
        if (!esValida) {
            return res.status(401).json({ message: 'Contraseña incorrecta' });
        }

        res.json({ valido: true }); // ✅ Devuelve un objeto JSON con "valido: true"

    } catch (error) {
        console.error('❌ Error verificando contraseña:', error);
        res.status(500).json({ message: 'Error en el servidor' });
    }
};

module.exports = { obtenerUsuarios, verificarContraseña };
