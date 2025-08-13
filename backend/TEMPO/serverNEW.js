import express from 'express';
import session from 'express-session';         // <-- AJOUT
import cors from 'cors';
import { google } from 'googleapis';
import puppeteer from 'puppeteer';

import fs from 'fs';

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Choisir .env ou .env.production ou .env.test selon l'environnement
let envFile = '.env';
if (process.env.NODE_ENV === 'production') {
  envFile = '.env.production';
} else if (process.env.NODE_ENV === 'test') {
  envFile = '.env.test';
}
dotenv.config({ path: path.resolve(__dirname, envFile) });


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

function wrapReportHtml(reportHtml, viewUrl, appUrl) {
  return `
    <div class="container" style="
      background: white;
      padding: 40px 48px;
      border-radius: 12px;
      box-shadow: 0 4px 24px #0002;
      margin: 32px auto;
      max-width: 1200px;
    ">
      <table style="width:100%;border-collapse:collapse;margin-bottom:40px;">
        <tr>
          <td style="width:50%;text-align:center;padding:16px;">
            <a href="${viewUrl}" target="_blank" style="
              display:inline-block;
              padding:14px 22px;
              background:#2196F3;
              color:white;
              text-decoration:none;
              border-radius:6px;
              font-weight:600;
              font-size:16px;
            ">Voir le résumé dans le navigateur</a>
            <div style="margin-top:8px;font-size:12px;color:#666;">
              (Pour un affichage parfait sur tous les supports, utilisez l’un des boutons ci-dessus.)
            </div>
          </td>
          <td style="width:50%;text-align:center;padding:16px;">
            <a href="${appUrl}" target="_blank" style="
              display:inline-block;
              padding:14px 22px;
              background:#9C27B0;
              color:white;
              text-decoration:none;
              border-radius:6px;
              font-weight:600;
              font-size:16px;
            ">Ouvrir l’application</a>
          </td>
        </tr>
      </table>
      ${reportHtml}
    </div>
  `;
}


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
    th { background-color: #f5f5f5; }
  </style>
`;

  let pdfButtonHtml = '';
  // if (typeof lastReport !== "undefined") {
  //   pdfButtonHtml = `
  //   <div style="margin:24px 0;">
  //     <a href="${process.env.API_BASE_URL || 'http://localhost:4000'}/report-pdf" target="_blank" style="
  //       display:inline-block;
  //       padding:10px 16px;
  //       background:#43a047;
  //       color:white;
  //       text-decoration:none;
  //       border-radius:6px;
  //       font-weight:600;
  //     ">📄 Télécharger en PDF</a>
  //   </div>
  //   `;
  // }
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        ${headStyles}
        <title>Rapport Gmail</title>
      </head>
      <body>
        <div>
        ${responsiveStyles}
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

function buildEmailHeaderBlock(frontendBase, apiBase) {
  const appUrl = frontendBase || 'http://localhost:5173';
  const apiUrl = apiBase || 'http://localhost:4000';
  const automationUrl = `${appUrl}/automation`;
  const showLastUrl = `${apiUrl}/show-last-report`;
  const pdfUrl = `${apiUrl}/report-pdf`;

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
// Exemple d’API pour servir le dernier rapport généré
let lastReport = null; // Variable globale ou stockée en session/bdd

const app = express();
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

// Cette route doit apparaître avant express.json()
app.get('/report-pdf', async (req, res) => {
  if (!lastReport || !lastReport.html) return res.status(404).send('Aucun rapport');
  console.log("➡️ PDF Request → lastReport HTML length:", lastReport.html.length);

  try {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    console.log("➡️ Puppeteer lancé");

    await page.setContent(lastReport.html, { waitUntil: 'networkidle0' });
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
//      'Content-Disposition': 'inline; filename="rapport-gmail.pdf"',
    res.set({
      'Content-Type': 'application/pdf',
//      'Content-Disposition': 'attachment; filename="rapport-gmail.pdf"',
      'Content-Disposition': 'inline; filename="rapport-gmail.pdf"',
      'Content-Length': pdfBuffer.length
    });

    // res.send(pdfBuffer);
    // NE PAS faire res.send(pdfBuffer) ici !
    res.end(pdfBuffer);
    console.log("✅ PDF envoyé au client.");
  } catch (err) {
    console.error("❌ Erreur lors de la génération du PDF:", err);
    res.status(500).send('Erreur serveur lors de la génération du PDF');
  }
});
app.use(express.json());

app.use(session({
  // Use env var for session secret, fallback for dev
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    sameSite: 'lax'
  }
}));

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
// Pour stocker l’état des jobs en mémoire (simple)
const jobs = {};

app.post('/generate-report', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Non authentifié' });
  // Génère un jobId unique
  const jobId = Date.now().toString() + Math.floor(Math.random() * 10000);
  jobs[jobId] = { progress: 0, result: null };

  // Démarre le "traitement" asynchrone simulé
  (async () => {
    let emails = [];
    let result, html;

    try {
      const { date, onlyUnread, groupByLabel } = req.body;
      oauth2Client.setCredentials(req.session.tokens);
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      let query = `after:${Math.floor(new Date(date).getTime() / 1000)}`;
      if (onlyUnread) query += ' is:unread';

      jobs[jobId].progress = 10;
      await new Promise(r => setTimeout(r, 400)); // <-- simulate loading

      const messagesRes = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 50,
        q: query
      });

      jobs[jobId].progress = 30;
      await new Promise(r => setTimeout(r, 400)); // <-- simulate loading

      if (messagesRes.data.messages) {
          for (const m of messagesRes.data.messages) {
            const mail = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata' });
            const subjectHeader = mail.data.payload.headers.find(h => h.name === 'Subject');
            // Ajoute la récupération de la date
            const dateHeader = mail.data.payload.headers.find(h => h.name === 'Date');
            let dateStr = '';
            if (dateHeader) {
              // La date header Gmail est typiquement sous forme RFC822 (lun., 05 août 2024 15:08:53 +0200)
              const d = new Date(dateHeader.value);
              if (!isNaN(d.getTime())) {
                dateStr = d.toISOString();
              }
            }
            const fromHeader = mail.data.payload.headers.find(h => h.name === 'From');
            emails.push({
              id: m.id,
              subject: subjectHeader ? subjectHeader.value : '(Sans sujet)',
              labelIds: mail.data.labelIds,
              snippet: mail.data.snippet,
              dateStr, 
              isUnread: mail.data.labelIds.includes('UNREAD'),
              from: fromHeader ? fromHeader.value : '' // <--- AJOUT
            });
          }
      }
      jobs[jobId].progress = 60;
      await new Promise(r => setTimeout(r, 400)); // <-- simulate loading

      if (groupByLabel) {
        result = emails.reduce((acc, mail) => {
          mail.labelIds.forEach(label => {
            acc[label] = acc[label] || [];
            acc[label].push(mail);
          });
          return acc;
        }, {});
      } else {
        result = emails;
      }

      jobs[jobId].progress = 90;
      await new Promise(r => setTimeout(r, 400)); // <-- simulate loading

      const total = emails.length;
      const unread = emails.filter(m => m.isUnread).length;
      const read = total - unread;
      // Statistiques détaillées par label
      const perLabel = {};
      for (const [cat, label] of Object.entries(CATEGORY_MAP)) {
        const mails = emails.filter(m => m.labelIds?.includes(cat));
        perLabel[label] = {
          total: mails.length,
          read: mails.filter(m => !m.isUnread).length,
          unread: mails.filter(m => m.isUnread).length
        };
      }
      // html = `<b>Rapport Gmail</b><ul>${emails.map(m => `<li>${m.subject}</li>`).join('')}</ul>`;
      html = generateReportHtml({
        date,
        userEmail: req.session.email || "Non identifié",
        emails,
        generatedAt: new Date().toLocaleString('fr-FR'),
        options: { onlyUnread, groupByLabel },
        stats: { total, read, unread, perLabel },
        lastReport // Ajoute cet argument pour signaler la présence de lastReport
      });
      jobs[jobId].progress = 100;
      jobs[jobId].result = { html, json: result, count: emails.length };
      lastReport = { html, json: result, count: emails.length };
    } catch (err) {
      jobs[jobId].progress = -1; // -1 = erreur
      jobs[jobId].result = { error: err.message };
    }
  })();

  // Répond tout de suite avec le jobId
  res.json({ success: true, jobId });    
});


