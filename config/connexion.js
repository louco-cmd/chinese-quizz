const passport = require("passport");
const { OAuth2Client } = require('google-auth-library'); // ⬅️ AJOUT IMPORT MANQUANT
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { pool } = require('./database');

// -------------------- Serialize / Deserialize DEBUG --------------------
passport.serializeUser((user, done) => {
  console.log('🔒 Sérialisation:', user.id);
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    console.log('🔓 Désérialisation:', id);
    const res = await pool.query(
      "SELECT id, email, name FROM users WHERE id = $1", 
      [id]
    );
    
    if (res.rows.length === 0) {
      console.log('❌ Utilisateur non trouvé');
      return done(null, false);
    }
    
    const user = res.rows[0];
    console.log('✅ Utilisateur chargé:', user.email);
    done(null, user);
    
  } catch (err) {
    console.error('❌ Erreur désérialisation:', err);
    done(err, null);
  }
});

// -------------------- Passport Google --------------------
const Client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 🔥 CONFIGURATION AMÉLIORÉE DE PASSPORT
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    passReqToCallback: true, // ← IMPORTANT pour accéder à req
    scope: ['profile', 'email'],
    state: true, // Sécurité contre les attaques CSRF
  },
  async function(req, accessToken, refreshToken, profile, done) {
    const transaction = await pool.connect();
    try {
      console.log("PROFILE GOOGLE :", profile); // 👈 ajoute ça !
      const { id, displayName, emails, photos } = profile;
      const email = emails[0].value;

      await transaction.query('BEGIN');

      // ✅ CORRIGER : Déclarer userRes avec 'let'
      let userRes = await transaction.query(
        `SELECT id, email, name, provider_id FROM users 
         WHERE provider_id = $1 OR email = $2 
         ORDER BY CASE WHEN provider_id = $1 THEN 1 ELSE 2 END 
         LIMIT 1`,
        [id, email]
      );

      let isNewUser = false;
      let user;

      if (userRes.rows.length === 0) {
        // 🆕 NOUVEL UTILISATEUR
        console.log('👤 Création nouveau utilisateur:', email);
        const newUser = await transaction.query(
          `INSERT INTO users (email, name, provider, provider_id, last_login) 
           VALUES ($1, $2, 'google', $3, NOW())  -- ✅ Commentaire correct
           RETURNING id, email, name`,
          [email, displayName, id]
        );
        user = newUser.rows[0];
        isNewUser = true;
      } else {
        // 🔄 UTILISATEUR EXISTANT
        user = userRes.rows[0];
        
        if (user.provider_id !== id) {
          console.log('🔗 Liaison compte existant avec Google');
          await transaction.query(
            'UPDATE users SET provider_id = $1, provider = $2, last_login = NOW() WHERE id = $3',
            [id, 'google', user.id]
          );
        } else {
          await transaction.query(
            'UPDATE users SET last_login = NOW() WHERE id = $1',
            [user.id]
          );
        }
      }

      await transaction.query('COMMIT');
      
      console.log('✅ Authentification réussie pour:', user.email);
      done(null, { 
        id: user.id,
        email: user.email, 
        name: user.name,
        isNewUser: isNewUser
      });

    } catch (err) {
      await transaction.query('ROLLBACK');
      console.error('❌ Erreur Passport Google:', err);
      
      // Erreur plus spécifique
      const errorMessage = err.code === '23505' ? 
        'Un compte avec cet email existe déjà' : 
        'Erreur de base de données';
      
      done(new Error(errorMessage), null);
    } finally {
      transaction.release();
    }
  }
));
console.log("GOOGLE_CALLBACK_URL =", process.env.GOOGLE_CALLBACK_URL);


// === FONCTION POUR CONFIGURER LES ROUTES ===
function setupAuthRoutes(app) {
  // Initialisation Passport
  console.log('🔥 setupAuthRoutes appelé - Initialisation Passport');
  app.use(passport.initialize());
  app.use(passport.session());
}

// Exporter passport ET la fonction de setup
module.exports = {
  passport,
  setupAuthRoutes
};