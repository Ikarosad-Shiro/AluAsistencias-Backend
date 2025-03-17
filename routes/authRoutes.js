const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

const { enviarCorreoVerificacion } = require("../services/emailService"); // Importamos el servicio de email
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// ⚠️ Verificar si JWT_SECRET está configurado
if (!JWT_SECRET) {
  console.error("❌ ERROR: No se ha configurado JWT_SECRET en las variables de entorno.");
  process.exit(1);
}

// 📌 Obtener perfil del usuario autenticado
router.get("/perfil", authMiddleware, async (req, res) => {
  try {
    const usuario = await User.findById(req.user.id, "-password"); // 🔥 Excluimos la contraseña
    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }
    res.status(200).json(usuario);
  } catch (error) {
    console.error("❌ Error al obtener perfil:", error);
    res.status(500).json({ message: "Error al obtener el perfil." });
  }
});


// 📌 Obtener todos los usuarios
router.get("/usuarios", async (req, res) => {
  try {
    const usuarios = await User.find({}, "-password"); // Excluir la contraseña
    res.status(200).json(usuarios);
  } catch (error) {
    console.error("❌ Error al obtener usuarios:", error);
    res.status(500).json({ message: "Error al obtener usuarios." });
  }
});


// 📌 Verificar contraseña antes de una acción sensible
router.post("/usuarios/verificar-password", authMiddleware, async (req, res) => {
  try {
    const { contraseña } = req.body;

    if (!contraseña) {
      return res.status(400).json({ message: "La contraseña es requerida." });
    }

    const usuario = await User.findById(req.user.id);
    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const esValida = await bcrypt.compare(contraseña, usuario.password);
    if (!esValida) {
      return res.status(401).json({ message: "Contraseña incorrecta." });
    }

    res.status(200).json({ valido: true });
  } catch (error) {
    console.error("❌ Error al verificar contraseña:", error);
    res.status(500).json({ message: "Error al verificar contraseña." });
  }
});

// 📌 Registrar un nuevo usuario
router.post("/register", async (req, res) => {
  try {
    const { nombre, email, password } = req.body;

    // Validar campos obligatorios
    if (!nombre || !email || !password) {
      return res.status(400).json({ message: "Todos los campos son obligatorios." });
    }

    // Validar formato del email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Correo electrónico no válido." });
    }

    // Verificar si el usuario ya existe
    const existeUsuario = await User.findOne({ email });
    if (existeUsuario) {
      return res.status(400).json({ message: "El usuario ya está registrado." });
    }

    // Hash de la contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Crear el nuevo usuario
    const nuevoUsuario = new User({
      nombre,
      email,
      password: hashedPassword,
      activo: false,
      verificado: false,
      fechaRegistro: new Date()
    });

    await nuevoUsuario.save();

    // Generar token de verificación
    const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "1d" });

    // Enviar correo de verificación
    await enviarCorreoVerificacion(email, token);

    res.status(201).json({ message: "Registro exitoso. Revisa tu correo para activar tu cuenta." });
  } catch (error) {
    console.error("❌ Error en registro:", error);
    res.status(500).json({ message: "Error en el registro." });
  }
});

// 📌 Verificar cuenta mediante token
router.get("/verify/:token", async (req, res) => {
  try {
    const { token } = req.params;

    // Verificar el token
    const decoded = jwt.verify(token, JWT_SECRET);
    const usuario = await User.findOne({ email: decoded.email });

    if (!usuario) {
      return res.status(400).json({ message: "Usuario no encontrado." });
    }

    // Marcar como verificado
    usuario.verificado = true;
    await usuario.save();

    res.redirect(`${process.env.FRONTEND_URL}/login?verified=true`);
  } catch (error) {
    console.error("❌ Error al verificar cuenta:", error);
    res.status(500).json({ message: "Error en la verificación." });
  }
});

// 📌 Iniciar sesión
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validar campos obligatorios
    if (!email || !password) {
      return res.status(400).json({ message: "Todos los campos son obligatorios." });
    }

    // Buscar el usuario
    const usuario = await User.findOne({ email });
    if (!usuario) {
      return res.status(400).json({ message: "Usuario o contraseña incorrectos." });
    }

    // Verificar si la cuenta está activa y verificada
    if (!usuario.verificado) {
      return res.status(401).json({ message: "Tu cuenta aún no ha sido verificada. Revisa tu correo." });
    }

    if (!usuario.activo) {
      return res.status(401).json({ message: "Tu cuenta aún no ha sido activada por el administrador." });
    }

    // Verificar la contraseña
    const esValido = await bcrypt.compare(password, usuario.password);
    if (!esValido) {
      return res.status(400).json({ message: "Usuario o contraseña incorrectos." });
    }

    // Generar token de autenticación
    const token = jwt.sign(
      { id: usuario._id, rol: usuario.rol },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.status(200).json({
      message: "Inicio de sesión exitoso",
      token,
      usuario: { id: usuario._id, nombre: usuario.nombre, rol: usuario.rol }
    });
  } catch (error) {
    console.error("❌ Error en login:", error);
    res.status(500).json({ message: "Error en el login." });
  }
});

