const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail", // Cambia esto si usas otro proveedor
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

    console.log(`✅ Correo de verificación enviado a ${email}`);
  } catch (error) {
    console.error("❌ Error al enviar el correo:", error);
  }
};

module.exports = { enviarCorreoVerificacion };
