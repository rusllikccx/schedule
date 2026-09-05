<script lang="ts">
	import 'bootstrap/dist/css/bootstrap.min.css';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/images/favicon.ico" sizes="all" />
</svelte:head>

{@render children()}
