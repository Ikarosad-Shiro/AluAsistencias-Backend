const express = require('express');
const router = express.Router();

router.get('/ping', (req, res) => {
  console.log('📨 Bien y tu amorcito de mi vida?💘');
  res.status(200).send('pong');
});

module.exports = router;
