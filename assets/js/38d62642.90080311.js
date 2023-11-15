"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[4331],{5553:(e,t,s)=>{s.r(t),s.d(t,{assets:()=>o,contentTitle:()=>r,default:()=>h,frontMatter:()=>i,metadata:()=>c,toc:()=>d});var n=s(4246),a=s(1670);const i={sidebar_position:13},r="Set Perspectives",c={id:"basics/perspectives-and-visuals",title:"Set Perspectives",description:"Me personally, I really like to play games in 3rd person's perspective. So, let's quickly add perspective switching to our app by pressing \"c\".",source:"@site/docs/tutorials/basics/13-perspectives-and-visuals.md",sourceDirName:"basics",slug:"/basics/perspectives-and-visuals",permalink:"/tutorials/basics/perspectives-and-visuals",draft:!1,unlisted:!1,tags:[],version:"current",sidebarPosition:13,frontMatter:{sidebar_position:13},sidebar:"tutorialSidebar",previous:{title:"Update Voxels",permalink:"/tutorials/basics/update-voxels"},next:{title:"Multiplayer",permalink:"/tutorials/basics/multiplayer"}},o={},d=[{value:"Add a Voxelize Character",id:"add-a-voxelize-character",level:2},{value:"Shadows and Light Shined",id:"shadows-and-light-shined",level:2}];function l(e){const t={code:"code",h1:"h1",h2:"h2",img:"img",p:"p",pre:"pre",...(0,a.a)(),...e.components};return(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(t.h1,{id:"set-perspectives",children:"Set Perspectives"}),"\n",(0,n.jsx)(t.p,{children:"Me personally, I really like to play games in 3rd person's perspective. So, let's quickly add perspective switching to our app by pressing \"c\"."}),"\n",(0,n.jsx)(t.pre,{children:(0,n.jsx)(t.code,{className:"language-javascript",metastring:'title="main.js"',children:'const perspectives = new VOXELIZE.Perspective(rigidControls, world);\nperspectives.connect(inputs); // Binds "c" by default\n\nfunction animate() {\n    if (world.isInitialized) {\n        perspectives.update();\n    }\n}\n'})}),"\n",(0,n.jsx)(t.p,{children:"However, you'll realize when you press \"c\", it seems like the camera's perspectives changed. Yet, there doesn't seem to be anything to look at. The example below shows a 2nd person perspective with nothing to look at."}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.img,{src:s(8260).Z+"",width:"2560",height:"1440"})}),"\n",(0,n.jsxs)(t.p,{children:["To solve this, let's add a Voxelize character to our ",(0,n.jsx)(t.code,{children:"rigidControls"}),"."]}),"\n",(0,n.jsx)(t.h2,{id:"add-a-voxelize-character",children:"Add a Voxelize Character"}),"\n",(0,n.jsx)(t.p,{children:"We're going to create a utility function to create our characters. This is useful because later on when we add multiplayer, we can reuse this function."}),"\n",(0,n.jsx)(t.pre,{children:(0,n.jsx)(t.code,{className:"language-javascript",metastring:'title="main.js"',children:"function createCharacter() {\n    const character = new VOXELIZE.Character();\n    world.add(character);\n    return character;\n}\n\nconst mainCharacter = createCharacter();\nrigidControls.attachCharacter(mainCharacter);\n"})}),"\n",(0,n.jsx)(t.p,{children:"Just like that, we have our main character in place."}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.img,{src:s(1816).Z+"",width:"2560",height:"1440"})}),"\n",(0,n.jsx)(t.h2,{id:"shadows-and-light-shined",children:"Shadows and Light Shined"}),"\n",(0,n.jsx)(t.p,{children:"Voxelize comes with an option to create shadows as well. A shadow is just a darken-transparent circle that is placed below a given object in the scene. The shadow is automatically updated to stick on the ground, and changes size with how far the object is from the ground."}),"\n",(0,n.jsxs)(t.p,{children:["Also, ",(0,n.jsx)(t.code,{children:"VOXELIZE.LightShined"})," is a ulitity to recursively update an object's light level based on the voxel lighting around it. Otherwise, since Voxelize uses ",(0,n.jsx)(t.code,{children:"MeshBasicMaterial"})," for most of its things, it would appear to be bright even at night time."]}),"\n",(0,n.jsx)(t.pre,{children:(0,n.jsx)(t.code,{className:"language-javascript",metastring:'title="main.js"',children:"const shadows = new VOXELIZE.Shadows(world);\nconst lightShined = new VOXELIZE.LightShined(world);\n\nfunction createCharacter() {\n    const character = new VOXELIZE.Character();\n    world.add(character);\n    // highlight-start\n    lightShined.add(character);\n    shadows.add(character);\n    // highlight-end\n    return character;\n}\n\n// ...\n\nfunction animate() {\n    if (world.isInitialized) {\n        // ...\n        lightShined.update();\n        shadows.update();\n        // ...\n    }\n}\n"})}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.img,{src:s(7103).Z+"",width:"2560",height:"1440"})}),"\n",(0,n.jsx)(t.p,{children:"Notice how the character is dimmed, and there appears to be a shadow below."})]})}function h(e={}){const{wrapper:t}={...(0,a.a)(),...e.components};return t?(0,n.jsx)(t,{...e,children:(0,n.jsx)(l,{...e})}):l(e)}},8260:(e,t,s)=>{s.d(t,{Z:()=>n});const n=s.p+"assets/images/2nd-person-d400080def1bfe00075abbdcea98316c.png"},1816:(e,t,s)=>{s.d(t,{Z:()=>n});const n=s.p+"assets/images/main-character-2nd-perspective-149e4ff3e38cb964fb232dd7a097e242.png"},7103:(e,t,s)=>{s.d(t,{Z:()=>n});const n=s.p+"assets/images/night-time-shadow-light-shined-b3e9e414dcecfe1e2dcf73d92a51b995.png"},1670:(e,t,s)=>{s.d(t,{Z:()=>c,a:()=>r});var n=s(7378);const a={},i=n.createContext(a);function r(e){const t=n.useContext(i);return n.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function c(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(a):e.components||a:r(e.components),n.createElement(i.Provider,{value:t},e.children)}}}]);