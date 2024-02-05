---
sidebar_position: 7
---

# Voxelize Networking

In order to connect our frontend client to the backend Rust server, we need to create a network manager in Voxelize. The network manager handles all the ins and outs of the network packets. For example, the `VOXELIZE.World` requests for chunks on the server side, but you will need the network manager to send/receive these chunk data to and from the server. 

```javascript title="main.js" 
const network = new VOXELIZE.Network();

network.register(world);
```

## A Word on Network Intecepts

Such as the Voxelize world, network interceptors allow developers to peep into what network packets are received, and can also send packets out to the server. 

### `onMessage`

The first thing you can implement for anything you `register` onto the network is `onMessage`. What `onMessage` does is that when `network.sync()`  is called, the network "unpacks" all the network packets received in that frame, and passes those messages through each registered network interceptors. (`network.sync()` is called internally for you.)

For example, say I want to print out all the message types whenever I receive any, I could simply do:

```javascript
const myNetworkDebugger = {
    onMessage(message) {
        console.log(message.type);
    }
};

network.register(myNetworkDebugger);
```

Or, like what `VOXELIZE.World` does [here](https://github.com/shaoruu/voxelize/blob/b553674db761537d26ec6f6f5c2d75b341de377d/packages/core/src/core/world/index.ts#L1932-L1996), it listens to the `INIT`, `STATS`, `LOAD`, and `UPDATE` message types to handle chunking data and reflect any changes on the server (such as stats change to change the client's world time).

### `packets`

The other thing that developers can implement is a property, `packets`, which is simply an array of network packets that will be emptied out and sent on `network.flush()`, which is called for you internally just like `network.sync()`.

## Connect to the Server

Now we have a better understanding of the server, let's connect to the server and join our tutorial world.

```javascript title="main.js"
function animate() {
    requestAnimationFrame(animate);

    renderer.render(world, camera);
}

async function start() {
    animate();

    await network.connect('http://localhost:4000');
    await network.join('tutorial');
}

start();
```

:::tip
`network.connect` automatically changes the protocol from anything (http here) to WebSockets (ws). 
:::

