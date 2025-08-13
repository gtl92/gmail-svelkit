<script>
  export let openCharms = () => {};
</script>
<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;">
  <button class="button bg-indigo fg-white cycle" aria-label="Infos utilisateur" on:click={openCharms}>
    <span class="mif-help1 mif-lg"></span>
  </button>
  <div style="flex: 1; text-align: center;">
    <span class="fg-cyan" style="font-size: 1.6em; font-weight: 600;">Résumé Gmail</span>
    <span class="icon mif-mail fg-cyan"></span>
  </div>
  <div style="width:36px;"></div>
</div>