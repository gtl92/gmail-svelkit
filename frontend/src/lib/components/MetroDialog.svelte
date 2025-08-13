<script>
	export let open = false;
	export let title = 'Dialog';
	export let onClose = () => {};
</script>

{#if open}
	<div class="modal-overlay" on:click={() => onClose()}>
		<div class="metro-dialog" on:click|stopPropagation>
			<div class="dialog-title">
				{title}
				<button class="close-btn" on:click={onClose} aria-label="Fermer">
					<span class="mif-cross"></span>
				</button>
			</div>
			<div class="dialog-content">
				<slot />
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: #0006;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 2222;
	}
	.metro-dialog {
		background: #fff;
		border-radius: 13px;
		min-width: 320px;
		max-width: 96vw;
		box-shadow: 0 8px 28px #0002;
		animation: popin 0.19s;
	}
	@keyframes popin {
		from {
			transform: scale(0.93);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
	.dialog-title {
		font-size: 1.17em;
		font-weight: 600;
		padding: 14px 20px 10px 18px;
		border-bottom: 1px solid #ececec;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.dialog-content {
		padding: 20px;
	}
	.close-btn {
		border: none;
		background: none;
		color: #888;
		font-size: 1.4em;
		cursor: pointer;
		border-radius: 50%;
		padding: 5px;
	}
	.close-btn:hover {
		background: #f0f0f0;
	}
</style>
