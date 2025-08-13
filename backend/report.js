


// Generate an HTML summary for a Gmail report
export function generateReportHtml({ date, userEmail, emails, generatedAt, options, stats }) {
  const { total, read, unread, perLabel } = stats;

  let html = `
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Résumé Gmail</title>
    </head>
    <body>
      <h1>Résumé Gmail du ${date}</h1>
      <p>Utilisateur : ${userEmail}</p>
      <p>Généré le : ${generatedAt}</p>
      <p>Total : ${total} | Lus : ${read} | Non lus : ${unread}</p>
  `;

  if (options.groupByLabel && perLabel) {
    html += '<h2>Par catégorie</h2><ul>';
    for (const [label, val] of Object.entries(perLabel)) {
      html += `<li><strong>${label}</strong> : ${val.total} (lus: ${val.read}, non lus: ${val.unread})</li>`;
    }
    html += '</ul>';
  }

  html += '<h2>Détails des messages</h2><ul>';
  for (const mail of emails) {
    html += `<li><strong>${mail.subject}</strong> - ${mail.dateStr || 'Date inconnue'}<br>${mail.snippet}</li>`;
  }
  html += `
      </ul>
    </body>
    </html>
  `;

  return html;
}
