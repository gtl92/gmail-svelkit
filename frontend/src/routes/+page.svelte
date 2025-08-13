<script context="module" lang="ts">
	declare const Metro: any;
</script>
<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';

let html2pdfLib: any = null;
let hasReport = false;
let lastGenOptions = '';

$: {
  const currentOpts = JSON.stringify({date, onlyUnread, groupByLabel});
  if (lastGenOptions && currentOpts !== lastGenOptions) {
    hasReport = false;
  }
}
	// Détecte l'environnement
let isLocal = false;
if (typeof window !== 'undefined') {
  isLocal =
    window.location.hostname === 'localhost' ||
    window.location.hostname.startsWith('127.') ||
    window.location.hostname.endsWith('.local');
}

// const API_BASE = import.meta.env.VITE_API_BASE || (isLocal ? 'http://localhost:4000' : '/proxy-gmail.php');
const API_BASE = import.meta.env.VITE_API_BASE;
function apiUrl(action: string) {
  return isLocal ? `${API_BASE}/${action}` : `${API_BASE}?action=${action}`;
}

// Fonction utilitaire globale pour tester Metro.activity
function isMetroReady(): boolean {
  return typeof window !== 'undefined' && typeof Metro !== 'undefined' && typeof Metro.activity === 'object';
}

let count = null;

// Effet réactif : s’exécute à chaque fois que isConnected passe à true
$: if (isConnected && date && !blocageUI && onlyUnread !== undefined) {
  countEmails();
}

	let authRequested = false;
	let isAuthChecked = false;
	let authError = '';
	let blocageUI = true;
	let blocageRaison: string = '';
	let blocageMsg = '';
	let authUrl = '';
	let onlyUnread = true;
	let groupByLabel = true;
	let isGenerating = false;
	let progress = 0;
	let statusMsg = '';
	let date = new Date().toISOString().slice(0, 10);
	let deconnexionStatus = ''; // Nouveau pour l'affichage du message

	let reportUrl = '';

	let mailCount: number | null = null;
	let mailCountLoading = false;
	let mailCountError = '';

	let showLastReport = false;
	let lastReportHtml = '';
	let lastReportError = '';

	let charmsRef: HTMLElement | null = null;
	function closeCharms() {
		if (window.Metro && window.Metro.charms && charmsRef) {
			window.Metro.charms.close(charmsRef);
		}
	}
	function toggleCharms() {
		if (window.Metro && window.Metro.charms && charmsRef) {
			window.Metro.charms.toggle(charmsRef);
		}
	}

	let showDialog = false;
	
	let mainUserEmail = '...';

	// Automatisation
	let freq = '';
	let xhours = '1';
	let xminutes = '1';
	let autoStatus = '';
	let runNowLoading = false;
	let runNowStatus = '';
	let automationActive = false;

	let metroReady = false;

	let isConnected = false; // <= Déplacé ici

	// ———— Initialisation Svelte
	onMount(async () => {
 const style = document.createElement('style');
  style.innerHTML = `
.activity-overlay {
  z-index: 9999 !important;
  position: fixed !important;
  top: 0;
  left: 0;
}
  `;
  document.head.appendChild(style);
    // 🚨 Crée le conteneur manuellement si absent
  if (!document.querySelector('[data-role="activity"]')) {
    const activityRoot = document.createElement('div');
    activityRoot.setAttribute('data-role', 'activity');
    document.body.appendChild(activityRoot);
  }

		html2pdfLib = (await import('html2pdf.js')).default;
		await checkAuth();
		// — Ajoute ce listener pour réagir au retour de l’utilisateur sur la page
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') {
				fetchAuthUrl();
			}
		});
	});


	async function checkAuth() {
		blocageUI = true;
		blocageRaison = 'connexion';
		await fetchAuthUrl();
		isAuthChecked = true;
	}

	// ----------- Auth Gmail
	async function fetchAuthUrl() {
		try {
			const res = await fetch(apiUrl('auth-url'), { credentials: "include" });
			const data = await res.json();
			if (data.email) {
				mainUserEmail = data.email;
				isConnected = true;
				authUrl = '';
				authError = '';
				blocageUI = false;
				blocageRaison = '';
				blocageMsg = '';
				await loadAutomation();       // ← ici
				updateAutomationStatus();     // ← ici aussi
			} else {
				mainUserEmail = '';
				isConnected = false;
				authUrl = data.url;
				authError = '';
				blocageUI = true;
				blocageRaison = 'connexion';
				blocageMsg = 'Connexion à Gmail requise';
			}
		} catch (e) {
			mainUserEmail = '';
			isConnected = false;
			authUrl = '';
			authError = 'Erreur de connexion à Gmail';
			blocageUI = true;
			blocageRaison = 'connexion';
			blocageMsg = 'Erreur de connexion à Gmail';
		}
		// ← ICI (à la toute fin de la fonction)
		console.log({ isConnected, blocageUI, mainUserEmail, authUrl });
	}

	// ———— Déconnexion
