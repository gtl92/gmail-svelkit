<script>
	export let onClick = () => {};
	export let label = 'Bouton';
	export let color = 'success'; // 'primary', 'danger', etc.
	export let icon = '';
	export let disabled = false;
	export let outline = false;
</script>

<button class="button metro-btn {outline ? 'outline' : ''} {color}" on:click={onClick} {disabled}>
	{#if icon}
		<span class="mif-{icon}" style="margin-right:7px;"></span>
	{/if}
	{label}
</button>

<style>
	.metro-btn {
		font-size: 1.13em;
		border-radius: 7px;
	}
</style>
