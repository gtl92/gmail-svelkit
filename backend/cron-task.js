import { google } from 'googleapis';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { generateReportHtml } from './report.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_PATH = path.join(__dirname, 'automated-users.json');


const isDryRun = process.argv.includes('--dry-run');
const userFilterArg = process.argv.find(arg => arg.startsWith('--user='));
const filteredEmail = userFilterArg ? userFilterArg.split('=')[1] : null;

let envFile = '.env';
if (process.env.NODE_ENV === 'production') {
  envFile = '.env.production';
} else if (process.env.NODE_ENV === 'test') {
  envFile = '.env.test';
}
dotenv.config({ path: path.resolve(__dirname, envFile) });


export async function runCronTask() {
  console.log("🚀 Lancement de la tâche Gmail…");

  if (!fs.existsSync(USERS_PATH)) {
    console.log("❌ Aucun fichier automated-users.json trouvé.");
    return;
  }

  let allUsers = JSON.parse(fs.readFileSync(USERS_PATH, 'utf-8'));
  // Nettoyage : on ne garde que les utilisateurs valides
  allUsers = allUsers.filter(u => u.tokens && u.email && u.frequencyMinutes);
  // Suppression automatique des utilisateurs inactifs depuis plus de 30 jours
  const THIRTY_DAYS_AGO = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const initialUserCount = allUsers.length;
  const removedUsers = [];
  allUsers = allUsers.filter(u => {
    if (!u.lastRun) return true;
    const last = new Date(u.lastRun);
    const keep = isNaN(last) || last.getTime() > THIRTY_DAYS_AGO;
    if (!keep) {
      console.log(`🗑 Suppression utilisateur inactif depuis +30 jours : ${u.email}`);
      removedUsers.push({ email: u.email, lastRun: u.lastRun });
    }
    return keep;
  });
  if (removedUsers.length > 0) {
    const logPath = path.join(__dirname, 'logs');
    const logFile = path.join(logPath, 'archived-users.log');
    if (!fs.existsSync(logPath)) fs.mkdirSync(logPath);
    const logData = removedUsers.map(u => `${new Date().toISOString()} - ${u.email} (lastRun: ${u.lastRun})`).join('\n') + '\n';
    fs.appendFileSync(logFile, logData, 'utf-8');
  }
  let users = filteredEmail
    ? allUsers.filter(u => u.email === filteredEmail)
    : allUsers;

  if (filteredEmail && users.length === 0) {
    console.warn(`❌ Aucun utilisateur trouvé pour ${filteredEmail}`);
    return;
  }
  const now = new Date();

  for (const user of users) {
    console.log("──────────────────────────────────────────────");
    console.log(`📧 Traitement utilisateur : ${user.email}`);

    const lastRun = user.lastRun ? new Date(user.lastRun) : null;
    const elapsedMinutes = lastRun ? (now - lastRun) / 60000 : Infinity;

    if (elapsedMinutes < user.frequencyMinutes) {
      console.log(`⏭ ${user.email} : attente (${elapsedMinutes.toFixed(1)} min écoulées)`);
      continue;
    }

    console.log(`▶ ${user.email} : exécution (fréquence ${user.frequencyMinutes} min)`);

    const oauth2Client = new google.auth.OAuth2(
      process.env.CLIENT_ID,
      process.env.CLIENT_SECRET,
      process.env.REDIRECT_URI
    );
    oauth2Client.setCredentials(user.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    let userEmailAddress = user.email;
    try {
      const profileRes = await gmail.users.getProfile({ userId: 'me' });
      if (profileRes.data.emailAddress) {
        userEmailAddress = profileRes.data.emailAddress;
      }
    } catch (err) {
      console.warn(`⚠ ${user.email} : impossible de récupérer l'adresse email`);
    }

    const date = new Date();
    const query = `after:${Math.floor(date.setHours(0, 0, 0, 0) / 1000)}`;

    const messagesRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 50,
      q: query
    });

    const emails = [];
    if (messagesRes.data.messages) {
      for (const m of messagesRes.data.messages) {
        try {
          const mail = await gmail.users.messages.get({
            userId: 'me',
            id: m.id,
            format: 'metadata'
          });

          const subjectHeader = mail.data.payload.headers.find(h => h.name === 'Subject');
          const dateHeader = mail.data.payload.headers.find(h => h.name === 'Date');
          const fromHeader = mail.data.payload.headers.find(h => h.name === 'From');

          let dateStr = '';
          if (dateHeader) {
            const d = new Date(dateHeader.value);
            if (!isNaN(d.getTime())) {
              dateStr = d.toISOString();
            }
          }

          emails.push({
            id: m.id,
            subject: subjectHeader ? subjectHeader.value : '(Sans sujet)',
            labelIds: mail.data.labelIds,
            snippet: mail.data.snippet,
            dateStr,
            isUnread: mail.data.labelIds.includes('UNREAD'),
            from: fromHeader ? fromHeader.value : ''
          });
        } catch (e) {
          console.warn(`❌ Erreur récupération message ${m.id} pour ${user.email}`);
        }
      }
    }

    console.log(`📬 ${emails.length} emails pour ${user.email}`);

    const total = emails.length;
    const unread = emails.filter(m => m.isUnread).length;
    const read = total - unread;
    const perLabel = {};

    const CATEGORY_MAP = {
      CATEGORY_PERSONAL: "Principale",
      CATEGORY_PROMOTIONS: "Promotions",
      CATEGORY_UPDATES: "Notifications",
      CATEGORY_SOCIAL: "Réseaux sociaux",
      CATEGORY_FORUMS: "Forums"
    };

    for (const [cat, label] of Object.entries(CATEGORY_MAP)) {
      const mails = emails.filter(m => m.labelIds?.includes(cat));
      perLabel[label] = {
        total: mails.length,
        read: mails.filter(m => !m.isUnread).length,
        unread: mails.filter(m => m.isUnread).length
      };
    }

    const html = generateReportHtml({
      date: new Date().toISOString().split('T')[0],
      userEmail: userEmailAddress,
      emails,
      generatedAt: now.toLocaleString('fr-FR'),
      options: { onlyUnread: false, groupByLabel: true },
      stats: { total, read, unread, perLabel }
    });

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn(`⚠ SMTP non configuré. Rapport non envoyé pour ${user.email}`);
      continue;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.example.com",
      port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || "user@example.com",
        pass: process.env.SMTP_PASS || "password"
      }
    });

    await transporter.verify();
    console.log(`✅ SMTP prêt pour ${user.email}, envoi du rapport...`);

    
    if (isDryRun) {
      console.log(`🧪 [Dry-run] Envoi du rapport ignoré pour ${user.email}`);
    } else {
      await transporter.sendMail({
        from: `"Rapport Gmail" <${process.env.SMTP_USER || "user@example.com"}>`,
        to: process.env.REPORT_RECIPIENT || user.email,
        subject: "Résumé Gmail Automatique",
        html
      });
      console.log(`✅ Rapport envoyé à ${user.email}`);
    }
    user.lastRun = now.toISOString();
    console.log(`📆 Dernier envoi enregistré : ${user.lastRun}`);
  }

  console.log(`📊 Utilisateurs initiaux : ${initialUserCount}, actifs : ${users.length}, supprimés : ${initialUserCount - users.length}`);
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCronTask().catch(err => {
    console.error("❌ Erreur:", err);
  });
}