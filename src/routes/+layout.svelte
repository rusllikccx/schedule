<script lang="ts">
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/images/favicon.ico" sizes="all" />
</svelte:head>

{@render children()}
