<script lang="ts">
let Metro: any;

if (typeof window !== 'undefined') {
  Metro = (window as any).Metro;
}
import { onMount } from 'svelte';

onMount(() => {
  if (typeof Metro !== 'undefined' && Metro.activity?.init) {
    Metro.activity.init();
  }
});
  export let loading;
  export let error;
  export let html;
</script>

{#if loading}
  <div style="background:#e8fff2; padding:10px; margin-top: 1.5em; border-radius: 8px;">
    <div style="display:flex; align-items:center; min-height:36px;">
      <span style="color:green;font-size:1.13em; margin-right:16px;">Génération...</span>
      <!-- <span class="mif-spinner ani-spin" style="font-size: 1.4em; color: green;"></span> -->
      <div data-role="activity" data-type="metro" data-style="color" style="align-self:center;margin-top:2px;">
            </div>
    </div>
  </div>
{:else if error}
  <div class="center fg-red" style="margin: 1.5em 0;">Erreur: {error}</div>
{:else if html}
  <div style="margin:1.5em 0; background: #f3f7fb; padding: 18px; border-radius: 12px; font-size: 0.96em;">
    {@html html}
  </div>
{/if}