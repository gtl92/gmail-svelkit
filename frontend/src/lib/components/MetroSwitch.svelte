<script>
	export let checked = false;
	export let captionOn = 'ON';
	export let captionOff = 'OFF';
	export let colorOn = '#27ae60';
	export let colorOff = '#c0392b';
	export let disabled = false;
	// Pour liaison parent :
	export let onChange = () => {};
</script>

<label class="switch" style="user-select:none;">
	<input type="checkbox" bind:checked {disabled} on:change={() => onChange(checked)} />
	<span class="check"></span>
	<span
		class="caption"
		style="margin-left:10px; color:{checked ? colorOn : colorOff}; font-weight:600;"
	>
		{checked ? captionOn : captionOff}
	</span>
</label>

<style>
	.switch .caption {
		font-size: 1em;
	}
</style>
