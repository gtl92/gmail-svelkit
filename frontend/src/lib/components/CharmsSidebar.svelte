<script lang="ts">
let Metro: any;
if (typeof window !== 'undefined') {
  Metro = (window as any).Metro;
}
  import { onMount } from 'svelte';
  export let open = false;
  export let email = '';
  export let close = () => {};
  let el: HTMLElement;
  let charms: any;
  export function toggle() {
    if (charms) {
      charms.toggle();
    }
  }
onMount(() => {
  setTimeout(() => {
    el = document.getElementById('userCharms') as HTMLElement;
    console.log('el', el);
    if (el && typeof Metro !== 'undefined') {
      Metro.init(el);
      charms = Metro.getPlugin(el, 'charms');
      console.log('charms', charms);
      if (open && charms) {
        charms.open();
      }
    } else {
      console.warn('Charms not initialized: Metro or element missing');
    }
  }, 100);
});
</script>
<div id="userCharms"
     data-role="charms"
     data-position="right"
     data-width="350"
     data-overlay="true"
     data-close-button="true"
     class="fg-dark"
     style="z-index:2200; min-height:100vh; padding:28px 18px;">
  <button class="button mini cycle bg-light fg-dark" style="position:absolute;top:10px;right:10px;" aria-label="Fermer" on:click={() => {
    const el = document.getElementById('userCharms');
    if (el && typeof Metro !== 'undefined') {
          console.log("charms.toggle()");
      charms = Metro.getPlugin(el, 'charms');
      charms.toggle();
      if (el.classList.contains('open')) {
        // still open after toggle => no need to call close
      } else {
        close();
      }
    }
  }}>
    <span class="mif-cross"></span>
  </button>
  <div class="mb-2" style="display:flex;align-items:center;gap:14px;">
    <span class="mif-user" style="font-size:2em;color:#1a73e8;"></span>
    <div>
      <span class="text-leader" style="font-size:1.07em;"><b>Compte Gmail :</b></span>
      <div style="font-weight:bold;color:#137ee3;font-size:1.05em;">{email}</div>
    </div>
  </div>
  <hr />
  <div style="font-size:1em;line-height:1.7;">
    <span style="color:#1a73e8;"><b>Ce rapport sera généré pour ce compte Gmail.</b></span>
    <div class="mt-1" style="font-size:0.98em;">
      <span class="mif-warning fg-red"></span>
      <span class="fg-red"><b>Attention :</b> Si plusieurs comptes Google sont ouverts dans ce navigateur,<br />
        l’appli fonctionne uniquement pour le <b>compte “par défaut” Google</b>.<br />
        <u>Fermez les autres comptes ou utilisez une fenêtre privée</u> pour éviter toute confusion.</span>
    </div>
  </div>
  <hr />
  <div style="color:#aaa; font-size:0.96em;">
    <span class="mif-info fg-cyan"></span> Version app: <b>2025-07-29 001</b><br />
    <a href="mailto:support@monprojet.com" class="button outline primary" style="margin-top:8px;">
      <span class="mif-mail"></span> Support
    </a>
  </div>
</div>