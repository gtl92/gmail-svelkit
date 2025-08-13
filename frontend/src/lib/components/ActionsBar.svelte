<script>
  export let generate = () => {};
  export let openDialog = () => {};
</script>
<div style="display:flex;gap:18px;justify-content:center;">
  <button class="button success metro-btn mt-2" on:click={generate}>
    <span class="mif-rocket"></span> Générer / Rafraîchir
  </button>
  <button class="button primary outline square1 metro-btn mt-2" on:click={openDialog}>
    <span class="mif-outgoing_mail fg-cobalt"></span> Envoyer par email
  </button>
</div>