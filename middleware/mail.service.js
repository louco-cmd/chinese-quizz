// utils/email.js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Fonction d'envoi générique avec Resend
async function sendEmail({ to, subject, html }) {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL, // ex: contact@jiayou.fr
      to: to,
      subject: subject,
      html: html,
    });

    if (error) {
      console.error('💥 Erreur Resend:', error);
      throw error;
    }

    console.log(`📧 Email envoyé à ${to}: ${data.id}`);
    return data;
  } catch (error) {
    console.error('💥 Erreur envoi email:', error);
    // En développement, on peut logger sans échouer
    if (process.env.NODE_ENV === 'development') {
      console.log('📧 [DEV MODE] Email content:', { to, subject, html });
      return { id: 'dev-mode' };
    }
    throw error;
  }
}

// Email de réinitialisation (adaptez le contenu à votre marque)
async function sendPasswordResetEmail(email, token) {
  const resetLink = `${process.env.APP_URL || 'https://app.jiayou.fr'}/auth/reset-password?token=${token}`;
  return sendEmail({
    to: email,
    subject: 'Réinitialisation de votre mot de passe - Jiayou',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Réinitialisation du mot de passe</h2>
        <p>Bonjour,</p>
        <p>Vous avez demandé à réinitialiser votre mot de passe.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background-color:#4CAF50;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;">Réinitialiser</a>
        </div>
        <p>Ce lien expirera dans 1 heure.</p>
        <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
      </div>
    `
  });
}

// Email de vérification (version anglaise, adaptez)
async function sendVerificationEmail(email, token) {
  const verifyLink = `https://app.jiayou.fr/auth/verify-email?token=${token}`;
  return sendEmail({
    to: email,
    subject: 'Verify your email - Jiayou',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Welcome to Jiayou!</h2>
        <p>Please verify your email by clicking the button below:</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verifyLink}" style="background-color:#007bff;color:white;padding:12px 24px;text-decoration:none;border-radius:5px;">Verify</a>
        </div>
        <p>This link expires in 24 hours.</p>
      </div>
    `
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail,
  resend // si nécessaire ailleurs
};