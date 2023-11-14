---
id: "SpriteText"
title: "Class: SpriteText"
sidebar_label: "SpriteText"
sidebar_position: 0
custom_edit_url: null
---

A sprite that can be used to display text. This is highly inspired by the
[THREE.SpriteText](https://github.com/vasturiano/three-spritetext) library.

Sprite text uses [ColorText](ColorText.md) internally to generate the texture that supports
multiple colors in the same text.

![Sprite text](/img/docs/sprite-text.png)

## Hierarchy

- `Sprite`

  ↳ **`SpriteText`**

  ↳↳ [`NameTag`](NameTag.md)

## Constructors

### constructor

• **new SpriteText**(`text?`, `textHeight?`): [`SpriteText`](SpriteText.md)

Create a new sprite text.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `text` | `string` | `""` | The text to display. |
| `textHeight` | `number` | `10` | The height of the text in pixels. |

#### Returns

[`SpriteText`](SpriteText.md)

#### Overrides

Sprite.constructor

## Accessors

### backgroundColor

• `get` **backgroundColor**(): `string` \| ``false``

Get the background color of the sprite text.

#### Returns

`string` \| ``false``

• `set` **backgroundColor**(`color`): `void`

Set the background color of the sprite text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `color` | `string` \| ``false`` |

#### Returns

`void`

___

### borderColor

• `get` **borderColor**(): `string`

Get the border color of the sprite text.

#### Returns

`string`

• `set` **borderColor**(`borderColor`): `void`

Set the border color of the sprite text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderColor` | `string` |

#### Returns

`void`

___

### borderRadius

• `get` **borderRadius**(): `number`

Get the border radius of the sprite text.

#### Returns

`number`

• `set` **borderRadius**(`borderRadius`): `void`

Set the border radius of the sprite text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderRadius` | `number` |

#### Returns

`void`

___

### borderWidth

• `get` **borderWidth**(): `number`

Get the border width of the sprite text.

#### Returns

`number`

• `set` **borderWidth**(`borderWidth`): `void`

Set the border width of the sprite text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `borderWidth` | `number` |

#### Returns

`void`

___

### fontFace

• `get` **fontFace**(): `string`

Get the font face of the sprite text.

#### Returns

`string`

• `set` **fontFace**(`fontFace`): `void`

Set the font face of the sprite text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontFace` | `string` |

#### Returns

`void`

___

### fontSize

• `get` **fontSize**(): `number`

Get the font size of the sprite text.

#### Returns

`number`

• `set` **fontSize**(`fontSize`): `void`

Set the font size of the sprite text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontSize` | `number` |

#### Returns

`void`

___

### fontWeight

• `get` **fontWeight**(): `string`

Get the font weight of the sprite text.

#### Returns

`string`

• `set` **fontWeight**(`fontWeight`): `void`

Set the font weight of the sprite text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `fontWeight` | `string` |

#### Returns

`void`

___

### padding

• `get` **padding**(): `number`

Get the padding of the sprite text. This is the space between the text and
the border.

#### Returns

`number`

• `set` **padding**(`padding`): `void`

Set the padding of the sprite text. This is the space between the text and
the border. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `padding` | `number` |

#### Returns

`void`

___

### strokeColor

• `get` **strokeColor**(): `string`

Get the stroke color of the sprite text. In other words, the color of the
text.

#### Returns

`string`

• `set` **strokeColor**(`strokeColor`): `void`

Set the stroke color of the sprite text. In other words, the color of the
text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `strokeColor` | `string` |

#### Returns

`void`

___

### strokeWidth

• `get` **strokeWidth**(): `number`

Get the stroke width of the sprite text.

#### Returns

`number`

• `set` **strokeWidth**(`strokeWidth`): `void`

Set the stroke width of the sprite text. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `strokeWidth` | `number` |

#### Returns

`void`

___

### text

• `get` **text**(): `string`

Get the text rendered in the sprite.

#### Returns

`string`

• `set` **text**(`text`): `void`

Set the text to display. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `text` | `string` |

#### Returns

`void`

___

### textHeight

• `get` **textHeight**(): `number`

Get the text height in pixels.

#### Returns

`number`

• `set` **textHeight**(`textHeight`): `void`

Set the text height to display. This will regenerate the sprite.

#### Parameters

| Name | Type |
| :------ | :------ |
| `textHeight` | `number` |

#### Returns

`void`
