---
id: "ImageVoxelizer"
title: "Class: ImageVoxelizer"
sidebar_label: "ImageVoxelizer"
sidebar_position: 0
custom_edit_url: null
---

A class that turns a given image into a mosaic of block textures registered in the [World](World.md).

# Example
```ts
ImageVoxelizer.build(
  "https://i.imgur.com/0Z0Z0Z0.png",
  world,
  new THREE.Vector3(0, 0, 0),
  {
    width: 64,
    height: 64,
    lockedRatio: true,
    orientation: "x",
  }
).then((success) => {
  if (success) {
    console.log("Image voxelized successfully!");
  } else {
    console.log("Image voxelization failed.");
  }
});
```

![ImageVoxelizer example](/img/image-voxelizer.png)

## Methods

### build

▸ `Static` **build**(`imgURL`, `world`, `position`, `params`): `Promise`<`boolean`\>

Build a list of block updates that corresponds to a mosaic of the given image using the textures registered in the given world's registry.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `imgURL` | `string` | The URL of the image to be voxelized. This will be used to create an `Image` object. |
| `world` | [`World`](World.md) | The world to be updated. |
| `position` | `Vector3` | The position to start voxelizing the image. This will be the bottom middle of the voxelized image. |
| `params` | [`ImageVoxelizerParams`](../modules.md#imagevoxelizerparams-410) | The extra parameters to process the image voxelization. |

#### Returns

`Promise`<`boolean`\>

A list of block updates that corresponds to a mosaic of the given image.

___

### parse

▸ `Static` **parse**(`rest`): `Object`

Parse a command line string into image voxelization parameters.

**`example`**
```js
// Parsing a command line string
// https://example.com/image.png { "width": 64, "height": 64, "lockedRatio": true, "orientation": "x" }
// Turns into this object
{
  url: "https://example.com/image.png",
  params: {
    width: 64,
    height: 64,
    lockedRatio: true,
    orientation: "x"
  }
}
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `rest` | `string` | The rest of the command string to be parsed. |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `params` | [`ImageVoxelizerParams`](../modules.md#imagevoxelizerparams-410) |
| `url` | `string` |
