import { G as attr_class, F as escape_html, J as attr, K as attr_style, N as maybe_selected, w as pop, u as push, O as stringify } from "../../chunks/index.js";
function _page($$payload, $$props) {
  push();
  if (typeof window !== "undefined") {
    window.location.hostname === "localhost" || window.location.hostname.startsWith("127.") || window.location.hostname.endsWith(".local");
  }
  let blocageUI = true;
  let onlyUnread = true;
  let groupByLabel = true;
  let date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  let mainUserEmail = "...";
  let freq = "";
  let autoStatus = "";
  let emailSendStatus = "";
  let destEmail = mainUserEmail;
  {
    JSON.stringify({ date, onlyUnread, groupByLabel });
  }
  {
    $$payload.out.push("<!--[-->");
    $$payload.out.push(`<div class="overlay-fullscreen-block-ui"><div class="overlay-content-loader"><div style="margin-top:14px;font-size:1.19em;font-weight:500;">Connexion à Gmail requise<br/> <span style="font-size:1em;font-weight:400;">`);
    {
      $$payload.out.push("<!--[!-->");
      $$payload.out.push(`Merci de vous connecter pour utiliser l’application`);
    }
    $$payload.out.push(`<!--]--></span> `);
    {
      $$payload.out.push("<!--[!-->");
    }
    $$payload.out.push(`<!--]--></div></div></div>`);
  }
  $$payload.out.push(`<!--]--> `);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--> <div data-role="activity" style="display:none;"></div> <div${attr_class("metro-container", void 0, { "blocked": blocageUI })}>`);
  {
    $$payload.out.push("<!--[-->");
    {
      $$payload.out.push("<!--[!-->");
      $$payload.out.push(`<div class="overlay-block-ui"><div class="overlay-content-loader"><div data-role="activity" data-type="metro" data-style="color"></div> <div style="margin-top:14px;">`);
      {
        $$payload.out.push("<!--[!-->");
        {
          $$payload.out.push("<!--[!-->");
          {
            $$payload.out.push("<!--[!-->");
            $$payload.out.push(`<span>Merci de patienter...</span>`);
          }
          $$payload.out.push(`<!--]-->`);
        }
        $$payload.out.push(`<!--]-->`);
      }
      $$payload.out.push(`<!--]--></div></div></div>`);
    }
    $$payload.out.push(`<!--]-->`);
  }
  $$payload.out.push(`<!--]--> <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;"><button class="button bg-indigo fg-white cycle" title="Infos utilisateur" aria-label="Afficher les informations utilisateur"><span class="mif-help1 mif-lg"></span></button> <div style="flex: 1; text-align: center;"><span class="fg-cyan" style="font-size: 1.6em; font-weight: 600;">Résumé Gmail `);
  {
    $$payload.out.push("<!--[-->");
    $$payload.out.push(`<span style="font-size:0.6em;color:#137ee3;padding-left:0.7em;">(${escape_html(mainUserEmail)})</span>`);
  }
  $$payload.out.push(`<!--]--></span> <span class="icon mif-mail fg-cyan"></span></div> `);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--></div> <form${attr_class("svelte-10mpwr2", void 0, { "form-disabled": blocageUI })}><div class="form-group"><label for="input-date">Date à analyser</label> <input type="date"${attr("value", date)} style="width:200px;"${attr("max", (/* @__PURE__ */ new Date()).toISOString().slice(0, 10))}${attr("disabled", blocageUI, true)}/></div> <div id="nb-mails" style="margin-left:8px;font-size:0.97em;color:#555;min-height:28px;">`);
  {
    $$payload.out.push("<!--[!-->");
    {
      $$payload.out.push("<!--[!-->");
      {
        $$payload.out.push("<!--[!-->");
      }
      $$payload.out.push(`<!--]-->`);
    }
    $$payload.out.push(`<!--]-->`);
  }
  $$payload.out.push(`<!--]--></div> <div class="container-fluid p-5 border border-4 bd-grayWhite mt-3 mb-3"><h4>Rapport</h4> <div style="display:flex;justify-content:space-between;gap:20px;"><div style="width:50%;"><label class="switch"><input type="checkbox"${attr("checked", onlyUnread, true)}${attr("disabled", blocageUI, true)}/> <span class="check"></span> <span class="caption"${attr_style(`color:${stringify("#27ae60")};`)}>${escape_html("mails: que les non lus")}</span></label></div> <div style="width:50%;"><label class="switch"><input type="checkbox"${attr("checked", groupByLabel, true)}${attr("disabled", blocageUI, true)}/> <span class="check"></span> <span class="caption"${attr_style(`color:${stringify("#27ae60")};`)}>${escape_html("groupé par label")}</span></label></div></div> <div style="display:flex;justify-content:space-between;gap:20px;"><div style="width:50%;"><button class="button success metro-btn mt-2" type="submit"${attr("disabled", blocageUI, true)}><span class="mif-rocket"></span> ${escape_html("Générer le rapport")}</button></div> <div style="width:50%;"><button class="button primary metro-btn mt-2" type="button" title="Envoyer le rapport par email" aria-label="Envoyer le rapport par email"${attr("disabled", blocageUI, true)} style="min-width:170px;"><span class="mif-mail"></span> ${escape_html("Envoyer par mail")}</button></div></div> <span class="status-msg">`);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--></span> `);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--></div></form> <div class="container-fluid p-5 border border-4 bd-grayWhite mt-3 mb-3"><div class="mt-2"><h4>Automatisation</h4> <span style="font-size:0.95em;margin-left:10px;color:#1a73e8;">${escape_html(autoStatus)}</span> <div class="form-group"><select${attr("disabled", blocageUI, true)}>`);
  $$payload.select_value = freq;
  $$payload.out.push(`<option value=""${maybe_selected($$payload, "")}>Aucune</option><option value="daily"${maybe_selected($$payload, "daily")}>1 fois par jour (7h00)</option><option value="xhours"${maybe_selected($$payload, "xhours")}>Toutes les X heures</option><option value="xminutes"${maybe_selected($$payload, "xminutes")}>Toutes les X minutes (TEST)</option>`);
  $$payload.select_value = void 0;
  $$payload.out.push(`</select> `);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--> `);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--> <button class="button warning metro-btn" type="button"${attr("disabled", blocageUI, true)}><span class="mif-calendar"></span> Programmer</button> <button class="button success metro-btn" type="button"${attr("disabled", blocageUI, true)} style="margin-left:10px;" title="Lancer immédiatement l'envoi pour l'utilisateur connecté"><span class="mif-rocket"></span> Lancer maintenant</button> `);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--></div> <span class="status-msg">${escape_html(autoStatus)} `);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--></span></div></div> <div class="mt-2 center"><button class="button secondary metro-btn" type="button"${attr("disabled", blocageUI, true)}><span class="mif-file-text"></span> Voir le dernier rapport généré</button></div> `);
  {
    $$payload.out.push("<!--[!-->");
  }
  $$payload.out.push(`<!--]--></div> <div id="emailDialog" data-role="dialog" data-close-button="true" data-overlay="true" data-width="400"${attr_style("", { display: "none" })}><div class="dialog-title">Envoyer le rapport par email</div> <div class="dialog-content"><label for="emailInput">Adresse email destinataire</label> <input id="emailInput" type="email" class="input" style="width:96%"${attr("value", destEmail)} required${attr("disabled", blocageUI, true)}/> <span style="font-size:0.95em;">${escape_html(emailSendStatus)}</span></div> <div class="dialog-actions"><button class="button success"${attr("disabled", blocageUI, true)}>Envoyer</button> <button class="button"${attr("disabled", blocageUI, true)}>Annuler</button></div></div>`);
  pop();
}
export {
  _page as default
};
