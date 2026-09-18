<script lang="ts">
	import '../styles/bootstrap-custom.scss';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/images/favicon.ico" sizes="all" />
</svelte:head>

{@render children()}
