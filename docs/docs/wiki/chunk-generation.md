# Chunk Generation
In this wiki page, I will be explaining the entire process of chunk generation, from chunk requesting all the way to chunk responding.

## Chunk Requesting
The first step of the chunking process is the client requesting.

In chunk requesting, there are four types of data held on the client:

- `world.chunks.toRequest`
	- An array of 2D chunk coordinates to request.
	- Every tick, `world.params.maxRequestsPerTick` is pushed to the server.
- `world.chunks.requested`
	- A map of chunk 2D coordinate names to a number. 
	- The number represents how many time has this chunk been wanted. If this number exceeds `world.params.rerequestTicks`, this chunk entry will be removed from `requested` and pushed back to `toRequest`.
- `world.chunks.toProcess`
	- An array of received chunk data.
	- Every tick, `world.params.maxProcessPerTick` is then handled by the client and converted to chunk meshes or data.
	- This process is also shared by the chunk updating system.
- `world.chunks.loaded`
	- A map of  chunks.
	- This is the actual chunk data.

In `world.update`, the client first loops through a radius of chunk coordinates around its passed-in center, and run the below process on each coordinate:

- If the chunk coordinate is out of the defined minimum/maximum chunk, continue.
- Retrieve the chunk status, which is in the four data holders above, which is this chunk in.
- If the status is `null`, push the chunk into the `toRequest` for it to be requested.
- If the status is `loaded`, do nothing.
- If the status is `requested`, check if the amount of time this check has been run is more than `rerequestTicks`. If true, push to `toRequest` and remove it from `requested`.

Next, the following happens:

- Loop through `toRequest` and request the first `maxRequestsPerTick` from the server.
- Loop through `toProcess` and process the first `maxProcessPerTick`, instantiating chunk instances or turning them into meshes. The processed chunks are then added to `loaded`.
- Maintain the chunks. In other words, remove all chunk traces/data if its too far away in the above four quadrants.

That is for the chunk requesting system. Now moving onto the chunk generation process.

## Chunk Generation

The first step of generation is to know what chunks to be generated. For this, the server knows what chunks are needed by receiving chunk requests from the client.

Each client, there are two categories of chunk requests within `ChunkRequestsComp`:

- `requested`: The chunks that this client has requested by has not been processed by the server. This set is processed every tick by the server.
- `processed`: Whether it is the chunk data has finished and been sent to the client or it is the chunk is queued to be generated, chunk coordinates from `requested` will be pushed into this every tick.

In order to know if a client is interested in a chunk, we check if `processed` contains the chunk coordinate. The reason why we don't check if `requested` contains the coordinate will be explained below.

