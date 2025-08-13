import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import { google } from 'googleapis';
import puppeteer from 'puppeteer';
import crypto from 'crypto';
import dotenv from 'dotenv';

// ========= GESTION DOSSIER RAPPORTS HTML UNIQUES =========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// Fonction utilitaire pour générer un token unique et signer un lien :
function generateToken(email) {
  const raw = `${email}-${Date.now()}-${crypto.randomUUID()}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';
// import { requireAuth } from './middlewares.js';

const app = express(); // ✅ doit apparaître avant tout .use()

app.use(cookieParser());

const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error(`CORS not allowed for origin: ${origin}`));
    }
  },
  credentials: true
}));

// ------ Ajout session juste après CORS et avant les routes ------
app.set('trust proxy', 1);

// ✅ Sessions persistantes via session-file-store
import createFileStore from 'session-file-store';
const FileStore = createFileStore(session);

app.use(session({
  name: 'sid', // nom de cookie stable
  store: new FileStore({
    path: path.resolve(__dirname, '.sessions'),
    retries: 1,
    fileExtension: '.json',
    ttl: 60 * 60 * 6 // 6h de TTL côté store
  }),
  secret: process.env.SESSION_SECRET || 'une-cle-secrete-a-changer',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,        // true uniquement derrière HTTPS
    httpOnly: true,
    sameSite: 'lax',      // compatible proxy Vite en dev
    maxAge: 1000 * 60 * 60 * 6 // 6h côté cookie
  }
}));

// (optionnel) petit log pour déboguer la session
app.use((req, _res, next) => {
  if (!req.session) return next();
  req.session.lastSeenAt = Date.now(); // "touch" pour éviter la purge agressive
  next();
});

// Debug rapide : inspecter la session côté serveur
app.get('/whoami', (req, res) => {
  res.json({
    user: req.session?.user || null,
    email: req.session?.email || null,
    hasTokens: !!(req.session && req.session.tokens),
    tokenSummary: req.session?.tokens
      ? { keys: Object.keys(req.session.tokens), expiry_date: req.session.tokens.expiry_date }
      : null
  });
});

const userReports = new Map(); // Map<email, report>
const userJobs = new Map(); // email -> jobs
const reportsMap = new Map(); // Clé = reportId, valeur = { html, stats }



// Choisir .env ou .env.production ou .env.test selon l'environnement
let envFile = '.env';
if (process.env.NODE_ENV === 'production') {
  envFile = '.env.production';
} else if (process.env.NODE_ENV === 'test') {
  envFile = '.env.test';
}
dotenv.config({ path: path.resolve(__dirname, envFile) });
const metroCssPath = path.join(__dirname, 'static-assets/metro.css');

const metroCss = fs.readFileSync(metroCssPath, 'utf-8');

// Helper: get email from session (user.email or email)
function getSessionEmail(req) {
  return (req && req.session && (req.session.user?.email || req.session.email)) || null;
}


function requireAuth(req, res, next) {
  console.log('🔍 Headers:', req.headers);
  console.log('🔍 Cookies:', req.headers.cookie);
  console.log('🔍 Session:', req.session);
  const email = getSessionEmail(req);
  if (!email) {
    console.log('❌ Utilisateur non connecté');
    return res.status(401).json({ error: 'Non autorisé (pas connecté)' });
  }
  // Normalize: ensure req.session.user is set if only req.session.email exists
  if (!req.session.user) {
    req.session.user = { email };
  }
  next();
}

// Appliquer à toutes les routes sensibles (sauf /report-pdf pour permettre l'accès token)
app.use('/generate-report', requireAuth);
app.use('/last-report', requireAuth);
// NOTE: ne PAS protéger /report-pdf ici, on protège la version session dans le handler existant
app.use('/send-report', requireAuth);
app.use('/get-report-progress', requireAuth);

// ====== GÉNÉRATION HTML DU RAPPORT (Metro UI) ======
/**
 * args = { date, userEmail, emails, generatedAt }
 * emails = [{ id, subject, labelIds, dateStr, category, priority, hour }]
 */
// labels: { CATEGORY_PERSONAL, CATEGORY_PROMOTIONS, CATEGORY_UPDATES, CATEGORY_SOCIAL, CATEGORY_FORUMS }
const CATEGORY_MAP = {
  CATEGORY_PERSONAL: "Principale",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Notifications",
  CATEGORY_SOCIAL: "Réseaux sociaux",
  CATEGORY_FORUMS: "Forums"
};

function generateReportHtml({ date, userEmail, emails, generatedAt, options = {}, stats = {}, lastReport = undefined }) {
  // Regroupement par label principal Gmail (catégorie)
  const categorized = {};
  for (const cat of Object.keys(CATEGORY_MAP)) categorized[cat] = [];
  for (const mail of emails) {
    const found = mail.labelIds?.find(l => CATEGORY_MAP[l]);
    if (found) categorized[found].push(mail);
    // Si aucun label standard, tu peux mettre dans 'CATEGORY_PERSONAL' ou ignorer
  }

  // Format heure (depuis dateStr ISO ou timestamp, selon structure)
  function getHour(mail) {
    if (mail.dateStr && mail.dateStr.length > 10) {
      const d = new Date(mail.dateStr);
      // Heure : 2 chiffres, Minutes : 2 chiffres, Jour et mois
      const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const jour = String(d.getDate()).padStart(2, '0');
      const mois = String(d.getMonth() + 1).padStart(2, '0');
      return `${heure} (${jour}/${mois})`;
    }
    return '';
  }

  // Bandeau résumé :
  let optionsLabel = [
    options.onlyUnread ? "Seulement non lus" : "Tous les mails",
    options.groupByLabel ? "Groupé par catégorie" : "Non groupé"
  ].join(" – ");

  // Statistiques par label :
  const labelsStatsHtml = Object.entries(stats.perLabel || {}).map(([label, val]) =>
    `<span style="background:#e3f2fd;color:#1565c0;padding:2px 10px;border-radius:8px;margin-right:8px;font-size:0.96em;">
      ${label}: <b>${val.total}</b>
      <span style="font-size:0.91em;color:#27ae60;">(${val.read}</span>/<span style="color:#c0392b;">${val.unread}</span>)
    </span>`
  ).join('');
  const responsiveStyles = `
    <style>
      @media (max-width: 768px) {
        .gmail-report-stats {
          flex-direction: column;
        }
        .gmail-report-summary {
          padding: 18px 16px;
        }
        .gmail-report-table table th,
        .gmail-report-table table td {
          font-size: 0.92em;
        }
        .gmail-report-table table th:nth-child(3),
        .gmail-report-table table td:nth-child(3) {
          display: none;
        }
      }
      .page-break {
        page-break-before: always;
        break-before: page;
      }
    </style>
  `;
    // Styles globaux dans le <head>
const headStyles = `
  <style>
    html, body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
    .page-break { page-break-before: always; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px; }
    th { background-color: #351d7eff;color: #fff; font-weight: bold; }

    .container {
      background: white;
      padding: 40px 48px;
      border-radius: 12px;
      box-shadow: 0 4px 24px #0002;
      margin: 32px auto;
      max-width: 1200px;
      box-sizing: border-box;
    }

    /* ✅ Ensure the report table never exceeds the container width */
    .gmail-report-table { 
      max-width: 100% !important; 
      width: 100% !important; 
      overflow-x: auto; 
    }
    .gmail-report-table table {
      width: 100% !important;
      table-layout: fixed;
      box-sizing: border-box;
    }
    .gmail-report-table th, 
    .gmail-report-table td {
      word-break: break-word;
      overflow-wrap: anywhere;
    }
  </style>
`;

  let pdfButtonHtml = '';

  // Contenu principal du rapport à encapsuler dans .container
  const mainReportHtml = `
    <div style="background:#fff;padding:0 0 24px 0;">
      <div  class="gmail-report-sticky-header"
        style=" position:sticky; top:0; z-index:2; 
                background:#fff; 
                box-shadow:0 4px 16px #0001; 
                padding-top:0;
                padding-bottom:18px;
        ">
        <div style="font-size:1.15em;margin-bottom:12px;">
          <b>Résumé Gmail</b> — ${date} <span style="color:#157fe3;">${userEmail}</span>
        </div>
        <div class="gmail-report-summary" style="background:#ecf0f1;border-radius:10px;margin-bottom:24px;padding:24px 24px 18px 24px;">
          <div style="font-size:2em;font-weight:700;color:#1976d2;margin-bottom:10px;text-align:center;">
            📊 Résumé du rapport
          </div>
          <div style="font-size:1.13em;font-weight:600;margin-bottom:10px;color:#2c3e50;">
            Options actives :
          </div>
          <div style="margin-bottom:16px;font-size:1.04em;">
            ${optionsLabel}
          </div>
          <div style="font-size:1.13em;font-weight:600;margin-bottom:10px;color:#2c3e50;">
            Statistiques par catégorie :
          </div>
          <div class="gmail-report-stats" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:2px;">
            ${Object.entries(stats.perLabel || {}).map(([label, val]) => `
              <div style="
                background:#fff;
                border-radius:8px;
                box-shadow:0 1px 8px #1976d208;
                padding:8px 12px 5px 12px;
                min-width:110px;
                text-align:center;
                font-size:0.98em;
                line-height:1.27;
                margin-bottom:2px;">
                <div style="font-size:1.04em;font-weight:600;color:#1976d2;margin-bottom:3px;">${label}</div>
                <div style="font-size:0.98em;color:#444;margin-bottom:1px;">
                  <b>${val.total}</b> mails
                </div>
                <div style="font-size:0.91em;color:#888;">
                  <span style="color:#c0392b;">non lus&nbsp;<b>${val.unread}</b></span> |
                  <span style="color:#27ae60;">lus&nbsp;<b>${val.read}</b></span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="gmail-report-table" style="/* max-width:900px;*/">
        ${Object.entries(CATEGORY_MAP).map(([cat, label]) => categorized[cat].length ? `
          <div class="page-break" style="page-break-before: always;">
            <div style="margin:28px 0 12px 0; font-size:17px;font-weight:bold;color:#1976d2;">
              <span style="background:#dffdfd;padding:4px 14px;border-radius:0px;display:block;">
                ${label} (${categorized[cat].length})
              </span>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:1em;">
              <thead>
                <tr>
                  <th style="width:120px;">Heure (JJ/MM)</th>
                  <th>Sujet</th>
                  <th style="width:60px;">Lu ?</th>
                </tr>
              </thead>
              <tbody>
                ${categorized[cat].map(mail => `
                  <!-- <tr style="${mail.isUnread ? 'background:#fffbe6;' : ''}"> -->
                  <tr style="">
                    <td>${getHour(mail)}</td>
                    <td>
                      <a href="https://mail.google.com/mail/u/0/#inbox/${mail.id}" target="_blank" style="color:#1a73e8;text-decoration:underline;">
                        ${mail.subject || '(Sans sujet)'}
                      </a>
                      ${mail.from ? `<div style="font-size:0.92em;color:#888;">${mail.from}</div>` : ''}
                    </td>
                    <td style="text-align:center;">
                      ${mail.isUnread
                        ? `<span title="Non lu" style="color:#c0392b;font-size:1.17em;">●</span>`
                        : `<span title="Lu" style="color:#27ae60;font-size:1.1em;">●</span>`}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : '').join('')}
        ${pdfButtonHtml}
        <div style="color:#888;font-size:0.98em;">
          Rapport généré le ${generatedAt} avec <b>Gmail Résumé</b>
        </div>
      </div>
    </div>
  `;

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        ${headStyles}
        <title>Rapport Gmail</title>
        ${responsiveStyles}
        <style>${metroCss}</style>
      </head>
      <body>
        <div class="container">
          ${mainReportHtml}
        </div>
      </body>
    </html>
  `;
}


function generatePdfHtml({ date, userEmail, emails, stats, onlyUnread }) {
  const CATEGORY_MAP = {
    CATEGORY_PERSONAL: "Principale",
    CATEGORY_PROMOTIONS: "Promotions",
    CATEGORY_UPDATES: "Notifications",
    CATEGORY_SOCIAL: "Réseaux sociaux",
    CATEGORY_FORUMS: "Forums"
  };

  // Regroupe les mails par catégorie
  const categorized = {};
  for (const cat of Object.keys(CATEGORY_MAP)) categorized[cat] = [];
  for (const mail of emails) {
    if (onlyUnread && !mail.isUnread) continue;
    const found = mail.labelIds?.find(l => CATEGORY_MAP[l]);
    if (found) categorized[found].push(mail);
  }
  // Fallback per-label stats if not provided in `stats.perLabel`
  const perLabelStats = {};
  for (const [cat, label] of Object.entries(CATEGORY_MAP)) {
    const arr = categorized[cat] || [];
    perLabelStats[label] = {
      total: arr.length,
      read: arr.filter(m => !m.isUnread).length,
      unread: arr.filter(m => m.isUnread).length
    };
  }
  const perLabel = (stats && stats.perLabel) ? stats.perLabel : perLabelStats;

  return `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Rapport Gmail PDF</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          padding: 30px;
          font-size: 12pt;
          color: #333;
        }

        h1 {
          text-align: center;
          color: #2e7d32;
        }

        /* --- Summary banner styles (mirror of frontend Metro-like look) --- */
        .summary {
          background: #ecf0f1;
          border-radius: 10px;
          margin: 20px 0 24px 0;
          padding: 24px 24px 18px 24px;
        }
        .summary-title {
          font-size: 2em;
          font-weight: 700;
          color: #1976d2;
          margin-bottom: 10px;
          text-align: center;
        }
        .summary-subtitle {
          font-size: 1.13em;
          font-weight: 600;
          margin-bottom: 10px;
          color: #2c3e50;
        }
        .summary-options {
          margin-bottom: 16px;
          font-size: 1.04em;
        }
        .summary-cards {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 2px;
        }
        .stat-card {
          background: #fff;
          border-radius: 8px;
          box-shadow: 0 1px 8px #1976d208;
          padding: 8px 12px 5px 12px;
          min-width: 110px;
          text-align: center;
          font-size: 0.98em;
          line-height: 1.27;
          margin-bottom: 2px;
        }
        .stat-label {
          font-size: 1.04em;
          font-weight: 600;
          color: #1976d2;
          margin-bottom: 3px;
        }
        .stat-total {
          font-size: 0.98em;
          color: #444;
          margin-bottom: 1px;
        }
        .stat-breakdown {
          font-size: 0.91em;
          color: #888;
        }
        .stat-breakdown .unread { color: #c0392b; }
        .stat-breakdown .read { color: #27ae60; }

        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          page-break-inside: auto;
        }

        th, td {
          border: 1px solid #ccc;
          padding: 8px;
          font-size: 0.94em;
        }

        th {
          background: #34495e !important;
          color: #fff !important;
          text-align: left;
        }

        .category-title {
          margin: 28px 0 12px 0;
          font-size: 17px;
          font-weight: bold;
          color: #1976d2;
        }
        .category-chip {
          background: #dffdfd;
          padding: 4px 14px;
          border-radius: 0px;
          display: block;
        }

        .category-block {
          /* allow the table to flow onto next page if needed to avoid large gaps */
          page-break-inside: auto;
          margin-bottom: 24px;
        }

        thead { display: table-header-group; }
        tr, td, th { page-break-inside: avoid; }
        @media print {
          thead { display: table-header-group; }
        }
        /* try to keep the label with the first table rows without forcing an entire block to the next page */
        .category-title { break-after: avoid; orphans: 3; widows: 3; }

        /* .page-break { page-break-before: always; } */

        .footer {
          margin-top: 40px;
          font-size: 0.85em;
          color: #777;
        }
      </style>
    </head>
    <body>
      <h1>📬 Rapport Gmail du ${date}${onlyUnread ? " (non lus uniquement)" : ""}</h1>
      <p><strong>Compte :</strong> ${userEmail}</p>

      <div class="summary">
        <div class="summary-title">📊 Résumé du rapport</div>
        <div class="summary-subtitle">Options actives :</div>
        <div class="summary-options">${onlyUnread ? "Seulement non lus" : "Tous les mails"} – Groupé par catégorie</div>

        <div class="summary-subtitle">Statistiques globales :</div>
        <div style="margin-bottom:12px;">
          <span style="background:#e3f2fd;color:#1565c0;padding:4px 10px;border-radius:8px;margin-right:8px;font-size:0.96em;display:inline-block;">
            Total&nbsp;: <b>${stats.total}</b>
          </span>
          <span style="background:#e8f5e9;color:#2e7d32;padding:4px 10px;border-radius:8px;margin-right:8px;font-size:0.96em;display:inline-block;">
            Lus&nbsp;: <b>${stats.read}</b>
          </span>
          <span style="background:#ffebee;color:#c62828;padding:4px 10px;border-radius:8px;font-size:0.96em;display:inline-block;">
            Non lus&nbsp;: <b>${stats.unread}</b>
          </span>
        </div>

        <div class="summary-subtitle">Statistiques par catégorie :</div>
        <div class="summary-cards">
          ${Object.entries(perLabel || {}).map(([label, val]) => `
            <div class="stat-card">
              <div class="stat-label">${label}</div>
              <div class="stat-total"><b>${val.total}</b> mails</div>
              <div class="stat-breakdown">
                <span class="unread">non lus&nbsp;<b>${val.unread}</b></span> |
                <span class="read">lus&nbsp;<b>${val.read}</b></span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
      <div style="page-break-after: always;"></div>
      ${Object.entries(CATEGORY_MAP).map(([cat, label]) =>
        categorized[cat].length ? `
          <div class="category-block">
            <div class="category-title"><span class="category-chip">${label} (${categorized[cat].length})</span></div>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Sujet</th>
                  <th>Expéditeur</th>
                  <th>Lu</th>
                </tr>
              </thead>
              <tbody>
                ${categorized[cat].map(mail => {
                  const d = mail.dateStr ? new Date(mail.dateStr) : null;
                  const dateFormatted = d && !isNaN(d) ? d.toLocaleString('fr-FR') : '';
                  return `
                    <tr>
                      <td>${dateFormatted}</td>
                      <td><a href="https://mail.google.com/mail/u/0/#inbox/${mail.id}" target="_blank" style="color:#1a73e8;text-decoration:underline;">${mail.subject || '(Sans sujet)'}</a></td>
                      <td>${mail.from || ''}</td>
                      <td>${mail.isUnread ? 'Non' : 'Oui'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : ''
      ).join('')}

      <div class="footer">
        Rapport généré automatiquement avec Gmail Résumé – ${new Date().toLocaleString('fr-FR')}
      </div>
    </body>
    </html>
  `;
}

// Usage : `Subject: ${encodeSubject(subject)}`

function encodeSubject(subject) {
  return `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
}

function buildEmailHeaderBlock(frontendBase, apiBase , token) {
  const appUrl = frontendBase || 'http://localhost:5173';
  const apiUrl = apiBase || 'http://localhost:4000';
  const automationUrl = `${appUrl}/automation`;
  // const showLastUrl = `${apiUrl}/show-last-report`;
  // const pdfUrl = `${apiUrl}/report-pdf`;
  const showLastUrl = `${apiUrl}/show-report/${token}`;
  const pdfUrl = `${apiUrl}/report-pdf/${token}`;
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="border:none">
  <tbody>
    <tr>
      <td valign="top" style="padding:24px 20px 24px 0;width:48%;vertical-align:top">
        <p style="margin-bottom:18px">Votre résumé quotidien Gmail est disponible ci-dessous&nbsp;:</p>
        <p>
          <a href="${showLastUrl}" style="display:inline-block;padding:12px 28px;background:#1a73e8;color:#fff;font-size:16px;border-radius:8px;text-decoration:none;font-weight:bold" target="_blank">
            Voir le résumé dans le navigateur
          </a>
        </p>
        <!-- <p style="margin:10px 0 0 0;">
          <a href="${pdfUrl}" style="display:inline-block;padding:10px 18px;background:#43a047;color:#fff;font-size:14px;border-radius:8px;text-decoration:none;font-weight:600" target="_blank">
            📄 Ouvrir le rapport PDF
          </a>
        </p>-->
        <p style="font-size:11px;color:#aaa;margin-top:16px">
          (Pour un affichage parfait sur tous les supports, utilisez l’un des boutons ci-dessus.)
        </p>
      </td>
      <td valign="top" style="padding:24px 0 24px 20px;width:52%;vertical-align:top;border-left:1px solid #e0e0e0">
        <p style="margin-bottom:18px">Pour accéder à l’application ou à l’automatisation :</p>
        <p style="margin:0 0 10px 0;">
          <a href="${appUrl}" style="display:inline-block;padding:12px 28px;background:#a21ae8;color:#fff;font-size:16px;border-radius:8px;text-decoration:none;font-weight:bold" target="_blank">
            Ouvrir l’application
          </a>
        </p>
        <!-- <p style="margin:0;">
          <a href="${automationUrl}" style="display:inline-block;padding:12px 28px;background:#a21ae8;color:#fff;font-size:16px;border-radius:8px;text-decoration:none;font-weight:bold" target="_blank">
            Interface de génération
          </a>
        </p> -->
      </td>
    </tr>
  </tbody>
</table>
<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
`;
}
// // Exemple d’API pour servir le dernier rapport généré

// // const app = express();
// const allowedOrigins = process.env.CORS_ORIGINS
//    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
//    : ['http://localhost:5173'];

// app.use(cors({
//   origin: (origin, callback) => {
//     if (!origin || allowedOrigins.includes(origin)) {
//       return callback(null, true);
//     } else {
//       return callback(new Error(`CORS not allowed for origin: ${origin}`));
//     }
//   },
//   credentials: true
// }));

// Cette route doit apparaître avant express.json()
app.get('/report-pdf', async (req, res) => {
  //   if (!req.session.email) {
  //   return res.status(401).send('Non authentifié');
  // }
  const userEmail = getSessionEmail(req);
  if (!userEmail) {
    return res.status(401).send('Non authentifié');
  }
  const userReport = userReports.get(userEmail);
  if (!userReport || !userReport.html) {
    return res.status(404).send('Aucun rapport');
  }
  console.log("➡️ PDF Request → userReport HTML length:", userReport.html.length);

  try {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    console.log("➡️ Puppeteer lancé");

    await page.setContent(userReport.html, { waitUntil: 'networkidle0' });
    console.log("➡️ HTML injecté");

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "20mm", bottom: "20mm" },
      emulateMedia: 'print'  // Force le mode impression
    });
    console.log("✅ PDF généré, taille:", pdfBuffer.length);

    await browser.close();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="rapport-gmail.pdf"',
      'Content-Length': pdfBuffer.length
    });

    res.end(pdfBuffer);
    console.log("✅ PDF envoyé au client.");
  } catch (err) {
    console.error("❌ Erreur lors de la génération du PDF:", err);
    res.status(500).send('Erreur serveur lors de la génération du PDF');
  }
});

// S'assurer que express.json() est utilisé AVANT les routes
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// (supprimé : configuration session doublon, voir plus haut)

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI // ex: http://localhost:3000/oauth2callback
);

// 1. Route pour récupérer l'URL d'authentification Google
app.get('/auth-url', async (req, res) => {
  if (req.session.tokens) {
    // Recrée l'OAuth2Client avec le token stocké
    oauth2Client.setCredentials(req.session.tokens);

    // Lis l’email de l’utilisateur
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    try {
      const profile = await gmail.users.getProfile({ userId: 'me' });
      res.send({ email: profile.data.emailAddress });
      return;
    } catch (err) {
      // Token invalide ou expiré → on efface
      req.session.tokens = null;
    }
  }
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',                // pour le forcer à être renvoyé même si déjà accepté
    scope: ['https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.send',
            'email',
            'profile'
    ]
  });
  res.send({ url });
});

// Nouveau: génération PDF via token public (sans session)
// Exemple d'URL envoyé par mail: /report-pdf/:token
app.get('/report-pdf/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || !/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(400).send('Token invalide');
    }

    const htmlPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
    if (!fs.existsSync(htmlPath)) {
      return res.status(404).send('Rapport introuvable');
    }
    const html = fs.readFileSync(htmlPath, 'utf-8');

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "20mm", bottom: "20mm" }
    });

    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="rapport-gmail.pdf"',
      'Content-Length': pdfBuffer.length
    });
    return res.end(pdfBuffer);
  } catch (err) {
    console.error('❌ Erreur PDF token:', err);
    return res.status(500).send('Erreur lors de la génération du PDF par token');
  }
});

