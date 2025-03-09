const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
  const token = req.header("Authorization");

  if (!token) return res.status(401).json({ message: "Acceso denegado. Token no proporcionado." });

  try {
    const decoded = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
    req.user = decoded; // Agregamos el usuario decodificado a la request
    next();
  } catch (error) {
    res.status(400).json({ message: "Token inválido." });
  }
};
