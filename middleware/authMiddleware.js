// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    // lee el header de forma tolerante
    const h = req.headers.authorization || req.header('Authorization') || '';
    if (!h) {
      return res.status(401).json({ message: 'Falta Authorization Bearer' });
    }

    // Soporta: "Bearer xxx", "bearer xxx", o incluso "xxx" directo
    const parts = h.split(' ');
    let raw = parts.length === 2 ? parts[1] : parts[0];

    // limpia comillas y espacios
    raw = (raw || '').replace(/^"|"$/g, '').trim();
    if (!raw || raw.toLowerCase() === 'null' || raw.toLowerCase() === 'undefined') {
      return res.status(401).json({ message: 'Token vacío o inválido.' });
    }

    // verifica
    const payload = jwt.verify(raw, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Token inválido.' });
  }
};
