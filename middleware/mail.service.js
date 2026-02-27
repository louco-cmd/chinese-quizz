// utils/email.js
const nodemailer = require('nodemailer');

// Configuration du transporteur
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
  connectionTimeout: 15000, // 15 secondes
  greetingTimeout: 15000,
  socketTimeout: 20000,
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ Erreur de configuration SMTP :', error);
  } else {
    console.log('✅ Serveur SMTP prêt');
  }
});

// Fonction d'envoi d'email générique
async function sendEmail({ to, subject, html, text }) {
  try {
    const info = await transporter.sendMail({
      from: `"Chinese Quiz" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ''),
    });

    console.log(`📧 Email envoyé à ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error('💥 Erreur envoi email:', error);

    // En mode développement, log le contenu sans échouer
    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV MODE] Email content:');
      console.log('To:', to);
      console.log('Subject:', subject);
      console.log('HTML:', html);
      return { messageId: 'dev-mode' };
    }

    throw error;
  }
}

// Fonction pour l'envoi d'email de réinitialisation
async function sendPasswordResetEmail(email, token) {
  const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/auth/reset-password?token=${token}`;

  return await sendEmail({
    to: email,
    subject: 'Réinitialisation de votre mot de passe - Chinese Quiz',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Réinitialisation du mot de passe</h2>
        <p>Bonjour,</p>
        <p>Vous avez demandé à réinitialiser votre mot de passe pour votre compte Chinese Quiz.</p>
        <p>Cliquez sur le bouton ci-dessous pour créer un nouveau mot de passe :</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" 
             style="background-color: #4CAF50; 
                    color: white; 
                    padding: 12px 24px; 
                    text-decoration: none; 
                    border-radius: 5px; 
                    font-weight: bold;
                    display: inline-block;">
            Réinitialiser mon mot de passe
          </a>
        </div>
        <p>Ou copiez-collez ce lien dans votre navigateur :</p>
        <p style="background-color: #f5f5f5; padding: 10px; border-radius: 4px; word-break: break-all;">
          ${resetLink}
        </p>
        <p><strong>Ce lien expirera dans 1 heure.</strong></p>
        <p>Si vous n'avez pas demandé cette réinitialisation, ignorez simplement cet email.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">
          Cet email a été envoyé automatiquement. Merci de ne pas y répondre.
        </p>
      </div>
    `
  });
}

// Fonction pour l'envoi d'email de vérification (version anglaise)
async function sendVerificationEmail(email, token) {
  const verifyLink = `https://app.jiayou.fr/auth/verify-email?token=${token}`;

  return await sendEmail({
    to: email,
    subject: 'Verify your email - Jiayou',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Jiayou!</h2>
        <p>Thank you for signing up. Please verify your email address by clicking the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyLink}" 
             style="background-color: #007bff; 
                    color: white; 
                    padding: 12px 24px; 
                    text-decoration: none; 
                    border-radius: 5px; 
                    font-weight: bold;
                    display: inline-block;">
            Verify my email
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="background-color: #f5f5f5; padding: 10px; border-radius: 4px; word-break: break-all;">
          ${verifyLink}
        </p>
        <p><strong>This link will expire in 24 hours.</strong></p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">
          If you didn't sign up for this account, please ignore this email.
        </p>
      </div>
    `
  });
}

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
};