app.post('/get-report-progress', (req, res) => {
  const { jobId } = req.body;
  const job = jobs[jobId];
  // For debug  console.log('Polling job:', jobId, job); // ← ajoute ce log !
  // Si le job n'existe pas, renvoie 0% de progression
  // (le job peut ne pas exister si le client a pollé trop tôt)
  // ou si le job a été supprimé après son achèvement
  if (!job) return res.json({ progress: 0 });
  // Si fini (progress 100), envoie aussi le résultat
  res.json({
    progress: job.progress,
    result: job.progress === 100 ? job.result.html : null
  });
});


app.get('/last-report', (req, res) => {
  if (!lastReport) {
    return res.status(404).json({ error: "Aucun rapport généré" });
  }
  res.json(lastReport); // ou res.send(lastReport.html) si tu veux afficher l’HTML directement
});

app.get('/show-last-report', (req, res) => {
  if (!lastReport || !lastReport.html) {
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
  if (!lastReport || !lastReport.html) {
    return res.status(404).send('<h3 style="font-family:Arial,sans-serif">Aucun rapport disponible</h3>');
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(lastReport.html);
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
  if (!lastReport) return res.status(400).json({ error: 'Aucun rapport à envoyer. Générez d’abord le rapport.' });
  try {
    const { to, subject, html } = req.body;

    // Build header block (CTA buttons) and compute final HTML
    const headerHtml = buildEmailHeaderBlock(process.env.FRONTEND_BASE_URL, process.env.API_BASE_URL);
    const contentHtml = html || (lastReport && lastReport.html) || '<p>(Aucun contenu de rapport disponible)</p>';
    const finalHtml = headerHtml + contentHtml;

    // Subject fallback
    const safeSubject = subject || `Résumé Gmail – ${new Date().toLocaleDateString('fr-FR')}`;

    // Recipient fallback
    const recipient = to || req.session.email;

    const messageParts = [
      `To: ${recipient}`,
      'Content-Type: text/html; charset=utf-8',
      `Subject: ${encodeSubject(safeSubject)}` ,
      '',
      finalHtml
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

    res.json({ success: true });
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
  if (!req.session.user) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  const { default: fs } = await import('fs');
  const { resolve } = await import('path');
  const filePath = resolve('./automated-users.json');

  if (!fs.existsSync(filePath)) {
    return res.json({ active: false });
  }

  const users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const currentUser = users.find(u => u.email === req.session.user.email);

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

  if (!req.session.tokens || !req.session.user) {
    return res.status(401).send('Non authentifié');
  }

  const { frequencyMinutes } = req.body;
  if (!frequencyMinutes || typeof frequencyMinutes !== 'number') {
    return res.status(400).send('Fréquence invalide');
  }

  const userEntry = {
    email: req.session.user.email,
    tokens: {
      access_token: req.session.tokens.access_token,
      refresh_token: req.session.tokens.refresh_token,
      scope: req.session.tokens.scope,
      token_type: req.session.tokens.token_type,
      expiry_date: req.session.tokens.expiry_date
    },
    frequencyMinutes,
    lastRun: null // jamais encore lancé
  };

  let users = [];
  if (fs.existsSync(filePath)) {
    users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    users = users.filter(u => u.email !== userEntry.email);
  }

  users.push(userEntry);
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
  res.send(`✅ Automatisation activée avec fréquence : ${frequencyMinutes} minutes`);
});


// ====== ROUTE POUR LANCER L'AUTOMATISATION VIA HTTP ======
app.get('/run-cron', async (req, res) => {
  const fs = await import('fs');
  const path = await import('path');
  const filePath = path.resolve('./automated-users.json');

  if (!req.query.key || req.query.key !== process.env.CRON_SECRET) {
    return res.status(403).send('Forbidden');
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Aucune automatisation trouvée');
  }

  const users = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const now = Date.now();
  const triggered = [];

  for (const user of users) {
    const last = user.lastRun ? new Date(user.lastRun).getTime() : 0;
    if (now - last < user.frequencyMinutes * 60 * 1000) {
      continue;
    }

    const { google } = await import('googleapis');
    const oauth2Client = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      process.env.REDIRECT_URI
    );
    oauth2Client.setCredentials(user.tokens);

    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const email = profile.data.emailAddress;

      const messages = await gmail.users.messages.list({
        userId: 'me',
        q: 'newer_than:1d',
        maxResults: 10
      });

      const reportHtml = `
<div style="font-family:Arial,sans-serif;padding:24px;">
  <h2 style="color:#2c3e50;">📬 Rapport automatique Gmail</h2>
  <p>Bonjour,</p>
  <p>Voici le résumé automatique pour <b>${email}</b> :</p>
  <ul>
    <li><b>${messages.data.resultSizeEstimate}</b> messages reçus au cours des dernières 24h.</li>
  </ul>

  <div style="display:flex;flex-wrap:wrap;gap:12px;margin:24px 0;">
    <a href="${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}" style="padding:12px 18px;background:#1e88e5;color:white;border-radius:6px;text-decoration:none;font-weight:bold;">
      Voir le résumé dans le navigateur
    </a>
    <a href="${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/automation" style="padding:12px 18px;background:#9c27b0;color:white;border-radius:6px;text-decoration:none;font-weight:bold;">
      Interface de génération
    </a>
    <a href="${process.env.API_BASE_URL || 'http://localhost:4000'}/report-pdf" style="padding:12px 18px;background:#43a047;color:white;border-radius:6px;text-decoration:none;font-weight:bold;">
      📄 Ouvrir le rapport PDF
    </a>
  </div>

  <p style="font-size:0.9em;color:#888;">Envoyé automatiquement par Gmail Résumé.</p>
</div>
`;

      const raw = Buffer.from([
        `To: ${email}`,
        'Content-Type: text/html; charset=utf-8',
        `Subject: Rapport Gmail automatique`,
        '',
        reportHtml
      ].join('\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw }
      });

      user.lastRun = new Date().toISOString();
      triggered.push(email);
    } catch (err) {
      console.error(`❌ Erreur pour ${user.email}: ${err.message}`);
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
  res.send(`✅ Tâche cron terminée. Utilisateurs traités: ${triggered.join(', ')}`);
});

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



const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});