async function disconnectGmail() {
    deconnexionStatus = "Déconnexion en cours…";
    try {
        // Choix de l’URL (même logique que fetchAuthUrl)
        const url = isLocal
            ? 'http://localhost:4000/logout'
            : '/proxy-gmail.php?action=logout';
        const res = await fetch(url, {
            method: 'POST',
            credentials: 'include'
        });
        const data = await res.json();
        if (data.success) {
            deconnexionStatus = "Déconnexion réussie. Vous pouvez maintenant vous reconnecter.";
            setTimeout(() => {
                isConnected = false;
                mainUserEmail = '';
                blocageUI = true;
                blocageRaison = 'connexion';
                authUrl = '';
                deconnexionStatus = '';
                checkAuth();
            }, 2200);
        } else {
            deconnexionStatus = "Échec de la déconnexion.";
        }
    } catch (e) {
        deconnexionStatus = "Erreur réseau lors de la déconnexion.";
    }
}

	let statusType: 'idle' | 'loading' | 'success' | 'error' = 'idle';

async function generateReport() {
  if (blocageUI || isGenerating) return;
  isGenerating = true;
  blocageUI = true;
  blocageRaison = 'generation';
  statusType = 'loading';
  statusMsg = 'Génération du rapport...';
  progress = 0;
  let jobId = '';
  hasReport = false; // Réinitialise avant
  reportUrl = ''; // Réinitialise le lien du rapport

  try {
    // Lance le rapport (envoie à backend : date, options)
    const res = await fetch(apiUrl('generate-report'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, onlyUnread, groupByLabel })
    });
    let data;
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await res.json();
      reportUrl = data.reportUrl;
    } else {
      const text = await res.text();
      // Affiche dans la console pour debug !
      console.error("Réponse inattendue (HTML ?):", text);
      throw new Error("Erreur serveur: " + text);
    }
    if (!data.success || !data.jobId) {
      statusType = 'error';
      statusMsg = 'Erreur lors du lancement du rapport';
      throw new Error('JobID manquant');
    }
    jobId = data.jobId;

    // Polling toutes les 1s pour la progression
    let pollDone = false;
    while (!pollDone) {
      await new Promise(r => setTimeout(r, 1000));
      const pollRes = await fetch(apiUrl('get-report-progress') + (isLocal ? `?jobId=${jobId}` : ''), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }) // TOUJOURS envoyer le jobId en POST body
        // body: isLocal ? undefined : JSON.stringify({ jobId })
      });
      const pollData = await pollRes.json();
      progress = Number(pollData.progress || 0);
      if (pollData.progress >= 100) {
        pollDone = true;
        statusType = 'success';
        statusMsg = 'Rapport généré avec succès !';
        lastGenOptions = JSON.stringify({date, onlyUnread, groupByLabel});
        hasReport = true;  // <-- Ici !
        // Ajoute ceci si tu veux précharger le HTML :
        fetchLastReport();
        // stocke pollData.html ou pollData.result pour affichage
        // reportHtml = pollData.result;
      }
    }
  } catch (e) {
    statusType = 'error';
    statusMsg = 'Erreur lors de la génération: ' + (e instanceof Error ? e.message : e);
  } finally {
    isGenerating = false;
    blocageUI = false;
    blocageRaison = '';
    progress = 100;
  }
}

async function countEmails() {
  mailCount = null;
  mailCountError = '';
  mailCountLoading = true;

  try {
    if (!date) {
      mailCountLoading = false;
      return;
    }
    const params = new URLSearchParams({
      date,
      onlyUnread: onlyUnread ? 'true' : 'false'
    });
    const res = await fetch(apiUrl('count-emails') + (isLocal ? `?${params}` : ''), {
      credentials: 'include'
    });
    const data = await res.json();
    if (typeof data.count === 'number') {
      mailCount = data.count;
      mailCountError = '';
    } else {
      mailCount = null;
      mailCountError = 'Erreur de comptage';
    }
  } catch (e) {
    mailCount = null;
    mailCountError = 'Erreur de comptage';
  } finally {
    await tick(); // Pour permettre à Svelte de réagir au changement de variable
    mailCountLoading = false;
  }
}

	async function fetchLastReport() {
		lastReportHtml = '';
		lastReportError = '';
		try {
			const res = await fetch(apiUrl('last-report'), {
				credentials: 'include'
			});
			const data = await res.json();
			if (data.html) {
				lastReportHtml = data.html;
			} else {
				lastReportError = "Aucun rapport généré";
			}
		} catch (e) {
			lastReportError = "Erreur lors du chargement du rapport";
		}
	}

