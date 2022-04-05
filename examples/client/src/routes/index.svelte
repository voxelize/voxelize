<script lang="ts">
  import { Client } from "@voxelize/client";
  import { onMount } from "svelte";

  let domElement: HTMLDivElement;

  onMount(() => {
    const client = new Client();
    console.log(client);
  });
</script>

<div id="wrapper" bind:this={domElement}>
  <div id="crosshair" />
</div>
