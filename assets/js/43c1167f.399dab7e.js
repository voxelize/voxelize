"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[5760],{5827:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>l,contentTitle:()=>o,default:()=>h,frontMatter:()=>i,metadata:()=>r,toc:()=>c});var a=n(4246),s=n(1670);const i={sidebar_position:12},o="Update Voxels",r={id:"basics/update-voxels",title:"Update Voxels",description:"In order to update voxels, we need to cast a ray from the camera to the voxel world and figure out which voxel the player is looking at. Luckily, there is a very fast algorithm to do so here.",source:"@site/docs/tutorials/basics/12-update-voxels.md",sourceDirName:"basics",slug:"/basics/update-voxels",permalink:"/tutorials/basics/update-voxels",draft:!1,unlisted:!1,tags:[],version:"current",sidebarPosition:12,frontMatter:{sidebar_position:12},sidebar:"tutorialSidebar",previous:{title:"Debug Voxelize",permalink:"/tutorials/basics/debug-ui"},next:{title:"Set Perspectives",permalink:"/tutorials/basics/perspectives-and-visuals"}},l={},c=[{value:"Break on Right Click",id:"break-on-right-click",level:2},{value:"Place the Blocks",id:"place-the-blocks",level:2}];function d(e){const t={a:"a",code:"code",h1:"h1",h2:"h2",img:"img",p:"p",pre:"pre",...(0,s.a)(),...e.components};return(0,a.jsxs)(a.Fragment,{children:[(0,a.jsx)(t.h1,{id:"update-voxels",children:"Update Voxels"}),"\n",(0,a.jsxs)(t.p,{children:["In order to update voxels, we need to cast a ray from the camera to the voxel world and figure out which voxel the player is looking at. Luckily, there is a very fast algorithm to do so ",(0,a.jsx)(t.a,{href:"http://www.cse.yorku.ca/~amana/research/grid.pdf",children:"here"}),"."]}),"\n",(0,a.jsx)(t.p,{children:(0,a.jsx)(t.img,{src:n(1505).Z+"",width:"501",height:"223"})}),"\n",(0,a.jsxs)(t.p,{children:["With this method, we can quickly calculate which voxel we're looking at, and update the voxel type based on our mouse input. For example, left click to break, right click to place. Voxelize has this voxel algorithm built-in in the ",(0,a.jsx)(t.code,{children:"VOXELIZE.VoxelInteract"})," class."]}),"\n",(0,a.jsx)(t.pre,{children:(0,a.jsx)(t.code,{className:"language-javascript",metastring:'title="main.js"',children:"const voxelInteract = new VOXELIZE.VoxelInteract(camera, world, {\n    highlightType: 'outline',\n});\nworld.add(voxelInteract); // Add the highlighting mesh to the scene\n\n// ...\n\nfunction animate() {\n    if (world.isInitialized) {\n        voxelInteract.update();\n    }\n}\n"})}),"\n",(0,a.jsx)(t.pre,{children:(0,a.jsx)(t.code,{className:"language-html",metastring:'title="index.html"',children:'<div id="app">\n    <canvas id="canvas"></canvas>\n    <div id="crosshair" />\n</div>\n'})}),"\n",(0,a.jsx)(t.pre,{children:(0,a.jsx)(t.code,{className:"language-css",metastring:'title="style.css"',children:"#crosshair {\n  width: 12px;\n  height: 12px;\n  border: 2px solid #fff3;\n  border-radius: 6px;\n  position: fixed;\n  top: 50%;\n  left: 50%;\n  transform: translate(-50%, -50%);\n}\n"})}),"\n",(0,a.jsx)(t.p,{children:(0,a.jsx)(t.img,{src:n(8025).Z+"",width:"2560",height:"1440"})}),"\n",(0,a.jsx)(t.p,{children:"With this, you should be able to see a white outline to wherever we're looking at with a semi-transparent crosshair in the middle."}),"\n",(0,a.jsx)(t.h2,{id:"break-on-right-click",children:"Break on Right Click"}),"\n",(0,a.jsxs)(t.p,{children:["It is really easy too to implement block breaking. We can use the ",(0,a.jsx)(t.code,{children:"VOXELIZE.Inputs"})," that we created earlier to do so."]}),"\n",(0,a.jsx)(t.pre,{children:(0,a.jsx)(t.code,{className:"language-javascript",metastring:'title="main.js"',children:"inputs.click('left', () => {\n    if (!voxelInteract.target) return;\n\n    const [x, y, z] = voxelInteract.target;\n    world.updateVoxel(x, y, z, 0);\n});\n"})}),"\n",(0,a.jsxs)(t.p,{children:["As you can see, ",(0,a.jsx)(t.code,{children:"world.updateVoxel"})," is what we need to make server changes. What happens internally is that the world adds a ",(0,a.jsx)(t.code,{children:"UPDATE"})," type packet to it's ",(0,a.jsx)(t.code,{children:"packets"})," array, and it gets sent to the server. The server handles the chunk updates, and sends back the new chunk information back."]}),"\n",(0,a.jsx)(t.h2,{id:"place-the-blocks",children:"Place the Blocks"}),"\n",(0,a.jsxs)(t.p,{children:["To place the blocks, we can use the ",(0,a.jsx)(t.a,{href:"/api/client/classes/VoxelInteract#potential",children:(0,a.jsx)(t.code,{children:"voxelInteract.potential"})}),", which is calculated using the target position and the normal of the face hit."]}),"\n",(0,a.jsx)(t.pre,{children:(0,a.jsx)(t.code,{className:"language-javascript",metastring:'title="main.js"',children:"let holdingBlockType = 1; // Hold dirt by default\n\ninputs.click('middle', () => {\n    if (!voxelInteract.target) return;\n\n    const [x, y, z] = voxelInteract.target;\n    holdingBlockType = world.getVoxelAt(x, y, z);\n});\n\ninputs.click('right', () => {\n    if (!voxelInteract.potential) return;\n\n    const { voxel } = voxelInteract.potential;\n    world.updateVoxel(...voxel, holdingBlockType);\n});\n"})}),"\n",(0,a.jsx)(t.p,{children:(0,a.jsx)(t.img,{src:n(7134).Z+"",width:"2560",height:"1440"})}),"\n",(0,a.jsx)(t.p,{children:"Just like that, you can now left click to break, middle click to obtain block, and right click to place!"})]})}function h(e={}){const{wrapper:t}={...(0,s.a)(),...e.components};return t?(0,a.jsx)(t,{...e,children:(0,a.jsx)(d,{...e})}):d(e)}},7134:(e,t,n)=>{n.d(t,{Z:()=>a});const a=n.p+"assets/images/block-placements-b8a046581021a67549777dd7a2fb2a48.png"},1505:(e,t,n)=>{n.d(t,{Z:()=>a});const a=n.p+"assets/images/raycast-8c7b421be865967f053f189c73bc1cf6.png"},8025:(e,t,n)=>{n.d(t,{Z:()=>a});const a=n.p+"assets/images/voxel-interact-1f2489de90f51a954a806ef2ed8d0f07.png"},1670:(e,t,n)=>{n.d(t,{Z:()=>r,a:()=>o});var a=n(7378);const s={},i=a.createContext(s);function o(e){const t=a.useContext(i);return a.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function r(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(s):e.components||s:o(e.components),a.createElement(i.Provider,{value:t},e.children)}}}]);