async function runAutomationNow() {
  if (blocageUI || isGenerating || runNowLoading) return;
  runNowLoading = true;
  runNowStatus = 'Lancement…';
  try {
    const res = await fetch(apiUrl('automation/run-now'), {
      method: 'POST',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'Échec du lancement');
    }
    // Marque qu'un rapport existe désormais (boutons activables)
    hasReport = true;
    // Construit un lien vers la visualisation du rapport
    const base = API_BASE;
    reportUrl = isLocal
      ? `${base}/show-report/${data.token}`
      : `${base}?action=show-report/${data.token}`;
    runNowStatus = `✅ Email envoyé (${data.count ?? 0} mails).`;
    if (window.Metro && window.Metro.toast) {
      window.Metro.toast.create('✅ Automatisation lancée — rapport envoyé', null, 3000, 'success');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    runNowStatus = '❌ Erreur: ' + msg;
    if (window.Metro && window.Metro.toast) {
      window.Metro.toast.create('❌ Erreur lors du lancement automatique', null, 4000, 'alert');
    }
  } finally {
    runNowLoading = false;
  }
}

// Désactiver l'automatisation
async function disableAutomation() {
  try {
    const res = await fetch(apiUrl('enable-automation'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false })
    });
    if (res.status === 401) {
      if (window.Metro && window.Metro.toast) {
        window.Metro.toast.create('Session expirée — veuillez vous reconnecter', null, 4000, 'alert');
      }
      return;
    }
    automationActive = false;
    freq = ''; // correspond à "Aucune"
    xhours = '1';
    xminutes = '1';
    autoStatus = '⏹ Automatisation désactivée';
    updateAutomationStatus();
    if (window.Metro && window.Metro.toast) {
      window.Metro.toast.create('⏹ Automatisation désactivée', null, 3000, 'alert');
    }
  } catch (e) {
    console.error('❌ Erreur désactivation automatisation:', e);
    if (window.Metro && window.Metro.toast) {
      window.Metro.toast.create('❌ Erreur lors de la désactivation', null, 4000, 'alert');
    }
  }
}
async function setAutomation() {
	autoStatus = 'Enregistrement en cours...';

	let frequencyMinutes = null;
	if (freq === 'daily') {
		frequencyMinutes = 1440;
	} else if (freq === 'xhours') {
		frequencyMinutes = parseInt(xhours || '1') * 60;
	} else if (freq === 'xminutes') {
		frequencyMinutes = parseInt(xminutes || '1');
	}

	const selectedFrequency = freq;
	// Si choix "Aucune", désactiver au lieu d'envoyer fréquence nulle
	if (selectedFrequency === '' || selectedFrequency === 'none' || !frequencyMinutes || frequencyMinutes <= 0) {
		return disableAutomation();
	}

	const payload = { frequency: freq, xhours, xminutes, frequencyMinutes };

	try {
		const res = await fetch(apiUrl('enable-automation'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify(payload)
		});
		const data = await res.text();
		console.log("Réponse backend:", data);
		if (res.ok) {
			updateAutomationStatus();
			automationActive = true;
			// Affiche une notification visuelle
			if (window.Metro && window.Metro.toast) {
				window.Metro.toast.create("✅ Automatisation activée", null, 3000, "success");
			}
		} else {
			autoStatus = 'Erreur lors de l’enregistrement';
		}
	} catch (e) {
		autoStatus = 'Erreur réseau';
	}
}



	let emailSendStatus = '';
	let destEmail = mainUserEmail;

	async function sendReportByEmail() {
	if (!/^[^@]+@[^@]+\.[^@]+$/.test(destEmail)) {
		emailSendStatus = 'Adresse invalide.';
		return;
	}
	emailSendStatus = 'Envoi…';

	// 1. Récupère le dernier rapport généré (HTML)
	let html = '';
	try {
		const res = await fetch(apiUrl('last-report'), {
		credentials: 'include'
		});
		const data = await res.json();
		html = data.html;
	} catch (e) {
		emailSendStatus = 'Impossible de récupérer le rapport.';
		return;
	}

	// 2. Envoie le mail via le backend
	try {
		const sendRes = await fetch(apiUrl('send-report'), {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			to: destEmail,
			subject: `Résumé Gmail du ${date}`,
			html
		})
		});
		const sendData = await sendRes.json();
		if (sendData.success) {
		emailSendStatus = 'Rapport envoyé à ' + destEmail;
		setTimeout(() => {
			showDialog = false;
			emailSendStatus = '';
			if (window.Metro && window.Metro.dialog) window.Metro.dialog.close('#emailDialog');
		}, 1200);
		} else {
		emailSendStatus = 'Erreur lors de l’envoi : ' + (sendData.error || '');
		}
	} catch (e) {
		emailSendStatus = 'Erreur réseau lors de l’envoi.';
	}
	}

	async function exportPDFServer() {
		if (!lastReportHtml) {
			alert("Aucun rapport disponible.");
			return;
		}

		// Affiche l'overlay d'activité avec animation CSS personnalisée
		const overlay = document.createElement('div');
		overlay.className = 'activity-overlay metro-activity';
		overlay.style.cssText = `
			position: fixed;
			top: 0; left: 0;
			width: 100vw;
			height: 100vh;
			background-color: rgba(255, 255, 255, 0.8);
			z-index: 9999;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 1.2em;
			font-weight: bold;
			color: #34495e;
		`;
		overlay.innerHTML = `
			<style>
				@keyframes spin {
					0% { transform: rotate(0deg); }
					100% { transform: rotate(360deg); }
				}
			</style>
			<div style="display:flex;flex-direction:column;align-items:center;gap:16px;">
				<div style="
					border: 6px solid #f3f3f3;
					border-top: 6px solid #3498db;
					border-radius: 50%;
					width: 48px;
					height: 48px;
					animation: spin 1s linear infinite;
				"></div>
				<div style="font-size:1.1em;">Génération du PDF en cours, patientez ...</div>
			</div>
		`;
		document.body.appendChild(overlay);

		try {
			const res = await fetch(apiUrl('last-report'), {
				credentials: 'include'
			});
			const data = await res.json();

			if (!data || !data.json || !data.html) {
				alert("Données de rapport incomplètes.");
				const existingOverlay = document.querySelector('.activity-overlay');
				if (existingOverlay) existingOverlay.remove();
				return;
			}
			let emails: any[] = [];
			const raw = data.json;

			if (Array.isArray(raw)) {
				emails = raw;
			} else if (typeof raw === 'object' && raw !== null) {
				emails = Object.values(raw).flat();
			} else {
				alert("Format des emails inconnu ou invalide.");
				const existingOverlay = document.querySelector('.activity-overlay');
				if (existingOverlay) existingOverlay.remove();
				return;
			}

			const pdfRes = await fetch(apiUrl('report-pdf'), {
				method: 'GET',
				credentials: 'include'
			});

			if (!pdfRes.ok) {
				alert("Erreur lors de la génération du PDF.");
				const existingOverlay = document.querySelector('.activity-overlay');
				if (existingOverlay) existingOverlay.remove();
				return;
			}

			const blob = await pdfRes.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `rapport-gmail-${new Date().toISOString().slice(0, 10)}.pdf`;
			a.click();
			const existingOverlay = document.querySelector('.activity-overlay');
			if (existingOverlay) existingOverlay.remove();
			URL.revokeObjectURL(url);
		} catch (err) {
			console.error("Erreur export PDF serveur:", err);
			const existingOverlay = document.querySelector('.activity-overlay');
			if (existingOverlay) existingOverlay.remove();
			alert("Erreur réseau ou serveur lors de l'export PDF.");
		}
	}
		// Charge l'automatisation sauvegardée depuis le backend
	async function loadAutomation() {
		try {
			const res = await fetch(apiUrl('get-automation'), { credentials: 'include' });
			const data = await res.json();
			if (data.active) {
				freq = data.frequency || '';
				xhours = data.xhours || '1';
				xminutes = data.xminutes || '1';
				automationActive = true;
				updateAutomationStatus();
			} else {
				automationActive = false;
				freq = ''; // correspond à "Aucune"
				xhours = '1';
				xminutes = '1';
				updateAutomationStatus();
			}
		} catch (e) {
			console.warn('Erreur chargement automation');
			automationActive = false;
			freq = ''; // correspond à "Aucune"
			xhours = '1';
			xminutes = '1';
			updateAutomationStatus();
		}
	}

	function openEmailDialog() {
		showDialog = true;
		destEmail = mainUserEmail;
		emailSendStatus = '';
		setTimeout(() => {
			if (window.Metro && window.Metro.dialog) {
				window.Metro.dialog.open('#emailDialog');
			}
		}, 0);
	}

	function updateAutomationStatus() {
		autoStatus = freq
			? freq === 'daily'
				? 'Automatisation quotidienne activée (07h00)'
				: freq === 'xhours'
					? `Automatisation toutes les ${xhours} heures`
					: freq === 'xminutes'
						? `Automatisation toutes les ${xminutes} min`
						: 'Aucune automatisation active'
			: 'Aucune automatisation active';
	}
	
