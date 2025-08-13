<script>
  export let onlyUnread;
  export let groupByLabel;
</script>
<div style="display: flex; gap:30px; justify-content: center; margin-bottom:24px;">
  <label class="switch">
    <input type="checkbox" bind:checked={onlyUnread} />
    <span class="check"></span>
    <span class="caption">{onlyUnread ? 'Mails : que les non lus' : 'Mails : lus et non lus'}</span>
  </label>
  <label class="switch">
    <input type="checkbox" bind:checked={groupByLabel} />
    <span class="check"></span>
    <span class="caption">{groupByLabel ? 'Groupé par label Gmail' : 'Non groupé par label'}</span>
  </label>
</div>