// 📌 Ruta protegida para comprobar autenticación
router.get("/protegido", authMiddleware, (req, res) => {
  res.json({ message: "🔒 Acceso permitido", usuario: req.user });
});

// 📌 Activar cuenta de usuario (solo Admin o Dios)
router.put("/activar/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.rol !== "Administrador" && req.user.rol !== "Dios") {
      return res.status(403).json({ message: "No tienes permisos para realizar esta acción." });
    }

    const { id } = req.params;

    // Verificar si el ID es válido
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "ID de usuario no válido." });
    }

    const usuario = await User.findById(id);
    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    // Activar el usuario
    usuario.activo = true;
    await usuario.save();

    res.status(200).json({ message: "✅ Usuario activado exitosamente." });
  } catch (error) {
    console.error("❌ Error al activar usuario:", error);
    res.status(500).json({ message: "Error al activar usuario." });
  }
});

// 📌 Actualizar usuario (con verificación de contraseña)
router.put("/usuarios/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { contraseña, rol } = req.body;

    console.log("🔹 Petición recibida para cambiar rol:", { id, rol, contraseña });

    if (!contraseña) {
      return res.status(400).json({ message: "La contraseña es requerida." });
    }

    const usuarioAutenticado = await User.findById(req.user.id);
    if (!usuarioAutenticado) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const esValida = await bcrypt.compare(contraseña, usuarioAutenticado.password);
    if (!esValida) {
      return res.status(401).json({ message: "Contraseña incorrecta." });
    }

    const usuarioAActualizar = await User.findById(id);
    if (!usuarioAActualizar) {
      return res.status(404).json({ message: "Usuario a actualizar no encontrado." });
    }

    // 🔥 Verificar que el rol no sea vacío o nulo
    if (!rol || (rol !== "Administrador" && rol !== "Revisor")) {
      return res.status(400).json({ message: "Rol no válido." });
    }

    // 📌 Evitar que un Administrador cambie el rol de otro Administrador
    if (usuarioAutenticado.rol === "Administrador" && usuarioAActualizar.rol === "Administrador") {
      return res.status(403).json({ message: "No puedes cambiar el rol de otro Administrador." });
    }

    // 📌 Evitar que un usuario pueda darse permisos de Dios
    if (rol === "Dios") {
      return res.status(403).json({ message: "No puedes asignar el rol de Dios." });
    }

    console.log("🔹 Antes de actualizar, usuario tenía rol:", usuarioAActualizar.rol);

    // 📌 CORRECCIÓN: Usamos `findOneAndUpdate` en vez de `save()`
    const usuarioActualizado = await User.findOneAndUpdate(
      { _id: id },
      { $set: { rol } },
      { new: true } // 🔥 Esto devuelve el usuario actualizado
    );

    console.log("✅ Después de actualizar, usuario ahora tiene rol:", usuarioActualizado.rol);

    res.status(200).json({ message: "Rol actualizado correctamente.", usuario: usuarioActualizado });
  } catch (error) {
    console.error("❌ Error al actualizar usuario:", error);
    res.status(500).json({ message: "Error al actualizar usuario." });
  }
});

// 📌 Eliminar usuario (con verificación de contraseña)
router.delete("/usuarios/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { contraseña } = req.body;

    if (!contraseña) {
      return res.status(400).json({ message: "La contraseña es requerida." });
    }

    const usuario = await User.findById(req.user.id);
    if (!usuario) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const esValida = await bcrypt.compare(contraseña, usuario.password);
    if (!esValida) {
      return res.status(401).json({ message: "Contraseña incorrecta." });
    }

    await User.findByIdAndDelete(id);
    res.status(200).json({ message: "Usuario eliminado correctamente." });
  } catch (error) {
    console.error("❌ Error al eliminar usuario:", error);
    res.status(500).json({ message: "Error al eliminar usuario." });
  }
});

module.exports = router;