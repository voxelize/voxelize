"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[5157],{6314:(e,t,l)=>{l.r(t),l.d(t,{assets:()=>h,contentTitle:()=>s,default:()=>j,frontMatter:()=>i,metadata:()=>d,toc:()=>c});var n=l(4246),r=l(1670);const i={id:"LightUtils",title:"Class: LightUtils",sidebar_label:"LightUtils",sidebar_position:0,custom_edit_url:null},s="Example",d={id:"client/classes/LightUtils",title:"Class: LightUtils",description:"A utility class for extracting and inserting light data from and into numbers.",source:"@site/docs/api/client/classes/LightUtils.md",sourceDirName:"client/classes",slug:"/client/classes/LightUtils",permalink:"/api/client/classes/LightUtils",draft:!1,unlisted:!1,editUrl:null,tags:[],version:"current",sidebarPosition:0,frontMatter:{id:"LightUtils",title:"Class: LightUtils",sidebar_label:"LightUtils",sidebar_position:0,custom_edit_url:null},sidebar:"tutorialSidebar",previous:{title:"LightShined",permalink:"/api/client/classes/LightShined"},next:{title:"Loader",permalink:"/api/client/classes/Loader"}},h={},c=[{value:"Methods",id:"methods",level:2},{value:"canEnter",id:"canenter",level:3},{value:"Parameters",id:"parameters",level:4},{value:"Returns",id:"returns",level:4},{value:"canEnterInto",id:"canenterinto",level:3},{value:"Parameters",id:"parameters-1",level:4},{value:"Returns",id:"returns-1",level:4},{value:"extractBlueLight",id:"extractbluelight",level:3},{value:"Parameters",id:"parameters-2",level:4},{value:"Returns",id:"returns-2",level:4},{value:"extractGreenLight",id:"extractgreenlight",level:3},{value:"Parameters",id:"parameters-3",level:4},{value:"Returns",id:"returns-3",level:4},{value:"extractRedLight",id:"extractredlight",level:3},{value:"Parameters",id:"parameters-4",level:4},{value:"Returns",id:"returns-4",level:4},{value:"extractSunlight",id:"extractsunlight",level:3},{value:"Parameters",id:"parameters-5",level:4},{value:"Returns",id:"returns-5",level:4},{value:"insertBlueLight",id:"insertbluelight",level:3},{value:"Parameters",id:"parameters-6",level:4},{value:"Returns",id:"returns-6",level:4},{value:"insertGreenLight",id:"insertgreenlight",level:3},{value:"Parameters",id:"parameters-7",level:4},{value:"Returns",id:"returns-7",level:4},{value:"insertRedLight",id:"insertredlight",level:3},{value:"Parameters",id:"parameters-8",level:4},{value:"Returns",id:"returns-8",level:4},{value:"insertSunlight",id:"insertsunlight",level:3},{value:"Parameters",id:"parameters-9",level:4},{value:"Returns",id:"returns-9",level:4}];function x(e){const t={a:"a",code:"code",h1:"h1",h2:"h2",h3:"h3",h4:"h4",hr:"hr",li:"li",p:"p",pre:"pre",strong:"strong",table:"table",tbody:"tbody",td:"td",th:"th",thead:"thead",tr:"tr",ul:"ul",...(0,r.a)(),...e.components};return(0,n.jsxs)(n.Fragment,{children:[(0,n.jsx)(t.p,{children:"A utility class for extracting and inserting light data from and into numbers."}),"\n",(0,n.jsx)(t.p,{children:"The light data is stored in the following format:"}),"\n",(0,n.jsxs)(t.ul,{children:["\n",(0,n.jsxs)(t.li,{children:["Sunlight: ",(0,n.jsx)(t.code,{children:"0xff000000"})]}),"\n",(0,n.jsxs)(t.li,{children:["Red light: ",(0,n.jsx)(t.code,{children:"0x00ff0000"})]}),"\n",(0,n.jsxs)(t.li,{children:["Green light: ",(0,n.jsx)(t.code,{children:"0x0000ff00"})]}),"\n",(0,n.jsxs)(t.li,{children:["Blue light: ",(0,n.jsx)(t.code,{children:"0x000000ff"})]}),"\n"]}),"\n",(0,n.jsxs)(t.p,{children:["TODO-DOCS\nFor more information about lighting data, see ",(0,n.jsx)(t.a,{href:"/",children:"here"})]}),"\n",(0,n.jsx)(t.h1,{id:"example",children:"Example"}),"\n",(0,n.jsx)(t.pre,{children:(0,n.jsx)(t.code,{className:"language-ts",children:"// Insert a level 13 sunlight into zero.\nconst number = LightUtils.insertSunlight(0, 13);\n"})}),"\n",(0,n.jsx)(t.h2,{id:"methods",children:"Methods"}),"\n",(0,n.jsx)(t.h3,{id:"canenter",children:"canEnter"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"canEnter"}),"(",(0,n.jsx)(t.code,{children:"source"}),", ",(0,n.jsx)(t.code,{children:"target"}),", ",(0,n.jsx)(t.code,{children:"dx"}),", ",(0,n.jsx)(t.code,{children:"dy"}),", ",(0,n.jsx)(t.code,{children:"dz"}),"): ",(0,n.jsx)(t.code,{children:"boolean"})]}),"\n",(0,n.jsx)(t.p,{children:"Check to see if light can enter from one block to another."}),"\n",(0,n.jsx)(t.h4,{id:"parameters",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsxs)(t.tbody,{children:[(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"source"})}),(0,n.jsxs)(t.td,{style:{textAlign:"left"},children:[(0,n.jsx)(t.code,{children:"boolean"}),"[]"]}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The source block's transparency."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"target"})}),(0,n.jsxs)(t.td,{style:{textAlign:"left"},children:[(0,n.jsx)(t.code,{children:"boolean"}),"[]"]}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The target block's transparency."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"dx"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The change in x direction."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"dy"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The change in y direction."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"dz"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The change in z direction."})]})]})]}),"\n",(0,n.jsx)(t.h4,{id:"returns",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"boolean"})}),"\n",(0,n.jsx)(t.p,{children:"Whether light can enter from the source block to the target block."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"canenterinto",children:"canEnterInto"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"canEnterInto"}),"(",(0,n.jsx)(t.code,{children:"target"}),", ",(0,n.jsx)(t.code,{children:"dx"}),", ",(0,n.jsx)(t.code,{children:"dy"}),", ",(0,n.jsx)(t.code,{children:"dz"}),"): ",(0,n.jsx)(t.code,{children:"boolean"})]}),"\n",(0,n.jsx)(t.p,{children:'Check to see if light can go "into" one block, disregarding the source.'}),"\n",(0,n.jsx)(t.h4,{id:"parameters-1",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsxs)(t.tbody,{children:[(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"target"})}),(0,n.jsxs)(t.td,{style:{textAlign:"left"},children:[(0,n.jsx)(t.code,{children:"boolean"}),"[]"]}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The target block's transparency."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"dx"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The change in x direction."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"dy"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The change in y direction."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"dz"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The change in z direction."})]})]})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-1",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"boolean"})}),"\n",(0,n.jsx)(t.p,{children:"Whether light can enter into the target block."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"extractbluelight",children:"extractBlueLight"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"extractBlueLight"}),"(",(0,n.jsx)(t.code,{children:"light"}),"): ",(0,n.jsx)(t.code,{children:"number"})]}),"\n",(0,n.jsx)(t.p,{children:"Extract the blue light level from a number."}),"\n",(0,n.jsx)(t.h4,{id:"parameters-2",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsx)(t.tbody,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"light"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The light value to extract from."})]})})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-2",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"number"})}),"\n",(0,n.jsx)(t.p,{children:"The extracted blue light value."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"extractgreenlight",children:"extractGreenLight"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"extractGreenLight"}),"(",(0,n.jsx)(t.code,{children:"light"}),"): ",(0,n.jsx)(t.code,{children:"number"})]}),"\n",(0,n.jsx)(t.p,{children:"Extract the green light level from a number."}),"\n",(0,n.jsx)(t.h4,{id:"parameters-3",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsx)(t.tbody,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"light"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The light value to extract from."})]})})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-3",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"number"})}),"\n",(0,n.jsx)(t.p,{children:"The extracted green light value."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"extractredlight",children:"extractRedLight"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"extractRedLight"}),"(",(0,n.jsx)(t.code,{children:"light"}),"): ",(0,n.jsx)(t.code,{children:"number"})]}),"\n",(0,n.jsx)(t.p,{children:"Extract the red light level from a number."}),"\n",(0,n.jsx)(t.h4,{id:"parameters-4",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsx)(t.tbody,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"light"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The light value to extract from."})]})})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-4",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"number"})}),"\n",(0,n.jsx)(t.p,{children:"The extracted red light value."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"extractsunlight",children:"extractSunlight"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"extractSunlight"}),"(",(0,n.jsx)(t.code,{children:"light"}),"): ",(0,n.jsx)(t.code,{children:"number"})]}),"\n",(0,n.jsx)(t.p,{children:"Extract the sunlight level from a number."}),"\n",(0,n.jsx)(t.h4,{id:"parameters-5",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsx)(t.tbody,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"light"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The light value to extract from."})]})})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-5",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"number"})}),"\n",(0,n.jsx)(t.p,{children:"The extracted sunlight value."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"insertbluelight",children:"insertBlueLight"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"insertBlueLight"}),"(",(0,n.jsx)(t.code,{children:"light"}),", ",(0,n.jsx)(t.code,{children:"level"}),"): ",(0,n.jsx)(t.code,{children:"number"})]}),"\n",(0,n.jsx)(t.p,{children:"Insert a blue light level into a number."}),"\n",(0,n.jsx)(t.h4,{id:"parameters-6",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsxs)(t.tbody,{children:[(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"light"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The light value to insert the level into."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"level"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The blue light level to insert."})]})]})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-6",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"number"})}),"\n",(0,n.jsx)(t.p,{children:"The inserted light value."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"insertgreenlight",children:"insertGreenLight"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"insertGreenLight"}),"(",(0,n.jsx)(t.code,{children:"light"}),", ",(0,n.jsx)(t.code,{children:"level"}),"): ",(0,n.jsx)(t.code,{children:"number"})]}),"\n",(0,n.jsx)(t.p,{children:"Insert a green light level into a number."}),"\n",(0,n.jsx)(t.h4,{id:"parameters-7",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsxs)(t.tbody,{children:[(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"light"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The light value to insert the level into."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"level"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The green light level to insert."})]})]})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-7",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"number"})}),"\n",(0,n.jsx)(t.p,{children:"The inserted light value."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"insertredlight",children:"insertRedLight"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"insertRedLight"}),"(",(0,n.jsx)(t.code,{children:"light"}),", ",(0,n.jsx)(t.code,{children:"level"}),"): ",(0,n.jsx)(t.code,{children:"number"})]}),"\n",(0,n.jsx)(t.p,{children:"Insert a red light level into a number."}),"\n",(0,n.jsx)(t.h4,{id:"parameters-8",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsxs)(t.tbody,{children:[(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"light"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The light value to insert the level into."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"level"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The red light level to insert."})]})]})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-8",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"number"})}),"\n",(0,n.jsx)(t.p,{children:"The inserted light value."}),"\n",(0,n.jsx)(t.hr,{}),"\n",(0,n.jsx)(t.h3,{id:"insertsunlight",children:"insertSunlight"}),"\n",(0,n.jsxs)(t.p,{children:["\u25b8 ",(0,n.jsx)(t.strong,{children:"insertSunlight"}),"(",(0,n.jsx)(t.code,{children:"light"}),", ",(0,n.jsx)(t.code,{children:"level"}),"): ",(0,n.jsx)(t.code,{children:"number"})]}),"\n",(0,n.jsx)(t.p,{children:"Insert a sunlight level into a number."}),"\n",(0,n.jsx)(t.h4,{id:"parameters-9",children:"Parameters"}),"\n",(0,n.jsxs)(t.table,{children:[(0,n.jsx)(t.thead,{children:(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Name"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Type"}),(0,n.jsx)(t.th,{style:{textAlign:"left"},children:"Description"})]})}),(0,n.jsxs)(t.tbody,{children:[(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"light"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The light value to insert the level into."})]}),(0,n.jsxs)(t.tr,{children:[(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"level"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:(0,n.jsx)(t.code,{children:"number"})}),(0,n.jsx)(t.td,{style:{textAlign:"left"},children:"The sunlight level to insert."})]})]})]}),"\n",(0,n.jsx)(t.h4,{id:"returns-9",children:"Returns"}),"\n",(0,n.jsx)(t.p,{children:(0,n.jsx)(t.code,{children:"number"})}),"\n",(0,n.jsx)(t.p,{children:"The inserted light value."})]})}function j(e={}){const{wrapper:t}={...(0,r.a)(),...e.components};return t?(0,n.jsx)(t,{...e,children:(0,n.jsx)(x,{...e})}):x(e)}},1670:(e,t,l)=>{l.d(t,{Z:()=>d,a:()=>s});var n=l(7378);const r={},i=n.createContext(r);function s(e){const t=n.useContext(i);return n.useMemo((function(){return"function"==typeof e?e(t):{...t,...e}}),[t,e])}function d(e){let t;return t=e.disableParentContext?"function"==typeof e.components?e.components(r):e.components||r:s(e.components),n.createElement(i.Provider,{value:t},e.children)}}}]);