function exportPDF() {
  const el = document.getElementById('rapport-modal-html');
  if (!el || !html2pdfLib) return;

  // Patch : retire tous les styles de hauteur/overflow
  const modal = el.closest('.metro-container');
if (modal && modal instanceof HTMLElement) {
  modal.style.maxHeight = 'none';
  modal.style.overflow = 'visible';
  modal.style.height = 'auto';
}
  el.classList.add('pdf-export');

  // Patch sticky
  const sticky = el.querySelector('.gmail-report-sticky-header');
  if (sticky && sticky instanceof HTMLElement) {
	sticky.style.position = 'static';
	sticky.style.boxShadow = 'none';
  }

  html2pdfLib()
    .from(el)
    .set({
      margin: 0.5,
      filename: `rapport-gmail-${new Date().toISOString().slice(0,10)}.pdf`,
      html2canvas: { scale: 2, windowWidth: el.scrollWidth },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
    })
    .save()
    .then(() => {
      // Remets les styles par défaut après coup
	  el.classList.remove('pdf-export');
	  if (modal && modal instanceof HTMLElement) {
		modal.style.maxHeight = '';
		modal.style.overflow = '';
		modal.style.height = '';
	  }
	  if (sticky instanceof HTMLElement) {
		sticky.style.position = '';
		sticky.style.boxShadow = '';
	  }
    });
}