// 2. Route appelée par Google (REDIRECT_URI) après le consentement
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Missing code parameter');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Stocke le token en session utilisateur
    req.session.tokens = tokens;
    console.log('[OAuth2callback] tokens:', tokens);
    // Lis l’email ici pour log et session
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    req.session.email = profile.data.emailAddress;

    // Stocke dans req.session.user pour /enable-automation
    req.session.user = {
      email: profile.data.emailAddress
    };
    // S'assurer que l'utilisateur est bien stocké dans la session
    // req.session.user = { email: userEmail }; // déjà fait ci-dessus
    res.send(`<h2>Authentification réussie !</h2>
      <p>Vous pouvez fermer cette fenêtre et retourner à l'application.</p>
      <p>(Le backend a bien reçu et stocké le token Gmail.)</p>`);
  } catch (err) {
    res.status(500).send('Erreur lors de l\'échange du code : ' + err.message);
  }
});

// 3. Déconnexion
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.send({ success: true });
  });
});

// 4. Exemple d'appel à l'API Gmail (ici avec le token stocké en session)
app.get('/emails', async (req, res) => {
  if (!req.session.tokens) return res.status(401).send({ error: 'Non authentifié' });
  try {
    oauth2Client.setCredentials(req.session.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const response = await gmail.users.messages.list({ userId: 'me', maxResults: 5 });
    res.send(response.data);
  } catch (err) {
    res.status(500).send({ error: err.message });
  }
});


// 5. Générer un rapport Gmail (HTML ou JSON)

// app.post('/generate-report', async (req, res) => {
//   console.log('🎯 Route atteinte');
//   console.log('Session reçue:', req.session);
//   // Vérification de session (si jamais le middleware n'est pas passé)
//   if (!req.session || !req.session.user) {
//     return res.status(401).json({ error: 'Non autorisé (pas connecté)' });
//   }
//   console.log('Corps reçu:', req.body);
//   if (!req.session.tokens) return res.status(401).json({ error: 'Non authentifié' });

//   const userEmail = req.session.email;
//   if (!userEmail) return res.status(401).json({ error: 'Email utilisateur manquant' });

//   // Génère un jobId unique
//   const jobId = Date.now().toString() + Math.floor(Math.random() * 10000);
//   if (!userJobs.has(userEmail)) {
//     userJobs.set(userEmail, {});
//   }
//   userJobs.get(userEmail)[jobId] = { progress: 0, result: null };

//   // Générer le token ici pour le scope
//   const token = generateToken(userEmail);

//   (async () => {
//     let emails = [];
//     let result, html;
//     let stats = {};
//     try {
//       const { date, onlyUnread, groupByLabel } = req.body;
//       oauth2Client.setCredentials(req.session.tokens);
//       const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

//       let query = `after:${Math.floor(new Date(date).getTime() / 1000)}`;
//       if (onlyUnread) query += ' is:unread';

//       userJobs.get(userEmail)[jobId].progress = 10;
//       await new Promise(r => setTimeout(r, 400));

//       const messagesRes = await gmail.users.messages.list({
//         userId: 'me',
//         maxResults: 50,
//         q: query
//       });

//       userJobs.get(userEmail)[jobId].progress = 30;
//       await new Promise(r => setTimeout(r, 400));

//       if (messagesRes.data.messages) {
//         for (const m of messagesRes.data.messages) {
//           const mail = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata' });
//           const subjectHeader = mail.data.payload.headers.find(h => h.name === 'Subject');
//           const dateHeader = mail.data.payload.headers.find(h => h.name === 'Date');
//           let dateStr = '';
//           if (dateHeader) {
//             const d = new Date(dateHeader.value);
//             if (!isNaN(d.getTime())) {
//               dateStr = d.toISOString();
//             }
//           }
//           const fromHeader = mail.data.payload.headers.find(h => h.name === 'From');
//           emails.push({
//             id: m.id,
//             subject: subjectHeader ? subjectHeader.value : '(Sans sujet)',
//             labelIds: mail.data.labelIds,
//             snippet: mail.data.snippet,
//             dateStr,
//             isUnread: mail.data.labelIds.includes('UNREAD'),
//             from: fromHeader ? fromHeader.value : ''
//           });
//         }
//       }
//       userJobs.get(userEmail)[jobId].progress = 50;
//       await new Promise(r => setTimeout(r, 400));

//       if (groupByLabel) {
//         result = emails.reduce((acc, mail) => {
//           mail.labelIds.forEach(label => {
//             acc[label] = acc[label] || [];
//             acc[label].push(mail);
//           });
//           return acc;
//         }, {});
//       } else {
//         result = emails;
//       }

//       userJobs.get(userEmail)[jobId].progress = 70;
//       await new Promise(r => setTimeout(r, 400));

//       const total = emails.length;
//       const unread = emails.filter(m => m.isUnread).length;
//       const read = total - unread;
//       // Statistiques détaillées par label
//       const CATEGORY_MAP = {
//         CATEGORY_PERSONAL: "Principale",
//         CATEGORY_PROMOTIONS: "Promotions",
//         CATEGORY_UPDATES: "Notifications",
//         CATEGORY_SOCIAL: "Réseaux sociaux",
//         CATEGORY_FORUMS: "Forums"
//       };
//       const perLabel = {};
//       for (const [cat, label] of Object.entries(CATEGORY_MAP)) {
//         const mails = emails.filter(m => m.labelIds?.includes(cat));
//         perLabel[label] = {
//           total: mails.length,
//           read: mails.filter(m => !m.isUnread).length,
//           unread: mails.filter(m => m.isUnread).length
//         };
//       }
//       stats = { total, read, unread, perLabel };
//       html = generateReportHtml({
//         date,
//         userEmail: req.session.email || "Non identifié",
//         emails,
//         generatedAt: new Date().toLocaleString('fr-FR'),
//         options: { onlyUnread, groupByLabel },
//         stats,
//       });

//       // Stocker dans userJobs ET userReports
//       userJobs.get(userEmail)[jobId].progress = 90;
//       userJobs.get(userEmail)[jobId].result = { html, json: result, count: emails.length };
//       userReports.set(userEmail, { html, json: result, count: emails.length });

//       // ===== NOUVEAU : Générer un token unique et enregistrer rapport HTML sur disque =====
//       if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
//       const htmlPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
//       // DEBUG: Affichage des chemins et token utilisés
//       console.log("📁 Dossier des rapports :", REPORTS_DIR);
//       console.log("🔑 Token utilisé pour générer le rapport :", token);
//       console.log("💾 Chemin complet du fichier rapport :", htmlPath);
//       // Injecte le style CSS directement dans le HTML si ce n'est pas déjà le cas
//       const styledHtml = html.replace(
//         '</head>',
//         `<style>
//           .container {
//             background: white;
//             padding: 40px 48px;
//             border-radius: 12px;
//             box-shadow: 0 4px 24px #0002;
//             margin: 32px auto;
//             max-width: 1200px;
//           }
//         </style></head>`
//       );
//       fs.writeFileSync(htmlPath, styledHtml, 'utf-8');
//       // DEBUG: Confirmation sauvegarde
//       console.log("✅ Rapport HTML sauvegardé avec succès !");
//       // Construire l’URL publique d’accès
//       const reportUrl = `${process.env.API_BASE_URL || 'http://localhost:4000'}/show-report/${token}`;
//       res.json({
//         success: true,
//         jobId,
//         token,
//         reportUrl // ⬅️ URL directe pour voir le rapport dans le navigateur
//       });
//       // Construire le lien sécurisé
//       const baseUrl = process.env.FRONT_URL || process.env.API_BASE_URL || 'http://localhost:4000';
//       const link = `${baseUrl}/show-report/${token}`;
//       userJobs.get(userEmail)[jobId].progress = 100;

//       // Envoi email automatique avec lien sécurisé
//       await sendMail({
//         to: req.session.user?.email || userEmail,
//         subject: 'Votre résumé Gmail',
//         html: buildEmailHtml(link)
//       });

//     } catch (err) {
//       userJobs.get(userEmail)[jobId].progress = -1;
//       userJobs.get(userEmail)[jobId].result = { error: err.message };
//     }
//   })();

//   // Répond tout de suite avec le jobId (et token pour le frontend si besoin)
//   res.json({ success: true, jobId, token });
// });
app.post('/generate-report', async (req, res) => {
  console.log('🎯 Route atteinte');
  console.log('Session reçue:', req.session);

  const userEmail = getSessionEmail(req);
  if (!userEmail) return res.status(401).json({ error: 'Non autorisé (pas connecté)' });
  if (!req.session.tokens) return res.status(401).json({ error: 'Non authentifié' });
  // Normalize session.user if missing
  if (!req.session.user) req.session.user = { email: userEmail };

  // Génère un jobId unique
  const jobId = Date.now().toString() + Math.floor(Math.random() * 10000);
  if (!userJobs.has(userEmail)) userJobs.set(userEmail, {});
  userJobs.get(userEmail)[jobId] = { progress: 0, result: null };

  // ✅ Générer le token et le reportUrl AVANT l'IIFE
  const token = generateToken(userEmail);
  const reportUrl = `${process.env.API_BASE_URL || 'http://localhost:4000'}/show-report/${token}`;

  // 🧩 Placeholder immédiat pour éviter "Rapport introuvable" si l'utilisateur clique trop vite
  try {
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const placeholderPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
    const placeholderHtml = `
    <!DOCTYPE html>
    <html lang="fr">
      <head>
        <meta charset="utf-8">
        <title>Rapport en préparation…</title>
        <meta http-equiv="refresh" content="2"> <!-- auto-refresh toutes les 2s -->
        <style>
          body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f5f5f5; margin:0; }
          .container {
            background:#fff; margin:40px auto; padding:32px; max-width:800px; border-radius:12px; box-shadow:0 4px 24px #0002;
          }
          .spinner { display:inline-block; animation: spin 1s linear infinite; }
          @keyframes spin { to { transform: rotate(360deg); } }
          .muted { color:#666; font-size:14px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>⏳ Génération du rapport</h2>
          <p>Votre rapport est en cours de préparation. Cette page se rechargera automatiquement…</p>
          <p class="muted">Vous pouvez revenir dans quelques secondes.</p>
          <div class="spinner">🔄</div>
        </div>
      </body>
    </html>`;
    // Écrit le placeholder uniquement si le fichier n'existe pas encore (premier clic)
    if (!fs.existsSync(placeholderPath)) {
      fs.writeFileSync(placeholderPath, placeholderHtml, 'utf-8');
    }
  } catch (e) {
    console.warn('⚠️ Impossible d\'écrire le placeholder pour le rapport :', e.message);
  }

  // 👉 Répondre IMMÉDIATEMENT (1 seule fois)
  res.json({ success: true, jobId, token, reportUrl });

  // Lancer le travail en arrière-plan (dans CE tour de requête)
  (async () => {
    let emails = [];
    let result, html;
    let stats = {};
    try {
      const { date, onlyUnread, groupByLabel } = req.body;

      userJobs.get(userEmail)[jobId].progress = 10;

      oauth2Client.setCredentials(req.session.tokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      let query = `after:${Math.floor(new Date(date).getTime() / 1000)}`;
      if (onlyUnread) query += ' is:unread';

      const messagesRes = await gmail.users.messages.list({ userId: 'me', maxResults: 50, q: query });
      userJobs.get(userEmail)[jobId].progress = 30;

      if (messagesRes.data.messages) {
        for (const m of messagesRes.data.messages) {
          const mail = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata' });
          const subjectHeader = mail.data.payload.headers.find(h => h.name === 'Subject');
          const dateHeader = mail.data.payload.headers.find(h => h.name === 'Date');
          let dateStr = '';
          if (dateHeader) {
            const d = new Date(dateHeader.value);
            if (!isNaN(d.getTime())) dateStr = d.toISOString();
          }
          const fromHeader = mail.data.payload.headers.find(h => h.name === 'From');
          const labelIds = mail.data.labelIds || []; // ✅ évite includes sur undefined
          emails.push({
            id: m.id,
            subject: subjectHeader ? subjectHeader.value : '(Sans sujet)',
            labelIds,
            snippet: mail.data.snippet,
            dateStr,
            isUnread: labelIds.includes('UNREAD'),
            from: fromHeader ? fromHeader.value : ''
          });
        }
      }
      userJobs.get(userEmail)[jobId].progress = 50;

      // … calcule result & stats comme avant …
      const CATEGORY_MAP = {
        CATEGORY_PERSONAL: "Principale",
        CATEGORY_PROMOTIONS: "Promotions",
        CATEGORY_UPDATES: "Notifications",
        CATEGORY_SOCIAL: "Réseaux sociaux",
        CATEGORY_FORUMS: "Forums"
      };
      const total = emails.length;
      const unread = emails.filter(m => m.isUnread).length;
      const read = total - unread;
      const perLabel = {};
      for (const [cat, label] of Object.entries(CATEGORY_MAP)) {
        const mails = emails.filter(m => m.labelIds?.includes(cat));
        perLabel[label] = {
          total: mails.length,
          read: mails.filter(m => !m.isUnread).length,
          unread: mails.filter(m => m.isUnread).length
        };
      }
      stats = { total, read, unread, perLabel };
      userJobs.get(userEmail)[jobId].progress = 70;

      html = generateReportHtml({
        date,
        userEmail: userEmail || "Non identifié",
        emails,
        generatedAt: new Date().toLocaleString('fr-FR'),
        options: { onlyUnread, groupByLabel },
        stats,
      });
      userJobs.get(userEmail)[jobId].progress = 90;

      // Écriture fichier avec le **même token**
      if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
      const htmlPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
      const styledHtml = html.replace(
        '</head>',
        `<style>
          .container {
            background: white;
            padding: 40px 48px;
            border-radius: 12px;
            box-shadow: 0 4px 24px #0002;
            margin: 32px auto;
            max-width: 1200px;
          }
        </style></head>`
      );
      fs.writeFileSync(htmlPath, styledHtml, 'utf-8');

      // ✅ stocker dans Maps
      userJobs.get(userEmail)[jobId].result = { html, json: result, count: emails.length, token, reportUrl };
      userReports.set(userEmail, { html, json: result, count: emails.length });

      userJobs.get(userEmail)[jobId].progress = 100;

      // (optionnel) envoi mail — pas de res.json ici !
      await sendMail({
        to: userEmail,
        subject: 'Votre résumé Gmail',
        html: buildEmailHtml(reportUrl)
      });
    } catch (err) {
      console.error('❌ generate-report async error:', err);
      userJobs.get(userEmail)[jobId].progress = -1;
      userJobs.get(userEmail)[jobId].result = { error: err.message };
    }
  })();
});
// Nouvelle route pour consulter le rapport par token (HTML sur disque)
app.get('/show-report/:token', (req, res) => {
  const token = req.params.token;
  const filepath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
  // 🧯 Fallback legacy
let effectivePath = filepath;
if (!fs.existsSync(effectivePath)) {
  const legacyPath = path.join(REPORTS_DIR, `${token}.html`);
  if (fs.existsSync(legacyPath)) {
    effectivePath = legacyPath;
  }
}

  // Disable all caching for this endpoint
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  if (!fs.existsSync(effectivePath)) {
    const softWaitHtml = `
      <!DOCTYPE html>
      <html lang="fr">
        <head>
          <meta charset="utf-8">
          <title>Rapport en préparation…</title>
          <meta http-equiv="refresh" content="2">
          <meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate, proxy-revalidate">
          <style>
            body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f5f5f5; margin:0; }
            .container {
              background:#fff; margin:40px auto; padding:32px; max-width:800px; border-radius:12px; box-shadow:0 4px 24px #0002;
            }
            .muted { color:#666; font-size:14px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>⏳ Génération du rapport</h2>
            <p>Le rapport n'est pas encore prêt. Cette page va se recharger automatiquement…</p>
            <p class="muted">Si cela dure plus de 30 secondes, regénérez le rapport depuis l'application.</p>
          </div>
        </body>
      </html>`;
    return res.status(202).set('Content-Type', 'text/html; charset=utf-8').send(softWaitHtml);
  }
  // Lire le contenu du rapport HTML
  let html = fs.readFileSync(effectivePath, 'utf-8');
  // If the file is still a placeholder (contains a meta refresh), keep 202 to continue polling
  const hasMetaRefresh = /<meta[^>]*http-equiv=["']refresh["'][^>]*>/i.test(html);
  if (hasMetaRefresh) {
    return res.status(202).set('Content-Type', 'text/html; charset=utf-8').send(html);
  }
  // Ensure no stale meta-refresh remains in final HTML (strip it if present)
  html = html.replace(/<meta[^>]*http-equiv=["']refresh["'][^>]*>\s*/ig, '');
  // Insérer le bloc de style CSS juste avant </head>
  const cssBlock = `
<style>
  body {
    background: #f5f5f5;
    font-family: "Segoe UI", sans-serif;
    margin: 0;
    padding: 0;
  }
  .container {
    background: white;
    padding: 40px 48px;
    border-radius: 12px;
    box-shadow: 0 4px 24px #0002;
    margin: 32px auto;
    max-width: 1200px;
    box-sizing: border-box;
  }
  /* Disable sticky header in report visualization */
  .gmail-report-sticky-header {
    position: static !important;
    top: auto !important;
    box-shadow: none !important;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #ddd;
    margin-bottom: 24px;
    padding-bottom: 12px;
  }
  .header h1 {
    font-size: 28px;
    color: #2c3e50;
  }
  .header .date {
    font-size: 16px;
    color: #888;
  }
  .stats {
    display: flex;
    gap: 24px;
    margin-bottom: 24px;
  }
  .stat-item {
    background: #e3f2fd;
    padding: 12px;
    border-radius: 8px;
    text-align: center;
    flex: 1;
  }
  .stat-number {
    font-size: 24px;
    font-weight: bold;
    color: #1976d2;
  }
  .stat-label {
    font-size: 14px;
    color: #555;
  }
  .section {
    margin-bottom: 40px;
  }
  .section h2 {
    font-size: 20px;
    color: #2c3e50;
    border-bottom: 1px solid #ccc;
    padding-bottom: 8px;
    margin-bottom: 16px;
  }
  .action-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 13px;
    background: #e1bee7;
    color: #4a148c;
  }
  .metro-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 16px;
  }
  .metro-table th,
  .metro-table td {
    padding: 8px 12px;
    border: 1px solid #ddd;
    font-size: 14px;
  }
  .metro-table th {
    background: #eeeeee;
    font-weight: 600;
    color: #333;
  }
  .footer {
    font-size: 14px;
    color: #aaa;
    text-align: center;
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #ddd;
  }

  /* ✅ Hard override to keep the tables inside the container */
  .gmail-report-table { 
    max-width: 100% !important; 
    width: 100% !important; 
    overflow-x: auto; 
  }
  .gmail-report-table table {
    width: 100% !important;
    table-layout: fixed;
    box-sizing: border-box;
  }
  .gmail-report-table th, 
  .gmail-report-table td {
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  @media (max-width: 700px) {
    .container {
      padding: 24px 14px;
    }
  }
</style>
`;
  // Injecter le CSS juste avant </head>
  html = html.replace(/<\/head>/i, cssBlock + '\n</head>');
  // Ajout : sauvegarde du HTML généré pour vérification manuelle
  // const htmlPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
  // fs.writeFileSync(htmlPath, html, 'utf-8');

  // Et à la fin, normaliser l’écriture sous le bon nom :
  const normalizedPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
  fs.writeFileSync(normalizedPath, html, 'utf-8');
  res.status(200).set('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});


app.post('/get-report-progress', (req, res) => {
  const { jobId } = req.body;
  const userEmail = getSessionEmail(req);
  if (!userEmail || !userJobs.has(userEmail)) {
    return res.json({ progress: 0 });
  }
  
  const job = userJobs.get(userEmail)[jobId];
  if (!job) return res.json({ progress: 0 });
  res.json({
    progress: job.progress,
    result: job.progress === 100 ? job.result.html : null
  });
});


app.get('/last-report', (req, res) => {
  const userEmail = getSessionEmail(req);
  if (!userEmail) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  const userReport = userReports.get(userEmail);
  if (!userReport) {
    return res.status(404).json({ error: "Aucun rapport généré" });
  }
  res.json(userReport);
});

app.get('/show-last-report', (req, res) => {
  const userEmail = getSessionEmail(req);
  if (!userEmail) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const userReport = userReports.get(userEmail);
  if (!userReport || !userReport.html) {
    return res.status(404).send('<h3 style="font-family:Arial,sans-serif">Aucun rapport disponible</h3>');
  }

  const appUrl = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
  const pdfUrl = (process.env.API_BASE_URL || 'http://localhost:4000') + '/report-pdf';

  const html = `
  <!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dernier rapport – Gmail Résumé</title>
    <style>
      html, body { margin:0; padding:0; background:#f3f6fb; font-family: Arial, sans-serif; }
      .container {
        background: white;
        padding: 40px 48px;
        border-radius: 12px;
        box-shadow: 0 4px 24px #0002;
        margin: 32px auto;
        max-width: 1200px;
      }
      .toolbar { display:flex; gap:12px; align-items:center; justify-content:flex-end; margin-bottom: 12px; }
      .btn { display:inline-block; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600; }
      .btn-primary { background:#1a73e8; color:#fff; }
      .btn-success { background:#43a047; color:#fff; }
      .btn-outline { background:transparent; color:#1a73e8; border:1px solid #1a73e8; }
      .title { font-size:20px; font-weight:700; color:#2c3e50; margin:0 0 16px 0; }
      .frame-wrap { width:100%; }
      iframe { width:100%; border:0; }
      .hint { color:#9aa0a6; font-size:12px; margin-top:8px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="toolbar">
        <a class="btn btn-outline" href="${appUrl}" target="_blank">Ouvrir l’application</a>
        <a class="btn btn-primary" href="${appUrl}/automation" target="_blank">Interface de génération</a>
        <a class="btn btn-success" href="${pdfUrl}" target="_blank">📄 Ouvrir le PDF</a>
      </div>
      <h1 class="title">Dernier rapport</h1>
      <div class="frame-wrap">
        <iframe id="reportFrame" src="/last-report-raw" onload="sizeFrame()"></iframe>
      </div>
      <div class="hint">Astuce : utilisez les boutons ci-dessus pour ouvrir l’application ou le PDF.</div>
    </div>

    <script>
      function sizeFrame(){
        try {
          var f = document.getElementById('reportFrame');
          if(!f) return;
          var doc = f.contentDocument || f.contentWindow.document;
          if(!doc) return;
          var h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
          // Minimum height to avoid sudden collapses
          f.style.height = Math.max(h, 800) + 'px';
        } catch(e) { /* ignore cross-origin - should be same-origin here */ }
      }
      // Recompute height periodically in case images/fonts load later
      setInterval(sizeFrame, 800);
    </script>
  </body>
  </html>`;

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/last-report-raw', (req, res) => {
  const userEmail = getSessionEmail(req);
  if (!userEmail) {
    return res.status(401).json({ error: 'Non authentifié' });
  }
  const userReport = userReports.get(userEmail);
  if (!userReport || !userReport.html) {
    return res.status(404).send('<h3 style="font-family:Arial,sans-serif">Aucun rapport disponible</h3>');
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(userReport.html);
});

app.get('/count-emails', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Non authentifié' });
  try {
    const { date, onlyUnread } = req.query;
    oauth2Client.setCredentials(req.session.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    let query = `after:${Math.floor(new Date(date).getTime() / 1000)}`;
    if (onlyUnread === 'true') query += ' is:unread';
    const messagesRes = await gmail.users.messages.list({ userId: 'me', q: query });
    const count = messagesRes.data.resultSizeEstimate || 0;
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/send-report', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Non authentifié' });
  const userEmail = getSessionEmail(req);
  if (!userEmail) {
    return res.status(401).json({ error: 'Aucun rapport à envoyer. Générez d’abord le rapport.' });
  }

  const userReport = userReports.get(userEmail);
  if (!userReport) return res.status(400).json({ error: 'Aucun rapport à envoyer. Générez d\'abord le rapport.' });

  try {
    const { to, subject, html } = req.body;

    // Générer un token unique pour ce rapport et sauvegarder le HTML sur disque
    const token = generateToken(userEmail);
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const filepath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
    fs.writeFileSync(filepath, html || userReport.html || '<p>(Aucun contenu de rapport disponible)</p>', 'utf-8');
    const link = `${process.env.FRONT_URL || process.env.API_BASE_URL || 'http://localhost:4000'}/show-report/${token}`;

    // Build header block (CTA buttons) and compute final HTML
    const headerHtml = buildEmailHeaderBlock(process.env.FRONTEND_BASE_URL, process.env.API_BASE_URL, token);
    const finalHtml = headerHtml + (html || userReport.html || '<p>(Aucun contenu de rapport disponible)</p>');

    // Subject fallback
    const safeSubject = subject || `Résumé Gmail – ${new Date().toLocaleDateString('fr-FR')}`;
    // Recipient fallback
    const recipient = to || userEmail;

    const messageParts = [
      `To: ${recipient}`,
      'Content-Type: text/html; charset=utf-8',
      `Subject: ${encodeSubject(safeSubject)}` ,
      '',
      // Remplacer l'ancien lien par le nouveau lien sécurisé
      finalHtml.replace(/https?:\/\/[^/]+\/show-report\/[a-zA-Z0-9\-]+/g, link)
    ];
    oauth2Client.setCredentials(req.session.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    res.json({ success: true, link });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// Pour Debug - Export token (développement uniquement, ne pas activer en production)
if (process.env.NODE_ENV !== 'production') {
  app.get('/export-token', (req, res) => {
    if (!req.session.tokens) {
      return res.status(400).send('Aucun token en session');
    }
    fs.writeFileSync('./token.json', JSON.stringify(req.session.tokens, null, 2));
    res.send('✅ Token exporté dans token.json');
  });
}



app.get('/get-automation', async (req, res) => {
  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const { default: fs } = await import('fs');
  const { resolve } = await import('path');
  const filePath = resolve('./automated-users.json');

  if (!fs.existsSync(filePath)) {
    return res.json({ active: false });
  }

  const users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const currentUser = users.find(u => u.email === email);

  if (!currentUser) {
    return res.json({ active: false });
  }

  const { frequencyMinutes } = currentUser;

  // Devine le type d'automatisation
  let frequency = 'daily';
  let xhours = null;
  let xminutes = null;

  if (frequencyMinutes >= 1440) {
    frequency = 'daily';
  } else if (frequencyMinutes % 60 === 0) {
    frequency = 'xhours';
    xhours = frequencyMinutes / 60;
  } else {
    frequency = 'xminutes';
    xminutes = frequencyMinutes;
  }

  res.json({
    active: true,
    frequency,
    xhours,
    xminutes
  });
});

app.post('/enable-automation', express.json(), async (req, res) => {
  const fs = await import('fs');
  const path = await import('path');
  const filePath = path.resolve('./automated-users.json');

  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).send('Non authentifié');
  }

  const { frequencyMinutes, active } = req.body || {};
  // Normalize session.user if missing
  if (!req.session.user) req.session.user = { email };

  // ✅ Cas désactivation explicite — ne requiert PAS de tokens
  if (active === false) {
    let users = [];
    if (fs.existsSync(filePath)) {
      users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      users = users.filter(u => u.email !== email);
      fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
    }
    // Session keep-alive/touch to avoid session loss
    try { req.session && req.session.touch && req.session.touch(); } catch (_) {}
    return res.json({ ok: true, disabled: true, message: 'Automatisation désactivée' });
  }

  // ✅ Activation : on a besoin de tokens. On prend la session, sinon fallback fichier.
  let tokens = req.session.tokens || null;
  if (!tokens && fs.existsSync(filePath)) {
    try {
      const users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const existing = users.find(u => u.email === email && u.tokens);
      if (existing && existing.tokens) {
        tokens = existing.tokens;
      }
    } catch (_) { /* ignore parse errors */ }
  }
  if (!tokens) {
    return res.status(401).json({ error: 'Non authentifié (tokens manquants). Veuillez vous reconnecter.' });
  }

  // ✅ Validation fréquence
  if (!frequencyMinutes || typeof frequencyMinutes !== 'number' || frequencyMinutes <= 0) {
    return res.status(400).send('Fréquence invalide');
  }

  const userEntry = {
    email,
    tokens: {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date
    },
    frequencyMinutes,
    lastRun: null // jamais encore lancé
  };

  // ✅ Écriture atomique simple
  let users = [];
  if (fs.existsSync(filePath)) {
    users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    users = users.filter(u => u.email !== userEntry.email);
  }
  users.push(userEntry);
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2));

  return res.json({ ok: true, enabled: true, frequencyMinutes });
});

// Nouvelle route pour désactiver explicitement l'automatisation
app.post('/disable-automation', async (req, res) => {
  const fs = await import('fs');
  const path = await import('path');
  const filePath = path.resolve('./automated-users.json');

  const email = getSessionEmail(req);
  if (!email) {
    return res.status(401).send('Non authentifié');
  }

  let users = [];
  if (fs.existsSync(filePath)) {
    users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const before = users.length;
    users = users.filter(u => u.email !== email);
    const changed = users.length !== before;
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
    // Session keep-alive/touch to avoid session loss
    try { req.session && req.session.touch && req.session.touch(); } catch (_) {}
    return res.json({ ok: true, disabled: true, changed });
  }

  // File did not exist; nothing to disable but respond OK for idempotency
  return res.json({ ok: true, disabled: true, changed: false });
});

// ====== LANCEMENT MANUEL DE L'AUTOMATISATION POUR L'UTILISATEUR CONNECTÉ ======
app.post('/automation/run-now', requireAuth, async (req, res) => {
  try {
    const userEmail = getSessionEmail(req);
    if (!userEmail) {
      return res.status(400).json({ ok: false, error: 'Utilisateur non identifié' });
    }

    const filePath = path.resolve('./automated-users.json');
    let users = [];
    if (fs.existsSync(filePath)) {
      users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }

    let userEntry = users.find(u => u.email === userEmail);
    if (!userEntry) {
      // Ajoute l'utilisateur avec tokens en session
      userEntry = {
        email: userEmail,
        tokens: req.session.tokens,
        frequencyMinutes: 60,
        lastRun: null
      };
      users.push(userEntry);
    } else {
      // Rafraîchit les tokens si présents
      if (req.session.tokens) {
        userEntry.tokens = req.session.tokens;
      }
    }

    // Lance l'automatisation pour cet utilisateur
    const result = await performAutomationForUser(userEntry);
    if (!result.ok) {
      return res.status(500).json({ ok: false, error: result.error || 'Erreur inconnue' });
    }

    // Met à jour lastRun et sauvegarde
    userEntry.lastRun = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(users, null, 2));

    res.json({
      ok: true,
      sent: true,
      email: userEmail,
      count: result.count,
      token: result.token
    });
  } catch (err) {
    console.error('❌ /automation/run-now error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


// ====== ROUTE POUR LANCER L'AUTOMATISATION VIA HTTP ======
app.get('/run-cron', async (req, res) => {
  const fs = await import('fs');
  const path = await import('path');
  const filePath = path.resolve('./automated-users.json');

  // 1) Auth simple via clé secrète
  if (!req.query.key || req.query.key !== process.env.CRON_SECRET) {
    return res.status(403).send('Forbidden');
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Aucune automatisation trouvée');
  }

  const users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const now = Date.now();
  const triggered = [];
  const results = [];

  for (const user of users) {
    try {
      const last = user.lastRun ? new Date(user.lastRun).getTime() : 0;
      if (now - last < user.frequencyMinutes * 60 * 1000) {
        results.push({ email: user.email, skipped: true, reason: 'not_due' });
        continue;
      }

      // 2) OAuth client pour cet utilisateur
      const { google } = await import('googleapis');
      const oauth2Client = new google.auth.OAuth2(
        process.env.CLIENT_ID,
        process.env.CLIENT_SECRET,
        process.env.REDIRECT_URI
      );
      oauth2Client.setCredentials(user.tokens);

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const email = profile.data.emailAddress || user.email;

      // 3) Collecte des messages (même logique que /generate-report)
      const date = new Date().toISOString().slice(0, 10);
      const onlyUnread = false;
      const groupByLabel = true;

      let query = `after:${Math.floor(new Date(date).getTime() / 1000)} newer_than:1d`;
      if (onlyUnread) query += ' is:unread';

      const messagesRes = await gmail.users.messages.list({
        userId: 'me',
        // Ajustez maxResults selon votre besoin
        maxResults: 50,
        q: query
      });

      const emails = [];
      if (messagesRes.data.messages && messagesRes.data.messages.length) {
        for (const m of messagesRes.data.messages) {
          const mail = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata' });
          const subjectHeader = mail.data.payload.headers.find(h => h.name === 'Subject');
          const dateHeader = mail.data.payload.headers.find(h => h.name === 'Date');
          let dateStr = '';
          if (dateHeader) {
            const d = new Date(dateHeader.value);
            if (!isNaN(d.getTime())) dateStr = d.toISOString();
          }
          const fromHeader = mail.data.payload.headers.find(h => h.name === 'From');
          const labelIds = mail.data.labelIds || [];
          emails.push({
            id: m.id,
            subject: subjectHeader ? subjectHeader.value : '(Sans sujet)',
            labelIds,
            snippet: mail.data.snippet,
            dateStr,
            isUnread: labelIds.includes('UNREAD'),
            from: fromHeader ? fromHeader.value : ''
          });
        }
      }

      // 4) Stats (même logique que /generate-report)
      const CATEGORY_MAP = {
        CATEGORY_PERSONAL: "Principale",
        CATEGORY_PROMOTIONS: "Promotions",
        CATEGORY_UPDATES: "Notifications",
        CATEGORY_SOCIAL: "Réseaux sociaux",
        CATEGORY_FORUMS: "Forums"
      };
      const total = emails.length;
      const unread = emails.filter(m => m.isUnread).length;
      const read = total - unread;
      const perLabel = {};
      for (const [cat, label] of Object.entries(CATEGORY_MAP)) {
        const mails = emails.filter(m => m.labelIds?.includes(cat));
        perLabel[label] = {
          total: mails.length,
          read: mails.filter(m => !m.isUnread).length,
          unread: mails.filter(m => m.isUnread).length
        };
      }
      const stats = { total, read, unread, perLabel };

      // 5) Génère HTML et enregistre fichier tokenisé
      const token = generateToken(email);
      const html = generateReportHtml({
        date,
        userEmail: email || "Non identifié",
        emails,
        generatedAt: new Date().toLocaleString('fr-FR'),
        options: { onlyUnread, groupByLabel },
        stats
      });

      if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
      const htmlPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
      const styledHtml = html.replace(
        '</head>',
        `<style>
          .container {
            background: white;
            padding: 40px 48px;
            border-radius: 12px;
            box-shadow: 0 4px 24px #0002;
            margin: 32px auto;
            max-width: 1200px;
          }
        </style></head>`
      );
      fs.writeFileSync(htmlPath, styledHtml, 'utf-8');

      // 6) Envoi email avec CTA et lien /show-report/:token (pas de session nécessaire)
      const apiBase = process.env.API_BASE_URL || 'http://localhost:4000';
      const frontendBase = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
      const headerHtml = buildEmailHeaderBlock(frontendBase, apiBase, token);
      const finalHtml = headerHtml + html;

      const safeSubject = `Résumé Gmail – ${new Date().toLocaleDateString('fr-FR')}`;
      const messageParts = [
        `To: ${email}`,
        'Content-Type: text/html; charset=utf-8',
        `Subject: ${encodeSubject(safeSubject)}`,
        '',
        finalHtml
      ];

      const message = messageParts.join('\n');
      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage }
      });

      user.lastRun = new Date().toISOString();
      triggered.push(email);
      results.push({ email, sent: true, count: total, token });
    } catch (err) {
      console.error(`❌ Erreur automation pour ${user.email}:`, err);
      results.push({ email: user.email, error: err.message });
    }
  }

  // 7) Persistance lastRun
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2));

  res.json({
    ok: true,
    triggered,
    results
  });
});

// ====== INTERNAL SCHEDULER (optional) ======
// Enabled when INTERNAL_CRON_ENABLED === 'true' (default: off)
// It checks automated-users.json every 60s and triggers the same logic as /run-cron for due users.
async function performAutomationForUser(user) {
  try {
    const oauth2 = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      process.env.REDIRECT_URI
    );
    oauth2.setCredentials(user.tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2 });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const email = profile.data.emailAddress || user.email;

    const date = new Date().toISOString().slice(0, 10);
    const onlyUnread = false;
    const groupByLabel = true;
    let query = `after:${Math.floor(new Date(date).getTime() / 1000)} newer_than:1d`;
    if (onlyUnread) query += ' is:unread';

    const messagesRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50,
      q: query
    });

    const emails = [];
    if (messagesRes.data.messages && messagesRes.data.messages.length) {
      for (const m of messagesRes.data.messages) {
        const mail = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata' });
        const subjectHeader = mail.data.payload.headers.find(h => h.name === 'Subject');
        const dateHeader = mail.data.payload.headers.find(h => h.name === 'Date');
        let dateStr = '';
        if (dateHeader) {
          const d = new Date(dateHeader.value);
          if (!isNaN(d.getTime())) dateStr = d.toISOString();
        }
        const fromHeader = mail.data.payload.headers.find(h => h.name === 'From');
        const labelIds = mail.data.labelIds || [];
        emails.push({
          id: m.id,
          subject: subjectHeader ? subjectHeader.value : '(Sans sujet)',
          labelIds,
          snippet: mail.data.snippet,
          dateStr,
          isUnread: labelIds.includes('UNREAD'),
          from: fromHeader ? fromHeader.value : ''
        });
      }
    }

    // Stats
    const CATEGORY_MAP = {
      CATEGORY_PERSONAL: "Principale",
      CATEGORY_PROMOTIONS: "Promotions",
      CATEGORY_UPDATES: "Notifications",
      CATEGORY_SOCIAL: "Réseaux sociaux",
      CATEGORY_FORUMS: "Forums"
    };
    const total = emails.length;
    const unread = emails.filter(m => m.isUnread).length;
    const read = total - unread;
    const perLabel = {};
    for (const [cat, label] of Object.entries(CATEGORY_MAP)) {
      const mails = emails.filter(m => m.labelIds?.includes(cat));
      perLabel[label] = {
        total: mails.length,
        read: mails.filter(m => !m.isUnread).length,
        unread: mails.filter(m => m.isUnread).length
      };
    }
    const stats = { total, read, unread, perLabel };

    // Génère et stocke le HTML (tokenisé)
    const token = generateToken(email);
    const html = generateReportHtml({
      date,
      userEmail: email || "Non identifié",
      emails,
      generatedAt: new Date().toLocaleString('fr-FR'),
      options: { onlyUnread, groupByLabel },
      stats
    });
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const htmlPath = path.join(REPORTS_DIR, `last-rendered-report-${token}.html`);
    const styledHtml = html.replace(
      '</head>',
      `<style>
        .container {
          background: white;
          padding: 40px 48px;
          border-radius: 12px;
          box-shadow: 0 4px 24px #0002;
          margin: 32px auto;
          max-width: 1200px;
        }
      </style></head>`
    );
    fs.writeFileSync(htmlPath, styledHtml, 'utf-8');

    // Envoi email
    const apiBase = process.env.API_BASE_URL || 'http://localhost:4000';
    const frontendBase = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';
    const headerHtml = buildEmailHeaderBlock(frontendBase, apiBase, token);
    const finalHtml = headerHtml + html;
    const safeSubject = `Résumé Gmail – ${new Date().toLocaleDateString('fr-FR')}`;
    const messageParts = [
      `To: ${email}`,
      'Content-Type: text/html; charset=utf-8',
      `Subject: ${encodeSubject(safeSubject)}`,
      '',
      finalHtml
    ];
    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });

    // Si OK, retourne info et laisse l'appelant persister lastRun
    return { ok: true, email, token, count: total };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ====== Internal-cron runtime guards & options ======
// Option: don't persist lastRun to disk in dev to avoid any watcher side-effects.
const PERSIST_LASTRUN = process.env.INTERNAL_CRON_PERSIST_LASTRUN === 'true';
// Keep an in-memory map of lastRun to avoid disk writes if desired.
const inMemoryLastRun = new Map(); // email -> ISO string
// Prevent overlapping ticks (a slow Gmail call could otherwise overlap the next interval)
let internalCronRunning = false;

async function runInternalCronTick() {
  if (internalCronRunning) {
    console.log('⏱️ [internal-cron] tick skipped (already running)');
    return;
  }
  internalCronRunning = true;
  try {
    const filePath = path.resolve('./automated-users.json');
    if (!fs.existsSync(filePath)) return; // rien à faire
    const users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // If we stored more recent lastRun values in memory, hydrate them here
    for (const u of users) {
      if (inMemoryLastRun.has(u.email)) {
        u.lastRun = inMemoryLastRun.get(u.email);
      }
    }
    const now = Date.now();
    let updated = false;
    const logs = [];

    for (const user of users) {
      const effectiveLastRun = inMemoryLastRun.get(user.email) || user.lastRun;
      const last = effectiveLastRun ? new Date(effectiveLastRun).getTime() : 0;
      const due = (now - last) >= (user.frequencyMinutes * 60 * 1000);
      if (!due) {
        logs.push({ email: user.email, due: false });
        continue;
      }
      const result = await performAutomationForUser(user);
      if (result.ok) {
        user.lastRun = new Date().toISOString();
        updated = true;
        inMemoryLastRun.set(user.email, user.lastRun);
        logs.push({ email: user.email, due: true, sent: true, count: result.count, token: result.token });
      } else {
        logs.push({ email: user.email, due: true, sent: false, error: result.error });
      }
    }

    if (updated) {
      if (PERSIST_LASTRUN) {
        const filePath = path.resolve('./automated-users.json');
        fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
      } else {
        console.log('💾 [internal-cron] lastRun mis à jour en mémoire (pas d\'écriture disque en dev).');
      }
    }
    if (logs.length) {
      console.log('⏱️ [internal-cron]', JSON.stringify(logs));
    }
  } catch (e) {
    console.error('❌ [internal-cron] tick error:', e);
  } finally {
    internalCronRunning = false;
  }
}

if (process.env.INTERNAL_CRON_ENABLED === 'true') {
  console.log('⏱️ Internal cron enabled — tick every 60s');
  setInterval(runInternalCronTick, 60 * 1000);
  // Run one immediate tick on startup
  setTimeout(runInternalCronTick, 5 * 1000);
} else {
  console.log('⏸️ Internal cron disabled (set INTERNAL_CRON_ENABLED=true to enable)');
}
// ====== END INTERNAL SCHEDULER ======

app.post('/report-pdf-server', async (req, res) => {
  const { emails, date, userEmail, stats, onlyUnread } = req.body;

  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: "Emails manquants ou mal formatés." });
  }

  try {
    const html = generatePdfHtml({ date, userEmail, emails, stats, onlyUnread });

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });

    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="rapport-gmail.pdf"',
    });

    res.end(pdfBuffer);
  } catch (err) {
    console.error("❌ Erreur PDF Server:", err);
    res.status(500).json({ error: "Erreur serveur lors de la génération du PDF." });
  }
});



