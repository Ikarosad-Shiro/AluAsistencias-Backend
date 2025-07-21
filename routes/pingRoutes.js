const express = require('express');
const router = express.Router();

router.get('/ping', (req, res) => {
  console.log('📨 Bien y tu amorcito de mi vida?💘');
   res.status(200).json({ mensaje: '🏓 Pong! Backend activo' });
});

module.exports = router;