</script>

{#if !isConnected}
  <div class="overlay-fullscreen-block-ui">
    <div class="overlay-content-loader">
      <!-- <div data-role="activity" data-type="metro" data-style="color"></div> -->
      <div style="margin-top:14px;font-size:1.19em;font-weight:500;">
        Connexion à Gmail requise<br>
        <span style="font-size:1em;font-weight:400;">
          {#if blocageRaison === 'erreur'}
            <span style="color:#d32f2f;">Erreur : {blocageMsg}</span>
          {:else}
            Merci de vous connecter pour utiliser l’application
          {/if}
        </span>
        {#if authUrl}
          <div style="margin-top:18px;">
            <a
              class="button primary"
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              on:click={() => { authRequested = true; }}
            >
              <span class="mif-google"></span> Se connecter avec Gmail
            </a>
            <!-- <button class="button" on:click={fetchAuthUrl} style="margin-left:10px;">
              🔄 J’ai terminé la connexion
            </button> -->
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}



{#if metroReady}
	<div
		id="userCharms"
		bind:this={charmsRef}
		data-role="charms"
		data-position="right"
		data-width="350"
		data-overlay="true"
		data-close-button="true"
		class="fg-dark"
	>
		<div style="padding:24px 18px;">
			<button
				class="button mini cycle bg-light fg-dark"
				on:click={closeCharms}
				style="position:absolute;top:10px;right:10px;z-index:1201;"
				aria-label="Fermer"
			>
				<span class="mif-cross"></span>
			</button>
			<div class="mb-2" style="display:flex;align-items:center;gap:14px;">
				<span class="mif-user" style="font-size:2em;color:#1a73e8;"></span>
				<div>
					<span class="text-leader" style="font-size:1.07em;"><b>Compte Gmail:</b></span>
					<div style="font-weight:bold;color:#137ee3;font-size:1.05em;">{mainUserEmail}</div>
				</div>
			</div>
			<hr />
			<div style="font-size:1em;line-height:1.7;">
				<span style="color:#1a73e8;"><b>Ce rapport sera généré pour ce compte Gmail.</b></span>
				<div class="mt-1" style="font-size:0.98em;">
					<span class="mif-warning fg-red"></span>
					<span class="fg-red"
						><b>Attention :</b> Si plusieurs comptes Google sont ouverts dans ce navigateur,<br />
						l’appli fonctionne uniquement pour le <b>compte “par défaut” Google</b>.<br />
						<u>Fermez les autres comptes ou utilisez une fenêtre privée</u> pour éviter toute confusion.</span
					>
				</div>
			</div>
			<hr />
			<div style="color:#aaa; font-size:0.96em;">
				<span class="mif-info fg-cyan"></span> Version app: <b>2025-07-22</b><br />
				<a
					href="mailto:support@monprojet.com"
					class="button outline primary"
					style="margin-top:8px;"
				>
					<span class="mif-mail"></span> Support
				</a>
			</div>
		</div>
	</div>
{/if}

<!-- Main content -->

<div data-role="activity" style="display:none;"></div>

<div class="metro-container" class:blocked={blocageUI}>
	{#if blocageUI}
		{#if blocageRaison === 'connexion' && !authRequested}
			<!-- Rien (pas de blocage tant que pas cliqué) -->
		{:else}
			<div class="overlay-block-ui">
				<div class="overlay-content-loader">
					<div data-role="activity" data-type="metro" data-style="color"></div>
					<div style="margin-top:14px;">
						{#if blocageRaison === 'connexion'}
							Connexion à Gmail en cours...
						{:else if blocageRaison === 'generation'}
							Génération du rapport...<br /><b>{progress}%</b>
						{:else if blocageRaison === 'erreur'}
							<span style="color:#d32f2f;">Erreur : {blocageMsg}</span>
						{:else}
							<span>Merci de patienter...</span>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	{/if}

<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
	<button
		class="button bg-indigo fg-white cycle"
		title="Infos utilisateur"
		on:click={toggleCharms}
		aria-label="Afficher les informations utilisateur"
	>
		<span class="mif-help1 mif-lg"></span>
	</button>
	<div style="flex: 1; text-align: center;">
		<span class="fg-cyan" style="font-size: 1.6em; font-weight: 600;">
			Résumé Gmail
			{#if mainUserEmail}
				<span style="font-size:0.6em;color:#137ee3;padding-left:0.7em;">
					({mainUserEmail})
				</span>
			{/if}
		</span>
		<span class="icon mif-mail fg-cyan"></span>
	</div>
	<!-- 👉 Ici le bouton déconnexion -->
{#if isConnected}
	<button
		class="button alert"
		on:click={disconnectGmail}
		style="margin-left:18px;min-width:160px;" 
		disabled={deconnexionStatus === 'Déconnexion en cours…'}
	>
		<span class="mif-exit"></span> Déconnecter Gmail
	</button>
	{#if deconnexionStatus}
	  <div class="overlay-fullscreen-block-ui">
    	<div class="overlay-content-loader">

		<span style="margin-left:12px; color:#1976d2; font-weight:500;">
			{#if deconnexionStatus === 'Déconnexion en cours…'}
				<span data-role="activity" data-type="metro" data-style="color" style="margin-right:6px;"></span>
			{:else if deconnexionStatus.startsWith('Déconnexion réussie')}
				<span class="mif-checkmark fg-green" style="margin-right:6px;"></span>
			{/if}
			{deconnexionStatus}
		</span>
		</div>
	  </div>
	{/if}
{/if}
</div>

	<form on:submit|preventDefault={generateReport} class:form-disabled={blocageUI}>
		<div class="form-group">
			<label for="input-date">Date à analyser</label>
			<input
				type="date"
				bind:value={date}
				style="width:200px;"
				max={new Date().toISOString().slice(0, 10)}
				disabled={blocageUI || isGenerating}
			/>
		</div>
		<div id="nb-mails" style="margin-left:8px;font-size:0.97em;color:#555;min-height:28px;">
  {#if mailCountLoading}
    <span class="count-loader" style="display:inline-flex;align-items:center;gap:10px;">
      <span>Comptage...</span>
      <div data-role="activity" data-type="square" data-style="color" style="width:24px;height:24px;"></div>
    </span>
  {:else if mailCountError}
    <span class="fade-in fg-red">{mailCountError}</span>
  {:else if mailCount !== null}
    {#if mailCount === 0}
      <span class="fade-in fg-red">Aucun mail trouvé</span>
    {:else}
      <span class="fade-in fg-cyan">{Math.min(mailCount, 50)} mails récupérables / {mailCount} trouvés</span>
    {/if}
  {/if}
</div>
<div class="container-fluid p-5 border border-4 bd-grayWhite mt-3 mb-3">
			<h4>Rapport</h4>
			<div style="display:flex;justify-content:space-between;gap:20px;">
				<div style="width:50%;">
					<label class="switch">
						<input type="checkbox" bind:checked={onlyUnread} disabled={blocageUI || isGenerating} />
						<span class="check"></span>
						<span class="caption" style="color:{onlyUnread ? '#27ae60' : '#c0392b'};">
							{onlyUnread ? 'mails: que les non lus' : 'mails: lus et non lus'}
						</span>
					</label>
				</div>
				<div style="width:50%;">
					<label class="switch">
						<input
							type="checkbox"
							bind:checked={groupByLabel}
							disabled={blocageUI || isGenerating}
						/>
						<span class="check"></span>
						<span class="caption" style="color:{groupByLabel ? '#27ae60' : '#c0392b'};">
							{groupByLabel ? 'groupé par label' : 'non groupé par label'}
						</span>
					</label>
				</div>
			</div>
<div style="display:flex;justify-content:space-between;gap:20px;">
  <div style="width:50%;">
    <button
      class="button success metro-btn mt-2"
      type="submit"
      disabled={isGenerating || blocageUI}
    >
      <span class="mif-rocket"></span>
      {isGenerating ? 'Génération en cours...' : 'Générer le rapport'}
    </button>
  </div>
  <div style="width:50%;">
    <button
      class="button primary metro-btn mt-2"
      type="button"
      title="Envoyer le rapport par email"
      aria-label="Envoyer le rapport par email"
      on:click={openEmailDialog}
      disabled={blocageUI || isGenerating || !hasReport}
      style="min-width:170px;"
    >
      <span class="mif-mail"></span>
      {isGenerating
        ? 'Envoi en cours...'
        : 'Envoyer par mail'
      }
    </button>
  </div>
</div>
			<span class="status-msg">
				{#if statusType !== 'idle'}
					<div style="background:{statusType === 'error' ? '#ffeaea' : '#e8fff2'}; padding:10px;">
						<div style="display:flex; align-items:center; min-height:36px;">
							<span
								style="font-size:1.13em; margin-right:16px; color:
          {statusType === 'error' ? '#c0392b' : statusType === 'success' ? '#249656' : 'green'};
          white-space: nowrap;
          flex: 1;"
							>
								{#if statusType === 'loading'}
									<span class="mif-rocket mif-lg"></span>
									{statusMsg}
									{#if isGenerating}
										&nbsp;: <b>{progress}%</b>
									{/if}
								{:else if statusType === 'success'}
									<span
										class="mif-checkmark fg-green"
										style="font-size:1.13em;vertical-align:middle;margin-right:8px;"
									></span>
									{statusMsg}
								{:else if statusType === 'error'}
									<span
										class="mif-cross fg-red"
										style="font-size:1.3em;vertical-align:middle;margin-right:8px;"
									></span>
									{statusMsg}
								{/if}
							</span>
						</div>
					</div>
				{/if}
			</span>
			{#if reportUrl}
			  <div style="margin-top: 16px;">
			    <a href={reportUrl} target="_blank" class="button secondary">
			      📄 Voir le résumé dans le navigateur
			    </a>
			  </div>
			{/if}
		</div>
	</form>

	<!-- Automatisation -->
	<div class="container-fluid p-5 border border-4 bd-grayWhite mt-3 mb-3">
		<div class="mt-2">
			<h4>Automatisation</h4>
			<span style="font-size:0.95em;margin-left:10px;color:#1a73e8;">{autoStatus}</span>
			<div class="form-group">
				<select
					bind:value={freq}
					on:change={updateAutomationStatus}
					disabled={blocageUI || isGenerating}
				>
					<option value="">Aucune</option>
					<option value="daily">1 fois par jour (7h00)</option>
					<option value="xhours">Toutes les X heures</option>
					<option value="xminutes">Toutes les X minutes (TEST)</option>
				</select>
				{#if freq === 'xhours'}
					<select
						bind:value={xhours}
						style="width:90px;margin-left:10px;"
						disabled={blocageUI || isGenerating}
					>
						{#each Array(12)
							.fill(0)
							.map((_, i) => i + 1) as n}
							<option value={n}>{n}h</option>
						{/each}
					</select>
				{/if}
				{#if freq === 'xminutes'}
					<select
						bind:value={xminutes}
						style="width:90px;margin-left:10px;"
						disabled={blocageUI || isGenerating}
					>
						<option value="1">1 min</option>
						<option value="5">5 min</option>
						<option value="10">10 min</option>
						<option value="15">15 min</option>
						<option value="30">30 min</option>
					</select>
				{/if}
				<button
					class="button warning metro-btn"
					type="button"
					on:click={setAutomation}
					disabled={blocageUI || isGenerating}
				>
					<span class="mif-calendar"></span> Programmer
				</button>
				<button
					class="button success metro-btn"
					type="button"
					on:click={runAutomationNow}
					disabled={blocageUI || isGenerating || runNowLoading}
					style="margin-left:10px;"
					title="Lancer immédiatement l'envoi pour l'utilisateur connecté"
				>
					<span class="mif-rocket"></span> Lancer maintenant
				</button>
				{#if automationActive}
					<button
					  class="button alert metro-btn"
					  type="button"
					  on:click={disableAutomation}
					  style="margin-left:10px;"
					  title="Désactiver l'automatisation"
					>
					  <span class="mif-stop"></span> Désactiver
					</button>
				{/if}
			</div>
			<span class="status-msg">
				{autoStatus}
				{#if runNowStatus}
				  <br /><span style="color:#137ee3;">{runNowStatus}</span>
				{/if}
			</span>
		</div>
	</div>

	<div class="mt-2 center">
		<button
			class="button secondary metro-btn"
			type="button"
			on:click={() =>{
				showLastReport = true;
				fetchLastReport();
			}}
			disabled={blocageUI || isGenerating || !hasReport}
		>
			<span class="mif-file-text"></span> Voir le dernier rapport généré
		</button>
	</div>
{#if showLastReport}
	<div
		class="overlay-fullscreen-block-ui"
		style="z-index:3000;"
		tabindex="0"
		role="button"
		on:click={() => showLastReport = false}
		on:keydown={(e) => {
			if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
				showLastReport = false;
			}
		}}
	>
		<div
			class="metro-container modal-scroll"
			style="
				max-width: 900px;
				max-height: 90vh;
				overflow: auto;
				margin: 40px auto;
				background: #fff;
				border-radius: 14px;
				padding: 28px 20px;
				box-shadow: 0 2px 18px #0003;
				position: relative;"    		
				role="dialog"
    		tabindex="0"
    		aria-modal="true"
			on:click|stopPropagation
		    on:keydown={(e) => { if (e.key === 'Escape') showLastReport = false; }}
		>
			<button class="button mini cycle bg-light fg-dark" style="float:right;" 
        		type="button"
        		aria-label="Fermer le rapport"
				on:click={() => showLastReport = false}>
				<span class="mif-cross"></span>
			</button>
			<!-- ... -->
			<h3>Dernier rapport généré</h3>
			<button 
				class="button primary metro-btn"
				type="button"
				style="margin-bottom:16px;"
				on:click={exportPDFServer}
  			    disabled={!lastReportHtml}
			>
				<span class="mif-file-pdf"></span> Télécharger en PDF
			</button>
			{#if lastReportError}
				<div style="color:#c0392b;">{lastReportError}</div>
			{:else if lastReportHtml}
				<div id="rapport-modal-html">{@html lastReportHtml}</div>
			{:else}
				<div>Chargement...</div>
			{/if}
		</div>
	</div>
{/if}
</div>

<div
	id="emailDialog"
	data-role="dialog"
	data-close-button="true"
	data-overlay="true"
	data-width="400"
	style:display={showDialog ? 'block' : 'none'}
>
	<div class="dialog-title">Envoyer le rapport par email</div>
	<div class="dialog-content">
		<label for="emailInput">Adresse email destinataire</label>
		<input
			id="emailInput"
			type="email"
			class="input"
			style="width:96%"
			bind:value={destEmail}
			required
			disabled={blocageUI || isGenerating}
		/>
		<span style="font-size:0.95em;">{emailSendStatus}</span>
	</div>
	<div class="dialog-actions">
		<button class="button success" on:click={sendReportByEmail} disabled={blocageUI || isGenerating}
			>Envoyer</button
		>
		<button
			class="button"
			on:click={() => {
				showDialog = false;
				if (window.Metro) window.Metro.dialog.close('#emailDialog');
			}}
			disabled={blocageUI || isGenerating}>Annuler</button
		>
	</div>
</div>

<style>
	.form-disabled {
		opacity: 0.6;
		pointer-events: none;
		filter: grayscale(0.5);
	}
	/* svelte-ignore unused-selector */
/* .pdf-export {
  max-height: none !important;
  overflow: visible !important;
  height: auto !important;
} */
/* 
.pdf-export .gmail-report-sticky-header {
  position: static !important;
  box-shadow: none !important;
} */
/* @media print {
  .page-break { page-break-before: always; }
  .gmail-report-sticky-header {
    position: static !important;
    box-shadow: none !important;
  }
} */


</style>