app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Erreur de déconnexion :', err);
      return res.status(500).send('Erreur lors de la déconnexion');
    }
    res.send('✅ Session supprimée, vous pouvez vous reconnecter.');
  });
});



// ===== Build/Deploy info (for Render visibility) =====
const BUILD_INFO = {
  branch: process.env.RENDER_GIT_BRANCH || process.env.GIT_BRANCH || null,
  commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || null
};

// Health/version endpoint to verify deployed code
app.get('/_version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, branch: BUILD_INFO.branch, commit: BUILD_INFO.commit, pid: process.pid, now: new Date().toISOString() });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('✅ API listening on', PORT);
  console.log('🧱 Build info:', BUILD_INFO);
}); // ne PAS fixer 'localhost' ici

process.on('uncaughtException', (err) => {
  console.error('❗ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❗ Unhandled Rejection:', reason);
});

console.log('🎯 Route=== Serveur prêt ===');

// Fonction utilitaire pour envoyer un email (mock simple utilisant nodemailer ou gmail API)
async function sendMail({ to, subject, html }) {
  // Ici, tu pourrais brancher la logique Gmail API d'envoi, ou nodemailer en dev
  // Pour l'exemple, on ne fait rien (ou log).
  // console.log(`[MOCK] Envoi mail à ${to}: ${subject}\n${html}`);
  // Pour production, il faudrait utiliser la même logique que /send-report.
  // On laisse vide pour l'instant.
}

// Fonction pour générer le HTML de l'email contenant le lien de rapport
function buildEmailHtml(reportUrl) {
  return `
    <div style="font-family:Arial, Helvetica, sans-serif; padding:24px; line-height:1.45; color:#1f2937;">
      <h2 style="margin:0 0 12px 0; color:#111827;">Votre rapport Gmail est prêt ✉️</h2>
      <p style="margin:0 0 16px 0; color:#374151;">Cliquez sur le bouton ci‑dessous pour l’ouvrir dans votre navigateur.</p>
      <p style="margin:16px 0;">
        <a href="${reportUrl}" target="_blank" style="display:inline-block; padding:12px 20px; background:#1a73e8; color:#ffffff; text-decoration:none; border-radius:8px; font-weight:700;">
          📄 Voir le résumé dans le navigateur
        </a>
      </p>
      <p style="margin:18px 0 0 0; font-size:12px; color:#6b7280;">
        Si le bouton ne fonctionne pas, copiez/collez ce lien dans votre navigateur :<br>
        <span style="word-break:break-all; color:#1d4ed8;">${reportUrl}</span>
      </p>
    </div>
  `;
}