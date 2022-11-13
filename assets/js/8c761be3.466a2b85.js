"use strict";(self.webpackChunkdocs=self.webpackChunkdocs||[]).push([[2901],{5318:(e,t,n)=>{n.d(t,{Zo:()=>c,kt:()=>m});var r=n(7378);function i(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function a(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var r=Object.getOwnPropertySymbols(e);t&&(r=r.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),n.push.apply(n,r)}return n}function o(e){for(var t=1;t<arguments.length;t++){var n=null!=arguments[t]?arguments[t]:{};t%2?a(Object(n),!0).forEach((function(t){i(e,t,n[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):a(Object(n)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))}))}return e}function l(e,t){if(null==e)return{};var n,r,i=function(e,t){if(null==e)return{};var n,r,i={},a=Object.keys(e);for(r=0;r<a.length;r++)n=a[r],t.indexOf(n)>=0||(i[n]=e[n]);return i}(e,t);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);for(r=0;r<a.length;r++)n=a[r],t.indexOf(n)>=0||Object.prototype.propertyIsEnumerable.call(e,n)&&(i[n]=e[n])}return i}var s=r.createContext({}),p=function(e){var t=r.useContext(s),n=t;return e&&(n="function"==typeof e?e(t):o(o({},t),e)),n},c=function(e){var t=p(e.components);return r.createElement(s.Provider,{value:t},e.children)},u={inlineCode:"code",wrapper:function(e){var t=e.children;return r.createElement(r.Fragment,{},t)}},d=r.forwardRef((function(e,t){var n=e.components,i=e.mdxType,a=e.originalType,s=e.parentName,c=l(e,["components","mdxType","originalType","parentName"]),d=p(n),m=i,f=d["".concat(s,".").concat(m)]||d[m]||u[m]||a;return n?r.createElement(f,o(o({ref:t},c),{},{components:n})):r.createElement(f,o({ref:t},c))}));function m(e,t){var n=arguments,i=t&&t.mdxType;if("string"==typeof e||i){var a=n.length,o=new Array(a);o[0]=d;var l={};for(var s in t)hasOwnProperty.call(t,s)&&(l[s]=t[s]);l.originalType=e,l.mdxType="string"==typeof e?e:i,o[1]=l;for(var p=2;p<a;p++)o[p]=n[p];return r.createElement.apply(null,o)}return r.createElement.apply(null,n)}d.displayName="MDXCreateElement"},4148:(e,t,n)=>{n.r(t),n.d(t,{assets:()=>s,contentTitle:()=>o,default:()=>u,frontMatter:()=>a,metadata:()=>l,toc:()=>p});var r=n(5773),i=(n(7378),n(5318));const a={sidebar_position:2},o="Getting Started",l={unversionedId:"intro/getting-started",id:"intro/getting-started",title:"Getting Started",description:"This series of tutorials will be based on this example repository. We will be building a full-stack deployable app that teaches you the inner-workings of Voxelize.",source:"@site/docs/tutorials/intro/2-getting-started.md",sourceDirName:"intro",slug:"/intro/getting-started",permalink:"/tutorials/intro/getting-started",draft:!1,tags:[],version:"current",sidebarPosition:2,frontMatter:{sidebar_position:2},sidebar:"tutorialSidebar",previous:{title:"What is Voxelize?",permalink:"/tutorials/intro/what-is-voxelize"},next:{title:"Installation",permalink:"/tutorials/intro/installation"}},s={},p=[{value:"What you&#39;ll need",id:"what-youll-need",level:2},{value:"Start developing",id:"start-developing",level:2},{value:"Cloning the Example",id:"cloning-the-example",level:3}],c={toc:p};function u(e){let{components:t,...n}=e;return(0,i.kt)("wrapper",(0,r.Z)({},c,n,{components:t,mdxType:"MDXLayout"}),(0,i.kt)("h1",{id:"getting-started"},"Getting Started"),(0,i.kt)("p",null,"This series of tutorials will be based on ",(0,i.kt)("a",{parentName:"p",href:"https://github.com/voxelize/voxelize-example"},"this example repository"),". We will be building a full-stack deployable app that teaches you the inner-workings of Voxelize."),(0,i.kt)("h2",{id:"what-youll-need"},"What you'll need"),(0,i.kt)("p",null,"In order to develop in Voxelize, some prior knowledge is recommended:"),(0,i.kt)("ul",null,(0,i.kt)("li",{parentName:"ul"},(0,i.kt)("a",{parentName:"li",href:"https://www.rust-lang.org/tools/install"},"Rust")," version ",(0,i.kt)("inlineCode",{parentName:"li"},"1.16")," or above",(0,i.kt)("ul",{parentName:"li"},(0,i.kt)("li",{parentName:"ul"},"We use Rust to write our Voxelize server."))),(0,i.kt)("li",{parentName:"ul"},(0,i.kt)("a",{parentName:"li",href:"https://threejs.org/"},"ThreeJS")," version ",(0,i.kt)("inlineCode",{parentName:"li"},"r141")," or above.",(0,i.kt)("ul",{parentName:"li"},(0,i.kt)("li",{parentName:"ul"},"The frontend-side is essentially a ThreeJS app.")))),(0,i.kt)("h2",{id:"start-developing"},"Start developing"),(0,i.kt)("p",null,"A fullstack Voxelize app consists of a Rust server and a web client. For the client-side example in this tutorial, we will use plain HTML + Webpack as our choice of frontend."),(0,i.kt)("h3",{id:"cloning-the-example"},"Cloning the Example"),(0,i.kt)("p",null,"To get started with this tutorial, go ahead and clone the given example:"),(0,i.kt)("pre",null,(0,i.kt)("code",{parentName:"pre",className:"language-bash"},"# Clone the git-repository\ngit clone https://github.com/voxelize/voxelize-example\n\n# Navigate into the project folder\ncd voxelize-example\n\n# Install the dependencies\nnpm install\n")),(0,i.kt)("p",null,"The template example consists of a Rust app ",(0,i.kt)("inlineCode",{parentName:"p"},"server")," contained within a basic ",(0,i.kt)("inlineCode",{parentName:"p"},"webpack")," based JS frontend, with client-side code located in the ",(0,i.kt)("inlineCode",{parentName:"p"},"client")," folder."))}u.isMDXComponent=!0}}]);