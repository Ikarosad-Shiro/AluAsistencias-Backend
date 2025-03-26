const mongoose = require('mongoose');

const sedeSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true
  },
  nombre: {
    type: String,
    required: true
  }
});

module.exports = mongoose.model('Sede', sedeSchema);
