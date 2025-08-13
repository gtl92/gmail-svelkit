<script>
  export let open = false;
  export let close = () => {};
</script>
{#if open}
  <div class="overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0005;z-index:2000;display:flex;align-items:center;justify-content:center;">
    <div class="dialog" style="background:#fff;padding:24px 18px;border-radius:12px;box-shadow:0 8px 28px #0002;min-width:320px;max-width:94vw;">
      <div class="dialog-title" style="font-size:1.14em;font-weight:bold;margin-bottom:8px;">
        Envoyer le rapport par email
      </div>
      <div class="dialog-content" style="margin-bottom:14px;">
        <label for="emailInput">Adresse email destinataire</label>
        <input id="emailInput" type="email" class="input" style="width:96%" required />
      </div>
      <div class="dialog-actions" style="display:flex;gap:12px;">
        <button class="button success" on:click={close}>Envoyer</button>
        <button class="button" on:click={close}>Annuler</button>
      </div>
    </div>
  </div>
{/if}