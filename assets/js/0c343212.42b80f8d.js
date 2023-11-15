"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[4639],{466:(e,n,s)=>{s.r(n),s.d(n,{assets:()=>r,contentTitle:()=>c,default:()=>a,frontMatter:()=>l,metadata:()=>d,toc:()=>o});var i=s(4246),t=s(1670);const l={sidebar_position:1},c="Entity Component System",d={id:"intermediate/entity-component-system",title:"Entity Component System",description:"Voxelize servers run on the Specs ECS crate. It is recommended to read through the Specs ECS tutorial before continuing.",source:"@site/docs/tutorials/intermediate/1-entity-component-system.md",sourceDirName:"intermediate",slug:"/intermediate/entity-component-system",permalink:"/tutorials/intermediate/entity-component-system",draft:!1,unlisted:!1,tags:[],version:"current",sidebarPosition:1,frontMatter:{sidebar_position:1},sidebar:"tutorialSidebar",previous:{title:"Intermediate",permalink:"/tutorials/category/intermediate"},next:{title:"the-client-entity",permalink:"/tutorials/intermediate/the-client-entity"}},r={},o=[{value:"Components",id:"components",level:2},{value:"Null-storage Flags",id:"null-storage-flags",level:3},{value:"Informational Components",id:"informational-components",level:3},{value:"Physical Components",id:"physical-components",level:3},{value:"Miscellaneous Components",id:"miscellaneous-components",level:3},{value:"Resources",id:"resources",level:2},{value:"Informational",id:"informational",level:3},{value:"Managers",id:"managers",level:3},{value:"Utilities",id:"utilities",level:3},{value:"Systems",id:"systems",level:2}];function h(e){const n={a:"a",admonition:"admonition",code:"code",h1:"h1",h2:"h2",h3:"h3",li:"li",p:"p",pre:"pre",strong:"strong",ul:"ul",...(0,t.a)(),...e.components};return(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(n.h1,{id:"entity-component-system",children:"Entity Component System"}),"\n",(0,i.jsxs)(n.p,{children:["Voxelize servers run on the ",(0,i.jsx)(n.a,{href:"https://specs.amethyst.rs/docs/tutorials/",children:"Specs ECS crate"}),". It is recommended to read through the Specs ECS tutorial before continuing."]}),"\n",(0,i.jsx)(n.h2,{id:"components",children:"Components"}),"\n",(0,i.jsxs)(n.p,{children:["Essentially, ECS allows Voxelize to decouple in-game objects into separate components. For instance, an entity that simply moves up and down could have a ",(0,i.jsx)(n.code,{children:"Position"})," component and a ",(0,i.jsx)(n.code,{children:"Velocity"})," component. An entity would simply be a holder of a set of components."]}),"\n",(0,i.jsxs)(n.p,{children:["By default, Voxelize comes with ",(0,i.jsx)(n.a,{href:"https://github.com/voxelize/voxelize/blob/6f372f38b9bac4c454f4106286dc5256df79cb82/server/world/mod.rs#L186-L200",children:"these components"})," added to the ECS world:"]}),"\n",(0,i.jsx)(n.h3,{id:"null-storage-flags",children:"Null-storage Flags"}),"\n",(0,i.jsx)(n.p,{children:"These flags take up no space on disk, and is simply used to distinguish clients to non-client entities."}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ClientFlag"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A component indicating if an entity is a client."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"EntityFlag"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A component indicating if an entity is a non-client."}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsx)(n.h3,{id:"informational-components",children:"Informational Components"}),"\n",(0,i.jsx)(n.p,{children:"These components adds additional information about an entity, whether a client or not."}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"IDComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"All entities have their Voxelize given ID."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"NameComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A name given to the entity."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ChunkRequestComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A list of chunks requested by entity (client)."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"CurrentChunkComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"Which chunk the client is in, updated each frame."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"PositionComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A set of 3D coordinates describing the position of an entity."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"DirectionComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A set of 3D coordinates indicating the direction the entity is looking."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ETypeComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:["A string to differentiate the type of entity, such as ",(0,i.jsx)(n.code,{children:'"Cow"'}),"."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"MetadataComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A JSON-compatible object to store data sent to the client-side or saved to disk."}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsx)(n.h3,{id:"physical-components",children:"Physical Components"}),"\n",(0,i.jsx)(n.p,{children:"The components below make an entity physical in the Voxelize world."}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"RigidBodyComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A collision box that can collide with voxel blocks."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"InteractorComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A collision box that can collide with other collision blocks."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"CollisionsComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A vector storing all collisions this entity has per frame."}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsx)(n.h3,{id:"miscellaneous-components",children:"Miscellaneous Components"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"AddrComp"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"Client's Actix actor address."}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsx)(n.p,{children:"To register new components to the Voxelize world, we do the following:"}),"\n",(0,i.jsx)(n.pre,{children:(0,i.jsx)(n.code,{className:"language-rust",children:"use specs::{Component, VecStorage};\n\n#[derive(Component, Debug)]\n#[storage(VecStorage)]\nstruct CustomComp {\n    a: f32,\n    b: f32,\n}\n\nworld.ecs().register::<CustomComp>();\n"})}),"\n",(0,i.jsxs)(n.p,{children:["We can then create entities with this ",(0,i.jsx)(n.code,{children:"CustomComp"}),":"]}),"\n",(0,i.jsx)(n.pre,{children:(0,i.jsx)(n.code,{className:"language-rust",children:'let custom_entity = world\n    .create_entity("Custom Entity")\n    .with(CustomComp { a: 1.0, b: 3.0 })\n    .build();\n'})}),"\n",(0,i.jsxs)(n.admonition,{type:"info",children:[(0,i.jsxs)(n.p,{children:[(0,i.jsx)(n.a,{href:"https://github.com/voxelize/voxelize/blob/6f372f38b9bac4c454f4106286dc5256df79cb82/server/world/mod.rs#L587-L596",children:(0,i.jsx)(n.code,{children:"world.create_entity(<type name>)"})})," calls ",(0,i.jsx)(n.code,{children:"world.ecs().create_entity()"})," internally, and adds these components by default to integrate with Voxelize:"]}),(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.code,{children:"IDComp"})}),"\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.code,{children:"EntityFlag"})}),"\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.code,{children:"ETypeComp"})}),"\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.code,{children:"MetadataComp"})}),"\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.code,{children:"CurrentChunkComp"})}),"\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.code,{children:"CollisionsComp"})}),"\n"]})]}),"\n",(0,i.jsx)(n.h2,{id:"resources",children:"Resources"}),"\n",(0,i.jsxs)(n.p,{children:["Another building block of a Voxelize world is a set of ",(0,i.jsx)(n.strong,{children:"resources"})," built-in. Resources are stateful structs that can be shared across all systems. In Voxelize, a world comes with ",(0,i.jsx)(n.a,{href:"https://github.com/voxelize/voxelize/blob/6f372f38b9bac4c454f4106286dc5256df79cb82/server/world/mod.rs#L202-L218",children:"these resources"}),":"]}),"\n",(0,i.jsx)(n.h3,{id:"informational",children:"Informational"}),"\n",(0,i.jsx)(n.p,{children:"These are the static resources that shouldn't be modified."}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"String"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A string of the name of the world."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.WorldConfig.html",children:(0,i.jsx)(n.code,{children:"WorldConfig"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:["The configurations of the world. Can be accessed through ",(0,i.jsx)(n.code,{children:"world.config()"}),"."]}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsx)(n.h3,{id:"managers",children:"Managers"}),"\n",(0,i.jsx)(n.p,{children:"These are the structs that manage and pass around the data stored in the world."}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.Chunks.html",children:(0,i.jsx)(n.code,{children:"Chunks"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"The chunking manager of the world."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.Entities.html",children:(0,i.jsx)(n.code,{children:"Entities"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A manager that can handle the spawning and saving of entities."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.Pipeline.html",children:(0,i.jsx)(n.code,{children:"Pipeline"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"The chunking pipeline that takes care of generating chunks in parallel."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/type.Clients.html",children:(0,i.jsx)(n.code,{children:"Clients"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A hash map of all clients that has joined this world."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/type.MessageQueue.html",children:(0,i.jsx)(n.code,{children:"MessageQueue"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A list of encoded protobuf messages that gets sent to the client each tick."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.Events.html",children:(0,i.jsx)(n.code,{children:"Events"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"Managing all events that can be emitted to the clients."}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.p,{children:["The manager resources can be accessed through the world directly. For instance, ",(0,i.jsx)(n.code,{children:"world.chunks()"})," or ",(0,i.jsx)(n.code,{children:"world.chunks_mut()"})," or ",(0,i.jsx)(n.code,{children:"world.clients_mut()"}),"."]}),"\n",(0,i.jsx)(n.h3,{id:"utilities",children:"Utilities"}),"\n",(0,i.jsx)(n.p,{children:"These are the utility resources that can be used as helpers."}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.Stats.html",children:(0,i.jsx)(n.code,{children:"Stats"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"The world stats such as delta time."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.Mesher.html",children:(0,i.jsx)(n.code,{children:"Mesher"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A manager that takes care of all the chunk 3D meshing in parallel."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.Search.html",children:(0,i.jsx)(n.code,{children:"Search"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A 3-dimensional tree that has all the clients and entities to search for."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.Terrain.html",children:(0,i.jsx)(n.code,{children:"Terrain"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A seeded terrain manager to generate terrain."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.a,{href:"https://docs.rs/voxelize/0.8.7/voxelize/struct.SeededNoise.html",children:(0,i.jsx)(n.code,{children:"Noise"})}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:"A seeded noise manager to make 2D or 3D noise."}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsx)(n.p,{children:"You can add your own resources to the ECS world in order to be used in an ECS system too by doing so:"}),"\n",(0,i.jsx)(n.pre,{children:(0,i.jsx)(n.code,{className:"language-rust",children:"struct CustomResource {\n    a: f32,\n}\n\nworld.ecs().insert(CustomResource { a: 1.0 }});\n"})}),"\n",(0,i.jsx)(n.h2,{id:"systems",children:"Systems"}),"\n",(0,i.jsxs)(n.p,{children:["Developers can then write ",(0,i.jsx)(n.strong,{children:"systems"})," that operate on specific ",(0,i.jsx)(n.strong,{children:"components"}),". An example could be a ",(0,i.jsx)(n.code,{children:"PositionUpdateSystem"})," that operates on all entities with a ",(0,i.jsx)(n.code,{children:"Position"})," and a ",(0,i.jsx)(n.code,{children:"Velocity"})," component, and this system could simply add each entity's ",(0,i.jsx)(n.code,{children:"Velocity"})," to ",(0,i.jsx)(n.code,{children:"Position"})," to move the entity accordingly."]}),"\n",(0,i.jsxs)(n.p,{children:["Voxelize by default comes with a ",(0,i.jsx)(n.a,{href:"https://specs.amethyst.rs/docs/tutorials/03_dispatcher.html",children:"Specs dispatcher"})," that runs ",(0,i.jsx)(n.a,{href:"https://github.com/voxelize/voxelize/blob/02d05e9baf07529df0d7ce5d9d4e4efc600ec6f7/server/world/mod.rs#L132-L171",children:"these set of systems"}),":"]}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"UpdateStatsSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.strong,{children:"Should run at the start of the dispatcher"})}),"\n",(0,i.jsxs)(n.li,{children:["Updates the ",(0,i.jsx)(n.code,{children:"Stats"})," resources to the latest delta time which can be used by systems in the ",(0,i.jsx)(n.code,{children:"PhysicsSystem"}),"."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"EntitiesMetaSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.strong,{children:"Should run at the start of the dispatcher"})}),"\n",(0,i.jsxs)(n.li,{children:["Adds the ",(0,i.jsx)(n.code,{children:"PositionComp"})," of all non-client entities into their respective ",(0,i.jsx)(n.code,{children:"MetadataComp"})," to be sent to the client side."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"PeersMetaSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.strong,{children:"Should run at the start of the dispatcher"})}),"\n",(0,i.jsxs)(n.li,{children:["Adds the ",(0,i.jsx)(n.code,{children:"PositionComp"}),", ",(0,i.jsx)(n.code,{children:"DirectionComp"}),", and ",(0,i.jsx)(n.code,{children:"NameComp"})," into all client entities' ",(0,i.jsx)(n.code,{children:"MetadataComp"})," to update peers."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"CurrentChunkSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsx)(n.strong,{children:"Should run at the start of the dispatcher"})}),"\n",(0,i.jsx)(n.li,{children:"Calculates the current chunks of all entities."}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ChunkUpdatingSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"CurrentChunkSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Handles the voxel updates by updating ",(0,i.jsx)(n.code,{children:"config.max_updates_per_tick"})," of received updates per tick."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ChunkRequestsSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"CurrentChunkSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Queues all chunks from any ",(0,i.jsx)(n.code,{children:"ChunkRequestComp"})," into the chunk pipeline to be processed."]}),"\n",(0,i.jsxs)(n.li,{children:["Adds any chunks that are ready to ",(0,i.jsx)(n.code,{children:"world.chunks().to_send"})," to be sent to the clients."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ChunkPipeliningSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"ChunkRequestsSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Pushes ",(0,i.jsx)(n.code,{children:"config.max_chunks_per_tick"})," of chunks per tick into a list of chunk phases to populate them with chunk data."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ChunkMeshingSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"ChunkUpdatingSystem"})," and ",(0,i.jsx)(n.code,{children:"ChunkPipelineSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Meshes ",(0,i.jsx)(n.code,{children:"config.max_chunks_per_tick"})," of chunks per tick into ",(0,i.jsx)(n.code,{children:"config.sub_chunks"})," amount of sub chunk 3D meshes."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ChunkSendingSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"ChunkMeshingSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Packs the chunks from ",(0,i.jsx)(n.code,{children:"world.chunks().to_send"})," along with clients that had requested for those chunks into the ",(0,i.jsx)(n.code,{children:"MessageQueue"})," resource."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ChunkSavingSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"ChunkMeshingSystem"})]})}),"\n",(0,i.jsxs)(n.li,{children:["Every ",(0,i.jsx)(n.code,{children:"config.save_interval"})," ticks, saves the chunk data into ",(0,i.jsx)(n.code,{children:"config.save_dir"})," if ",(0,i.jsx)(n.code,{children:"config.saving"})," is set true."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"PhysicsSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"CurrentChunkSystem"})," and ",(0,i.jsx)(n.code,{children:"UpdateStatsSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Updates ",(0,i.jsx)(n.code,{children:"RigidBodyComp"})," according to chunk data."]}),"\n",(0,i.jsxs)(n.li,{children:["Calculates ",(0,i.jsx)(n.code,{children:"CollisionsComp"})," through ",(0,i.jsx)(n.code,{children:"InteractorComp"})," by calculating the physics collisions through ",(0,i.jsx)(n.a,{href:"https://rapier.rs/",children:"rapier physics"}),"."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"DataSavingSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"EntitiesMetaSystem"})," and any non-client metadata systems."]})}),"\n",(0,i.jsxs)(n.li,{children:["Every ",(0,i.jsx)(n.code,{children:"config.save_interval"}),", saves the entities data into ",(0,i.jsx)(n.code,{children:"config.save_dir"})," if ",(0,i.jsx)(n.code,{children:"config.saving"})," is set true."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"EntitiesSendingSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"EntitiesMetaSystem"})," and ",(0,i.jsx)(n.strong,{children:"any non-client metadata systems"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["If any entities have changed their metadata, the metadata is packed and pushed to the ",(0,i.jsx)(n.code,{children:"MessageQueue"})," resource."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"PeersSendingSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"PeersMetaSystem"})," and ",(0,i.jsx)(n.strong,{children:"any client metadata systems"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["If any clients have changed their metadata, the metadata is packed and pushed to the ",(0,i.jsx)(n.code,{children:"MessageQueue"})," resource."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"BroadcastSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"EntitiesSendingSystem"}),", ",(0,i.jsx)(n.code,{children:"PeersSendingSystem"}),", and ",(0,i.jsx)(n.code,{children:"ChunkSendingSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Actually sends the packed messages in the ",(0,i.jsx)(n.code,{children:"MessageQueue"})," to the specified clients."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"ClearCollisionSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"EntitiesSendingSystem"})," and ",(0,i.jsx)(n.code,{children:"PeersSendingSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Clears the collisions generated by ",(0,i.jsx)(n.code,{children:"PhysicsSystem"}),"."]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.li,{children:[(0,i.jsx)(n.code,{children:"EventsSystem"}),"\n",(0,i.jsxs)(n.ul,{children:["\n",(0,i.jsx)(n.li,{children:(0,i.jsxs)(n.strong,{children:["Should be dependent on ",(0,i.jsx)(n.code,{children:"BroadcastSystem"}),"."]})}),"\n",(0,i.jsxs)(n.li,{children:["Packs all events in the ",(0,i.jsx)(n.code,{children:"Events"})," resource and send them to the specified clients."]}),"\n"]}),"\n"]}),"\n"]}),"\n",(0,i.jsxs)(n.p,{children:["To customize the dispatcher, checkout ",(0,i.jsx)(n.a,{href:"./customizing-the-ecs",children:"this tutorial"}),"."]})]})}function a(e={}){const{wrapper:n}={...(0,t.a)(),...e.components};return n?(0,i.jsx)(n,{...e,children:(0,i.jsx)(h,{...e})}):h(e)}},1670:(e,n,s)=>{s.d(n,{Z:()=>d,a:()=>c});var i=s(7378);const t={},l=i.createContext(t);function c(e){const n=i.useContext(l);return i.useMemo((function(){return"function"==typeof e?e(n):{...n,...e}}),[n,e])}function d(e){let n;return n=e.disableParentContext?"function"==typeof e.components?e.components(t):e.components||t:c(e.components),i.createElement(l.Provider,{value:n},e.children)}}}]);