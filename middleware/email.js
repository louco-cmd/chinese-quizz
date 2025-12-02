// utils/email.js
const nodemailer = require('nodemailer');

// Configuration du transporteur
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true', // true pour 465, false pour autres ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Vérifier la connexion
transporter.verify(function(error, success) {
  if (error) {
    console.error('❌ Erreur configuration email:', error);
  } else {
    console.log('✅ Serveur SMTP prêt');
  }
});

// Fonction d'envoi d'email
async function sendEmail({ to, subject, html, text }) {
  try {
    const mailOptions = {
      from: `"Chinese Quizz" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, '') // Texte brut si non fourni
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('📧 Email envoyé:', info.messageId);
    return info;
    
  } catch (error) {
    console.error('❌ Erreur envoi email:', error);
    throw error;
  }
}

// Version simplifiée pour les tests (sans SMTP)
async function sendEmailMock({ to, subject, html }) {
  console.log('📧 [MOCK] Email envoyé à:', to);
  console.log('📧 [MOCK] Sujet:', subject);
  console.log('📧 [MOCK] HTML:', html.substring(0, 200) + '...');
  
  // Pour développement, tu peux loguer le lien magique
  const magicLinkMatch = html.match(/href="([^"]+)"/);
  if (magicLinkMatch) {
    console.log('🔗 [MOCK] Lien magique:', magicLinkMatch[1]);
  }
  
  return { messageId: 'mock-' + Date.now() };
}

// Utiliser le mock si pas de config SMTP
const emailSender = process.env.NODE_ENV === 'test' || !process.env.SMTP_USER 
  ? sendEmailMock 
  : sendEmail;

module.exports = { sendEmail: emailSender };