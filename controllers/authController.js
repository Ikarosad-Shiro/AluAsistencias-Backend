const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const User = require('../models/User'); // Importamos el modelo de usuario

// 🔥 Obtener la lista de usuarios (sin contraseñas)
const obtenerUsuarios = async(req, res) => {
    try {
        const usuarios = await User.find({}, '-password'); // Excluimos la contraseña
        res.status(200).json(usuarios);
    } catch (error) {
        console.error("❌ Error al obtener usuarios:", error);
        res.status(500).json({ message: "Error al obtener usuarios" });
    }
};

// 📌 Verificar contraseña antes de eliminar o desactivar usuario
const verificarContraseña = async(req, res) => {
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

// 🔑 Recuperación de contraseña (forgot-password)
const forgotPassword = async(req, res) => {
    try {
        const { email } = req.body;

        // 🔍 Verificar si el correo existe
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'El correo no está registrado en el sistema.' });
        }

        // 🛠 Generar token de recuperación con expiración de 1 hora
        const resetToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Guardar el token en la base de datos
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // Expira en 1 hora
        await user.save();

        // 📧 Configurar el correo
        const transporter = nodemailer.createTransport({
            service: 'gmail', // Configura tu proveedor de correo
            auth: {
                user: process.env.EMAIL_USER, // Usa variables de entorno para seguridad
                pass: process.env.EMAIL_PASS
            }
        });

        // 🔗 Enlace de recuperación
        //const resetLink = `http://localhost:4200/reset-password?token=${resetToken}`;
        const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'Recuperación de Contraseña - Alu Asistencias',
            html: `
                <p>Hola, ${user.nombre}. Haz clic en el siguiente enlace para restablecer tu contraseña:</p>
                <a href="${resetLink}" style="background-color:#007bff;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;">Restablecer Contraseña</a>
                <p>Si no solicitaste este cambio, ignora este mensaje.</p>
            `
        };

        // 📬 Enviar el correo
        await transporter.sendMail(mailOptions);

        res.status(200).json({ message: 'Correo enviado con éxito. Revisa tu bandeja de entrada.' });

    } catch (error) {
        console.error('❌ Error en forgot-password:', error);
        res.status(500).json({ message: 'Error en el servidor. Inténtalo más tarde.' });
    }
};

// 🔐 Confirmar y actualizar la nueva contraseña
const resetPasswordConfirm = async(req, res) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ message: 'Token y contraseña son requeridos.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Usuario no encontrado.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        user.password = hashedPassword;

        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;

        await user.save();

        res.status(200).json({ message: 'Contraseña actualizada correctamente.' });

    } catch (error) {
        console.error('❌ Error al restablecer contraseña:', error);
        return res.status(400).json({ message: 'Token inválido o expirado.' });
    }
};

module.exports = { obtenerUsuarios, verificarContraseña, forgotPassword, resetPasswordConfirm };