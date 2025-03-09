const bcrypt = require('bcryptjs');

const password = "Griss2007"; // Cambia esta por la contraseña que quieras
const saltRounds = 10;

bcrypt.hash(password, saltRounds, (err, hash) => {
    if (err) throw err;
    console.log("Contraseña cifrada:", hash);
});
