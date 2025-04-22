// ✅ emailService.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const enviarCorreoVerificacion = async (email, token) => {
  try {
    const enlaceVerificacion = `${process.env.BASE_URL}/api/auth/verify/${token}`;

    await transporter.sendMail({
      from: `"Alu Asistencias" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verifica tu cuenta",
      html: `
        <h2>¡Bienvenido a Alu Asistencias!</h2>
        <p>Gracias por registrarte. Para activar tu cuenta, haz clic en el siguiente enlace:</p>
        <a href="${enlaceVerificacion}" style="background-color:#4CAF50; color: white; padding: 10px 20px; text-decoration: none; font-size: 16px;">Verificar cuenta</a>
        <p>Si no solicitaste este registro, puedes ignorar este correo.</p>
      `,
    });

    console.log(`✅ Correo de verificacion enviado a ${email}`);
  } catch (error) {
    console.error("❌ Error al enviar el correo:", error);
  }
};

const enviarCodigoVerificacion = async (email, codigo) => {
  try {
    await transporter.sendMail({
      from: `"Alu Asistencias" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Código de Verificación para Eliminar Sede",
      html: `
        <h2>¡Confirmación Crítica!</h2>
        <p>Tu código de verificación es:</p>
        <h1 style="color:#6a1d97;">${codigo}</h1>
        <p>Este código es único y tiene un tiempo de expiración corto.</p>
      `,
    });

    console.log(`✅ Código de verificación enviado a ${email}`);
  } catch (error) {
    console.error("❌ Error al enviar el código de verificación:", error);
  }
};

module.exports = {
  enviarCorreoVerificacion,
  enviarCodigoVerificacion
};