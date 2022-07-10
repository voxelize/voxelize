import * as $protobuf from "protobufjs";
/** Namespace protocol. */
export namespace protocol {

    /** Properties of a Geometry. */
    interface IGeometry {

        /** Geometry positions */
        positions?: (number[]|null);

        /** Geometry uvs */
        uvs?: (number[]|null);

        /** Geometry indices */
        indices?: (number[]|null);

        /** Geometry lights */
        lights?: (number[]|null);
    }

    /** Represents a Geometry. */
    class Geometry implements IGeometry {

        /**
         * Constructs a new Geometry.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IGeometry);

        /** Geometry positions. */
        public positions: number[];

        /** Geometry uvs. */
        public uvs: number[];

        /** Geometry indices. */
        public indices: number[];

        /** Geometry lights. */
        public lights: number[];

        /**
         * Creates a new Geometry instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Geometry instance
         */
        public static create(properties?: protocol.IGeometry): protocol.Geometry;

        /**
         * Encodes the specified Geometry message. Does not implicitly {@link protocol.Geometry.verify|verify} messages.
         * @param message Geometry message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IGeometry, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Geometry message, length delimited. Does not implicitly {@link protocol.Geometry.verify|verify} messages.
         * @param message Geometry message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IGeometry, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Geometry message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Geometry
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.Geometry;

        /**
         * Decodes a Geometry message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Geometry
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.Geometry;

        /**
         * Verifies a Geometry message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Geometry message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Geometry
         */
        public static fromObject(object: { [k: string]: any }): protocol.Geometry;

        /**
         * Creates a plain object from a Geometry message. Also converts values to other types if specified.
         * @param message Geometry
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.Geometry, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Geometry to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    /** Properties of a Mesh. */
    interface IMesh {

        /** Mesh level */
        level?: (number|null);

        /** Mesh opaque */
        opaque?: (protocol.IGeometry|null);

        /** Mesh transparent */
        transparent?: (protocol.IGeometry|null);
    }

    /** Represents a Mesh. */
    class Mesh implements IMesh {

        /**
         * Constructs a new Mesh.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IMesh);

        /** Mesh level. */
        public level: number;

        /** Mesh opaque. */
        public opaque?: (protocol.IGeometry|null);

        /** Mesh transparent. */
        public transparent?: (protocol.IGeometry|null);

        /**
         * Creates a new Mesh instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Mesh instance
         */
        public static create(properties?: protocol.IMesh): protocol.Mesh;

        /**
         * Encodes the specified Mesh message. Does not implicitly {@link protocol.Mesh.verify|verify} messages.
         * @param message Mesh message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IMesh, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Mesh message, length delimited. Does not implicitly {@link protocol.Mesh.verify|verify} messages.
         * @param message Mesh message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IMesh, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Mesh message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Mesh
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.Mesh;

        /**
         * Decodes a Mesh message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Mesh
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.Mesh;

        /**
         * Verifies a Mesh message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Mesh message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Mesh
         */
        public static fromObject(object: { [k: string]: any }): protocol.Mesh;

        /**
         * Creates a plain object from a Mesh message. Also converts values to other types if specified.
         * @param message Mesh
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.Mesh, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Mesh to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    /** Properties of a Chunk. */
    interface IChunk {

        /** Chunk x */
        x?: (number|null);

        /** Chunk z */
        z?: (number|null);

        /** Chunk id */
        id?: (string|null);

        /** Chunk meshes */
        meshes?: (protocol.IMesh[]|null);

        /** Chunk voxels */
        voxels?: (number[]|null);

        /** Chunk lights */
        lights?: (number[]|null);
    }

    /** Represents a Chunk. */
    class Chunk implements IChunk {

        /**
         * Constructs a new Chunk.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IChunk);

        /** Chunk x. */
        public x: number;

        /** Chunk z. */
        public z: number;

        /** Chunk id. */
        public id: string;

        /** Chunk meshes. */
        public meshes: protocol.IMesh[];

        /** Chunk voxels. */
        public voxels: number[];

        /** Chunk lights. */
        public lights: number[];

        /**
         * Creates a new Chunk instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Chunk instance
         */
        public static create(properties?: protocol.IChunk): protocol.Chunk;

        /**
         * Encodes the specified Chunk message. Does not implicitly {@link protocol.Chunk.verify|verify} messages.
         * @param message Chunk message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IChunk, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Chunk message, length delimited. Does not implicitly {@link protocol.Chunk.verify|verify} messages.
         * @param message Chunk message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IChunk, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Chunk message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Chunk
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.Chunk;

        /**
         * Decodes a Chunk message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Chunk
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.Chunk;

        /**
         * Verifies a Chunk message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Chunk message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Chunk
         */
        public static fromObject(object: { [k: string]: any }): protocol.Chunk;

        /**
         * Creates a plain object from a Chunk message. Also converts values to other types if specified.
         * @param message Chunk
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.Chunk, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Chunk to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    /** Properties of a Vector3. */
    interface IVector3 {

