<script lang="ts">
  import { Client } from "@voxelize/client";
  import { onMount } from "svelte";

  let domElement: HTMLDivElement;

  onMount(() => {
    const client = new Client();

    client.connect({ world: "world1", serverURL: "ws://0.0.0.0:4000" });
  });
</script>

<div id="wrapper" bind:this={domElement}>
  <div id="crosshair" />
</div>
