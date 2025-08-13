const express = require('express');
const session = require('express-session');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 4000;

// Pour le __dirname dans ESM
const __dirname = path.resolve();

// Répertoire des rapports générés
const REPORTS_DIR = path.join(__dirname, 'reports');

// CORS : autoriser frontend local (avec cookies)
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

// Middlewares Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions : stockage mémoire (dev)
app.use(session({
  secret: 'une-cle-secrete-pour-signer',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Route de test de session
app.get('/me', (req, res) => {
  console.log('Session actuelle:', req.session);
  res.json({ user: req.session.user || null });
});

// Login factice
app.post('/login', (req, res) => {
  const { email } = req.body;
  req.session.user = { email };
  console.log('✅ Utilisateur connecté :', email);
  res.json({ success: true });
});

// Route de génération de rapport
app.post('/generate-report', async (req, res) => {
  console.log('🎯 Route atteinte');
  console.log('Session reçue:', req.session);

  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non autorisé (pas connecté)' });
  }

  try {
    const { emails, stats, userEmail } = req.body;

    const token = crypto.randomBytes(16).toString('hex');
    const htmlPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);

    const htmlContent = \`
      <html>
        <head><meta charset="utf-8" /></head>
        <body>
          <div class="container">Rapport pour \${userEmail}</div>
        </body>
      </html>
    \`;

    await fs.promises.mkdir(REPORTS_DIR, { recursive: true });
    await fs.promises.writeFile(htmlPath, htmlContent, 'utf8');

    res.json({ success: true, token });
  } catch (error) {
    console.error('Erreur génération:', error);
    res.status(500).json({ error: 'Erreur génération rapport' });
  }
});

// Route d’affichage du rapport
app.get('/show-report/:token', async (req, res) => {
  const token = req.params.token;
  const htmlPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send('Fichier non trouvé');
  }
  res.sendFile(htmlPath);
});

app.listen(PORT, () => {
  console.log(`✅ Serveur backend démarré sur http://localhost:${PORT}`);
});