        /** Vector3 x */
        x?: (number|null);

        /** Vector3 y */
        y?: (number|null);

        /** Vector3 z */
        z?: (number|null);
    }

    /** Represents a Vector3. */
    class Vector3 implements IVector3 {

        /**
         * Constructs a new Vector3.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IVector3);

        /** Vector3 x. */
        public x: number;

        /** Vector3 y. */
        public y: number;

        /** Vector3 z. */
        public z: number;

        /**
         * Creates a new Vector3 instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Vector3 instance
         */
        public static create(properties?: protocol.IVector3): protocol.Vector3;

        /**
         * Encodes the specified Vector3 message. Does not implicitly {@link protocol.Vector3.verify|verify} messages.
         * @param message Vector3 message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IVector3, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Vector3 message, length delimited. Does not implicitly {@link protocol.Vector3.verify|verify} messages.
         * @param message Vector3 message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IVector3, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Vector3 message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Vector3
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.Vector3;

        /**
         * Decodes a Vector3 message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Vector3
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.Vector3;

        /**
         * Verifies a Vector3 message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Vector3 message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Vector3
         */
        public static fromObject(object: { [k: string]: any }): protocol.Vector3;

        /**
         * Creates a plain object from a Vector3 message. Also converts values to other types if specified.
         * @param message Vector3
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.Vector3, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Vector3 to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    /** Properties of a Peer. */
    interface IPeer {

        /** Peer id */
        id?: (string|null);

        /** Peer username */
        username?: (string|null);

        /** Peer position */
        position?: (protocol.IVector3|null);

        /** Peer direction */
        direction?: (protocol.IVector3|null);
    }

    /** Represents a Peer. */
    class Peer implements IPeer {

        /**
         * Constructs a new Peer.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IPeer);

        /** Peer id. */
        public id: string;

        /** Peer username. */
        public username: string;

        /** Peer position. */
        public position?: (protocol.IVector3|null);

        /** Peer direction. */
        public direction?: (protocol.IVector3|null);

        /**
         * Creates a new Peer instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Peer instance
         */
        public static create(properties?: protocol.IPeer): protocol.Peer;

        /**
         * Encodes the specified Peer message. Does not implicitly {@link protocol.Peer.verify|verify} messages.
         * @param message Peer message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IPeer, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Peer message, length delimited. Does not implicitly {@link protocol.Peer.verify|verify} messages.
         * @param message Peer message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IPeer, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Peer message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Peer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.Peer;

        /**
         * Decodes a Peer message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Peer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.Peer;

        /**
         * Verifies a Peer message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Peer message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Peer
         */
        public static fromObject(object: { [k: string]: any }): protocol.Peer;

        /**
         * Creates a plain object from a Peer message. Also converts values to other types if specified.
         * @param message Peer
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.Peer, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Peer to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    /** Properties of an Entity. */
    interface IEntity {

        /** Entity id */
        id?: (string|null);

        /** Entity type */
        type?: (string|null);

        /** Entity metadata */
        metadata?: (string|null);
    }

    /** Represents an Entity. */
    class Entity implements IEntity {

        /**
         * Constructs a new Entity.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IEntity);

        /** Entity id. */
        public id: string;

        /** Entity type. */
        public type: string;

        /** Entity metadata. */
        public metadata: string;

        /**
         * Creates a new Entity instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Entity instance
         */
        public static create(properties?: protocol.IEntity): protocol.Entity;

        /**
         * Encodes the specified Entity message. Does not implicitly {@link protocol.Entity.verify|verify} messages.
         * @param message Entity message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IEntity, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Entity message, length delimited. Does not implicitly {@link protocol.Entity.verify|verify} messages.
         * @param message Entity message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IEntity, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Entity message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Entity
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.Entity;

        /**
         * Decodes an Entity message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Entity
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.Entity;

        /**
         * Verifies an Entity message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Entity message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Entity
         */
        public static fromObject(object: { [k: string]: any }): protocol.Entity;

        /**
         * Creates a plain object from an Entity message. Also converts values to other types if specified.
         * @param message Entity
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.Entity, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Entity to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    /** Properties of an Update. */
    interface IUpdate {

        /** Update vx */
        vx?: (number|null);

        /** Update vy */
        vy?: (number|null);

        /** Update vz */
        vz?: (number|null);

        /** Update voxel */
        voxel?: (number|null);

        /** Update light */
        light?: (number|null);
    }

    /** Represents an Update. */
    class Update implements IUpdate {

        /**
         * Constructs a new Update.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IUpdate);

        /** Update vx. */
        public vx: number;

        /** Update vy. */
        public vy: number;

        /** Update vz. */
        public vz: number;

        /** Update voxel. */
        public voxel: number;

        /** Update light. */
        public light: number;

