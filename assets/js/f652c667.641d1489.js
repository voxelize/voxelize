"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[8522],{7952:(e,n,t)=>{t.r(n),t.d(n,{assets:()=>o,contentTitle:()=>r,default:()=>v,frontMatter:()=>i,metadata:()=>l,toc:()=>d});var s=t(4246),a=t(1670);const i={},r="Handling Events",l={id:"handling-events",title:"Handling Events",description:"In Voxelize, you can define custom events that can be sent from the server to the client. These events can be used to create custom game logic.",source:"@site/docs/wiki/handling-events.md",sourceDirName:".",slug:"/handling-events",permalink:"/wiki/handling-events",draft:!1,unlisted:!1,tags:[],version:"current",frontMatter:{},sidebar:"tutorialSidebar",previous:{title:"Custom Peers",permalink:"/wiki/custom-peers"},next:{title:"Metadata Processing",permalink:"/wiki/metadata-processing"}},o={},d=[{value:"Defining a Server Event",id:"defining-a-server-event",level:2},{value:"Sending a Server Event",id:"sending-a-server-event",level:2}];function c(e){const n={code:"code",h1:"h1",h2:"h2",p:"p",pre:"pre",...(0,a.a)(),...e.components};return(0,s.jsxs)(s.Fragment,{children:[(0,s.jsx)(n.h1,{id:"handling-events",children:"Handling Events"}),"\n",(0,s.jsx)(n.p,{children:"In Voxelize, you can define custom events that can be sent from the server to the client. These events can be used to create custom game logic."}),"\n",(0,s.jsx)(n.p,{children:"Different from methods, events are location based. This means that events fired by client A will only be received by clients that have the chunk that client A is in loaded. This is useful for creating custom game logic that is only relevant to a specific area."}),"\n",(0,s.jsxs)(n.p,{children:["By default, events that do not have a handle will be directly broadcasted to all clients through the ",(0,s.jsx)(n.code,{children:"EventsSystem"}),". This can be used to create custom events that are not handled by the server."]}),"\n",(0,s.jsx)(n.h2,{id:"defining-a-server-event",children:"Defining a Server Event"}),"\n",(0,s.jsx)(n.pre,{children:(0,s.jsx)(n.code,{className:"language-rust",metastring:'title="Server Event Definition"',children:'#[derive(Serialize, Deserialize)]\nstruct MyEvent1Payload {\n  test: String,\n}\n\n#[derive(Serialize, Deserialize)]\nstruct MyEvent2Payload {\n  test: String,\n}\n\nlet world = server.create_world("my_world", &config).expect("Failed to create world");\n\nworld.set_event_handle("my_event_1", |world, client_id, payload| {\n  let data: MyEvent1Payload = serde_json::from_value(payload).expect("Failed to parse payload");\n\n  // Do something with the world and payload\n});\n'})}),"\n",(0,s.jsx)(n.h2,{id:"sending-a-server-event",children:"Sending a Server Event"}),"\n",(0,s.jsx)(n.pre,{children:(0,s.jsx)(n.code,{className:"language-ts",metastring:'title="Client Event Receive"',children:'const events = new VOXELIZE.Events();\n\nevents.on("my_event_2", (payload) => {\n  console.log(payload.test);\n});\n\nnetwork.register(events);\n\nevents.emit("my_event_1", {\n  test: "Hello World"\n});\n\nevents.emitMany([\n  {\n    name: "my_event_1",\n    payload: {\n      test: "Hello World"\n    }\n  },\n  {\n    name: "my_event_2",\n    payload: {\n      test: "Hello World"\n    }\n  }\n]);\n'})}),"\n",(0,s.jsxs)(n.p,{children:["In this situation, since only the ",(0,s.jsx)(n.code,{children:"my_event_1"})," event has a handle, only the ",(0,s.jsx)(n.code,{children:"my_event_1"})," event will be handled by the server. Also, by the default behavior, ",(0,s.jsx)(n.code,{children:"my_event_2"})," will be broadcasted to all clients."]})]})}function v(e={}){const{wrapper:n}={...(0,a.a)(),...e.components};return n?(0,s.jsx)(n,{...e,children:(0,s.jsx)(c,{...e})}):c(e)}},1670:(e,n,t)=>{t.d(n,{Z:()=>l,a:()=>r});var s=t(7378);const a={},i=s.createContext(a);function r(e){const n=s.useContext(i);return s.useMemo((function(){return"function"==typeof e?e(n):{...n,...e}}),[n,e])}function l(e){let n;return n=e.disableParentContext?"function"==typeof e.components?e.components(a):e.components||a:r(e.components),s.createElement(i.Provider,{value:n},e.children)}}}]);