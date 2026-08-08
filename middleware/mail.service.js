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
    subject: 'Verify your email 加油!',
    html: `
      <div style="margin:0;padding:24px 12px;background:#f4f6fb;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(20,40,90,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#0d6efd,#1EBCEE);padding:34px 32px;text-align:center;">
              <div style="font-size:40px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">加油!</div>
              <div style="font-size:14px;color:rgba(255,255,255,0.9);margin-top:4px;">Learn Chinese, the fun way</div>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 32px 8px;">
              <h1 style="margin:0 0 12px;font-size:22px;color:#1a1a2e;font-weight:800;">Welcome aboard! 🎉</h1>
              <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#4a5568;">
                You're one tap away from collecting words, crushing quizzes and duelling your friends.
              </p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4a5568;">
                Just confirm it's really you:
              </p>
              <div style="text-align:center;margin:8px 0 28px;">
                <a href="${verifyLink}" style="display:inline-block;background:#0d6efd;color:#ffffff;padding:15px 40px;text-decoration:none;border-radius:999px;font-weight:700;font-size:16px;box-shadow:0 8px 20px rgba(13,110,253,0.35);">Verify my email</a>
              </div>
              <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#8a94a6;">
                Button not working? Copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 20px;font-size:12px;line-height:1.5;word-break:break-all;">
                <a href="${verifyLink}" style="color:#0d6efd;">${verifyLink}</a>
              </p>
              <p style="margin:0 0 4px;font-size:13px;color:#8a94a6;">This link expires in 24 hours ⏳</p>
              <p style="margin:0;font-size:13px;color:#8a94a6;">Didn't create a Jiayou account? You can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 32px 30px;border-top:1px solid #eef1f6;text-align:center;">
              <p style="margin:0;font-size:12px;color:#adb5c4;">加油! · <a href="https://jiayou.fr" style="color:#adb5c4;">jiayou.fr</a> · See you inside 👋</p>
            </td>
          </tr>
        </table>
      </div>
    `
  });
}

// Relance des utilisateurs inactifs ("long time no see").
async function sendReengagementEmail(email, name) {
  const appUrl = process.env.APP_URL || 'https://app.jiayou.fr';
  const hi = name ? name.split(' ')[0] : 'there';
  return sendEmail({
    to: email,
    subject: 'JiaWorld needs you 加油!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; text-align: center;">
        <div style="font-size: 44px; font-weight: 800; color: #0d6efd;">加油!</div>
        <h2 style="color: #1a1a2e;">Long time no see, ${hi}!</h2>
        <p style="color: #555; font-size: 15px; line-height: 1.5;">
          Your words miss you. Jump back in for a quick quiz, challenge a friend to a duel,
          and keep your streak alive.
        </p>
        <div style="margin: 28px 0;">
          <a href="${appUrl}" style="background-color:#0d6efd;color:white;padding:14px 30px;text-decoration:none;border-radius:10px;font-weight:700;">Come back to Jiayou</a>
        </div>
        <p style="color: #999; font-size: 12px;">See you soon on JiaWorld.</p>
      </div>
    `
  });
}

module.exports = {
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendReengagementEmail,
  resend // si nécessaire ailleurs
};