        /**
         * Creates a new Update instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Update instance
         */
        public static create(properties?: protocol.IUpdate): protocol.Update;

        /**
         * Encodes the specified Update message. Does not implicitly {@link protocol.Update.verify|verify} messages.
         * @param message Update message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Update message, length delimited. Does not implicitly {@link protocol.Update.verify|verify} messages.
         * @param message Update message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Update message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Update
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.Update;

        /**
         * Decodes an Update message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Update
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.Update;

        /**
         * Verifies an Update message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Update message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Update
         */
        public static fromObject(object: { [k: string]: any }): protocol.Update;

        /**
         * Creates a plain object from an Update message. Also converts values to other types if specified.
         * @param message Update
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.Update, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Update to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    /** Properties of a ChatMessage. */
    interface IChatMessage {

        /** ChatMessage type */
        type?: (protocol.ChatMessage.Type|null);

        /** ChatMessage sender */
        sender?: (string|null);

        /** ChatMessage body */
        body?: (string|null);
    }

    /** Represents a ChatMessage. */
    class ChatMessage implements IChatMessage {

        /**
         * Constructs a new ChatMessage.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IChatMessage);

        /** ChatMessage type. */
        public type: protocol.ChatMessage.Type;

        /** ChatMessage sender. */
        public sender: string;

        /** ChatMessage body. */
        public body: string;

        /**
         * Creates a new ChatMessage instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ChatMessage instance
         */
        public static create(properties?: protocol.IChatMessage): protocol.ChatMessage;

        /**
         * Encodes the specified ChatMessage message. Does not implicitly {@link protocol.ChatMessage.verify|verify} messages.
         * @param message ChatMessage message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IChatMessage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ChatMessage message, length delimited. Does not implicitly {@link protocol.ChatMessage.verify|verify} messages.
         * @param message ChatMessage message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IChatMessage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ChatMessage message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ChatMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.ChatMessage;

        /**
         * Decodes a ChatMessage message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ChatMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.ChatMessage;

        /**
         * Verifies a ChatMessage message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ChatMessage message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ChatMessage
         */
        public static fromObject(object: { [k: string]: any }): protocol.ChatMessage;

        /**
         * Creates a plain object from a ChatMessage message. Also converts values to other types if specified.
         * @param message ChatMessage
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.ChatMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ChatMessage to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    namespace ChatMessage {

        /** Type enum. */
        enum Type {
            ERROR = 0,
            SERVER = 1,
            PLAYER = 2,
            INFO = 3
        }
    }

    /** Properties of a Message. */
    interface IMessage {

        /** Message type */
        type?: (protocol.Message.Type|null);

        /** Message json */
        json?: (string|null);

        /** Message text */
        text?: (string|null);

        /** Message chat */
        chat?: (protocol.IChatMessage|null);

        /** Message peers */
        peers?: (protocol.IPeer[]|null);

        /** Message entities */
        entities?: (protocol.IEntity[]|null);

        /** Message chunks */
        chunks?: (protocol.IChunk[]|null);

        /** Message updates */
        updates?: (protocol.IUpdate[]|null);
    }

    /** Represents a Message. */
    class Message implements IMessage {

        /**
         * Constructs a new Message.
         * @param [properties] Properties to set
         */
        constructor(properties?: protocol.IMessage);

        /** Message type. */
        public type: protocol.Message.Type;

        /** Message json. */
        public json: string;

        /** Message text. */
        public text: string;

        /** Message chat. */
        public chat?: (protocol.IChatMessage|null);

        /** Message peers. */
        public peers: protocol.IPeer[];

        /** Message entities. */
        public entities: protocol.IEntity[];

        /** Message chunks. */
        public chunks: protocol.IChunk[];

        /** Message updates. */
        public updates: protocol.IUpdate[];

        /**
         * Creates a new Message instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Message instance
         */
        public static create(properties?: protocol.IMessage): protocol.Message;

        /**
         * Encodes the specified Message message. Does not implicitly {@link protocol.Message.verify|verify} messages.
         * @param message Message message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: protocol.IMessage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Message message, length delimited. Does not implicitly {@link protocol.Message.verify|verify} messages.
         * @param message Message message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: protocol.IMessage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Message message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Message
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): protocol.Message;

        /**
         * Decodes a Message message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Message
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): protocol.Message;

        /**
         * Verifies a Message message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Message message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Message
         */
        public static fromObject(object: { [k: string]: any }): protocol.Message;

        /**
         * Creates a plain object from a Message message. Also converts values to other types if specified.
         * @param message Message
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: protocol.Message, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Message to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };
    }

    namespace Message {

        /** Type enum. */
        enum Type {
            INIT = 0,
            JOIN = 1,
            LEAVE = 2,
            ERROR = 3,
            PEER = 4,
            ENTITY = 5,
            LOAD = 6,
            UNLOAD = 7,
            UPDATE = 8,
            METHOD = 9,
            CHAT = 10
        }
    }
}
