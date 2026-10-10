/// <reference types="@docusaurus/theme-classic" />
import BrowserOnly from "@docusaurus/BrowserOnly";
import Link from "@docusaurus/Link";
import CodeBlock from "@theme/CodeBlock";
import Layout from "@theme/Layout";

import FrameTimeline from "../components/oit/FrameTimeline";
import PixelLab from "../components/oit/PixelLab";
import TexelSplitFigure from "../components/oit/TexelSplitFigure";
import { Figure } from "../components/oit/ui";
import WaterSplitFigure from "../components/oit/WaterSplitFigure";

const SECTIONS = [
  ["why", "Why order breaks"],
  ["idea", "Sums instead of order"],
  ["frame", "A frame, band by band"],
  ["water", "Water splits the pass"],
  ["texels", "Blocks split by their texels"],
  ["materials", "Every material takes part"],
  ["usage", "Using it"],
  ["cost", "What it costs"],
  ["limits", "Limits"],
  ["source", "Where it lives"],
] as const;

const ENCODER = `#define main orderIndependentShade
// ...the material's own fragment shader, untouched...
#undef main
layout(location = 1) out highp vec4 pc_fragOitWeight;
void main() {
  if (uOitActive > 0.5 && uOitPhase > 0.5) {
    // drop the side of the water this pass does not draw, before any shading
  }
  orderIndependentShade();
  pc_fragOitWeight = vec4(0.0);
  if (uOitActive < 0.5) return;          // any other render: ordinary colour
  float oitAlpha = clamp(gl_FragColor.a, 0.0, 1.0);
  if (oitAlpha <= 0.0) discard;
  float oitWeight = oitAlpha * depthWeight(oitDistanceAt(gl_FragCoord.z));
  gl_FragColor = vec4(gl_FragColor.rgb * oitAlpha * oitWeight, oitAlpha);
  pc_fragOitWeight = vec4(oitAlpha * oitWeight, 0.0, 0.0, 0.0);
}`;

const COMPOSITE = `vec4 accumulation = texelFetch(tAccumulation, pixel, 0);
float coverage = 1.0 - accumulation.a;        // 1 − Π(1 − α)
if (coverage <= 0.0) discard;
float weight = texelFetch(tWeight, pixel, 0).r; // Σ α·w
gl_FragColor = vec4(accumulation.rgb / max(weight, 1e-5) * coverage, coverage);
// blended ONE, ONE_MINUS_SRC_ALPHA over the scene`;

const SETUP = `import * as VOXELIZE from "@voxelize/core";
import { EffectComposer, RenderPass } from "postprocessing";

const world = new VOXELIZE.World({
  orderIndependentTransparency: VOXELIZE.defaultOrderIndependentTransparencyOptions,
});

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(world, camera));
// The blended layers accumulate against the scene's own depth.
composer.createDepthTexture();`;

const FRAME = `const animate = () => {
  requestAnimationFrame(animate);
  world.update(
    controls.object.position,
    camera.getWorldDirection(new THREE.Vector3()),
  );
  world.updateShaderLighting(camera, controls.object.position);
  world.renderShadowMaps(renderer, collectShadowCasters());
  // Before the scene renders with this camera: installs the banded sort,
  // draws the water's depth, arms the accumulation.
  if (world.isInitialized) world.prepareTransparency(renderer, camera);
  composer.render();
};`;

const WARMUP = `// Before a warmup compiles anything: wrap what can accumulate, and draw the
// texel forks of see-through chunk materials, which no scene holds yet.
const forks = world.adoptOrderIndependentMaterials(materialsToWarm);
for (const fork of forks) warmScene.add(new THREE.Mesh(warmGeometry, fork));
renderer.compile(warmScene, camera);`;

const OPTIONS = `type OrderIndependentTransparencyOptions = {
  /** At or above this texel alpha, a see-through block's texel is solid. */
  solidTexelAlpha: number; // 0.99
  /** w(d) = clamp(scale / (ε + (d / nearDistance)³ + (d / farDistance)⁶), min, max) */
  weights: {
    scale: number; //        10
    nearDistance: number; // 10 blocks
    farDistance: number; //  200 blocks
    min: number; //          0.01
    max: number; //          1000, keeps half-float sums in range
  };
};`;

const STATS = `world.orderIndependent?.stats;
// {
//   opened: 1159,        renders that accumulated
//   skipped: {},         renders that could not, by reason
//   adopted: 716,        materials wrapped with the encoder
//   lateAdopted: [],     wrapped after compiling: each compiled twice
//   drawnAfter: [],      blended materials that cannot accumulate
// }

// Keep one material out; it draws over the composite:
material.userData[VOXELIZE.ORDER_INDEPENDENT_KEY] = false;`;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function BeforeAfter({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="oit-figure">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        style={{ width: "100%", borderRadius: 8 }}
      />
      <p className="oit-figure__caption">{caption}</p>
    </figure>
  );
}

export default function OrderIndependentTransparencyPage() {
  return (
    <Layout
      title="Order-independent transparency"
      description="How Voxelize blends water, glass, smoke and every other see-through surface in any order: the accumulation, the water split, the texel split, and the cost."
    >
      <main className="oit-page">
        <h1>Order-independent transparency</h1>
        <p className="oit-lede">
          Every see-through surface a world draws (water, glass, the soft edges
          of leaves, smoke, bubbles, sprites, a game's own effects) blends by
          how far it is from the eye, in whatever order it happens to draw. The
          water still bends and tints what lies behind it.
        </p>
        <ul className="oit-toc">
          {SECTIONS.map(([id, title]) => (
            <li key={id}>
              <a href={`#${id}`}>{title}</a>
            </li>
          ))}
        </ul>

        <Figure
          title="The pass, running"
          caption="A pool with a stained-glass pane standing in it, a red glass column, bubbles under the surface and smoke rising in front. Drag to orbit. Switch to sorted and shuffle the draw order: the picture changes with the order. Order-independent, it does not. The debug views show what the accumulation holds after the last pass."
        >
          <BrowserOnly fallback={<div className="oit-demo" />}>
            {() => {
              const LiveDemo = require("../components/oit/LiveDemo").default;
              return <LiveDemo />;
            }}
          </BrowserOnly>
        </Figure>

        <Section id="why" title="Why order breaks">
          <p>
            Normal blending paints a layer over what is already there:{" "}
            <code>dst = src·α + dst·(1 − α)</code>. Do it back to front and the
            pixel is right. Do it in any other order and a far layer paints over
            a near one.
          </p>
          <p>
            So a sorted pipeline sorts: objects by distance, the faces of a
            glass mesh by their centres. A voxel world defeats every sort that
            works on whole things. One mesh holds all the glass of a 32-block
            section; a tunnel runs through a pool, so the same glass floor is
            under the water seen from above and in front of it seen from inside;
            smoke drifts through a window; a canopy stands both in and above a
            pond. And water does not just blend, it refracts, so it has to read
            a copy of everything behind it, which means everything behind it has
            to be drawn first.
          </p>
          <BeforeAfter
            src="/img/docs/oit/smoke-in-front-of-glass.jpg"
            alt="A chimney at the foot of a stained-glass wall with a pool behind it: before, the pool is pasted over the glass and the smoke is hidden behind the wall; after, the smoke rises in front of the glass and the pool shows through it"
            caption="In a host game: chimney smoke rising in front of a stained-glass wall. Sorted (left), the wall and the pool behind it paint over the smoke; order-independent (right), the smoke stays in front."
          />
          <PixelLab />
        </Section>

        <Section id="idea" title="Sums instead of order">
          <p>
            Weighted blended order-independent transparency (McGuire and Bavoil,
            2013) replaces the ordered paint with sums, which do not care about
            order. Every blended fragment adds its premultiplied colour times a
            weight into one target, and multiplies how much of the scene still
            shows into another. One full-screen pass then divides the colour
            back out and lays it over the scene.
          </p>
          <ul>
            <li>
              <strong>Coverage is exact.</strong> <code>Π(1 − α)</code> is the
              same product a perfect sort multiplies, so a layer never shows
              more or less of the scene than it should.
            </li>
            <li>
              <strong>The colour mix is weighted by distance.</strong> Where
              layers overlap, each contributes in proportion to{" "}
              <code>α·w(d)</code>, so the nearer layer leads. That is the
              approximation: close to a sort, never exactly one.
            </li>
          </ul>
          <p>
            WebGL2 has one blend state for every attachment of a target, so both
            sums share it. RGB adds (<code>ONE, ONE</code>); alpha multiplies (
            <code>ZERO, ONE_MINUS_SRC_ALPHA</code>). The first attachment keeps{" "}
            <code>Σ C·α·w</code> in its colour and <code>Π(1 − α)</code> in its
            alpha; the second keeps <code>Σ α·w</code> in its red, writing alpha
            0 so the product leaves it alone. The composite:
          </p>
          <CodeBlock
            language="glsl"
            title="order-independent-transparency.ts · the composite"
          >
            {COMPOSITE}
          </CodeBlock>
        </Section>

        <Section id="frame" title="A frame, band by band">
          <p>
            three draws the opaque list and then the transparent list in one{" "}
            <code>render()</code>, with no hook between them. The pass gets its
            hooks from marker meshes that draw nothing: the world's sort places
            them in the transparent list, and their <code>onBeforeRender</code>{" "}
            switches targets mid-render. The sort places everything else by what
            it writes, not by its render order.
          </p>
          <FrameTimeline />
          <p>
            The accumulation borrows the scene target's own depth texture, so
            blended fragments are tested against the terrain, the cutouts and
            the solid texels without a copy, and write nothing to it.
          </p>
        </Section>

        <Section id="water" title="Water splits the pass">
          <p>
            Accumulated in one pass, the water could only refract the scene
            drawn before it, and nothing blended is drawn before it: glass under
            a pool would come out unbent, and from under the water, glass above
            the surface would show only its solid parts. So the water's surface
            splits the blended band in two, per pixel.
          </p>
          <WaterSplitFigure />
          <p>
            Before the frame, <code>prepareTransparency</code> draws the depth
            of every water face in view into a texture, with the water's own
            vertex shader so the waves match, and both sides of each face. The
            first pass keeps the fragments behind that depth; the split
            composites them into the scene; the water then refracts the scene
            target itself and draws in the second pass with everything in front
            of it. With no water in view the band draws once.
          </p>
          <BeforeAfter
            src="/img/docs/oit/glass-tunnel-under-water.jpg"
            alt="Inside a stained-glass tunnel through a tank of water: before, the water under the floor washes over the glass; after, every wall of the tunnel is crisp"
            caption="Inside a glass tunnel under water: the floor is behind the water from above and in front of it from inside. No order per face holds both; the per-pixel split does."
          />
          <BeforeAfter
            src="/img/docs/oit/glass-column-through-the-surface.jpg"
            alt="Underwater, looking up at a red glass column rising out of a pool: the column carries on through the surface, seen through the water"
            caption="From under the water, the column above the surface lies behind the surface's underside: it is composited first, and the water's window shows it."
          />
        </Section>

        <Section id="texels" title="Blocks split by their texels">
          <p>
            A stained-glass texture is two materials in one: lead lines that
            should hide what is behind them, and coloured panes that should tint
            it. Blended as one layer, the lead lines would be averaged with the
            pool behind them. The world reads what each texture holds instead of
            trusting the block's flags.
          </p>
          <TexelSplitFigure />
          <p>
            Solid texels draw with the depth writers, alpha-tested at{" "}
            <code>solidTexelAlpha</code>, writing depth; translucent texels draw
            in the blended band from the same buffers, through a material fork
            that drops solid texels after the alpha test. The block's own flags
            (<code>isSeeThrough</code>, <code>transparentStandalone</code>,{" "}
            <code>lightAttenuation</code>, <code>standaloneFaceDepth</code>)
            keep their jobs in meshing, face culling and shadows. Display copies
            from <code>makeBlockMesh</code> (held, dropped and displayed blocks)
            split the same way, per face.
          </p>
          <BeforeAfter
            src="/img/docs/oit/glass-wall-over-pool.jpg"
            alt="A stained-glass wall in front of a pool: before, the water is pasted over the glass; after, the glass pattern runs unbroken over the water"
            caption="A stained-glass wall in front of a pool: the lead lines write depth and hide the water; the panes tint it."
          />
        </Section>

        <Section id="materials" title="Every material takes part">
          <p>
            A game's materials need no changes. The first time the world's sort
            meets a transparent material that writes no depth, it wraps the
            material's fragment stage with the encoder. The preprocessor renames
            the material's <code>main</code>, so a hook that later finds{" "}
            <code>void main() {"{"}</code> still edits the material's own body,
            and the program key gains a mark so the wrapped program is never
            shared with an unwrapped one.
          </p>
          <CodeBlock
            language="glsl"
            title="orderIndependentFragment · the wrapper"
          >
            {ENCODER}
          </CodeBlock>
          <table className="oit-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  Normal blending, straight or premultiplied; custom blending
                  equal to it
                </td>
                <td>Accumulated</td>
              </tr>
              <tr>
                <td>Writes depth (cutouts, solid texels, masks)</td>
                <td>Depth writers, before the accumulation</td>
              </tr>
              <tr>
                <td>Additive light</td>
                <td>After the composite: adding needs no order</td>
              </tr>
              <tr>
                <td>
                  Multiply, subtractive, other custom blends; raw or GLSL3
                  shaders
                </td>
                <td>
                  After the composite, listed in <code>stats.drawnAfter</code>
                </td>
              </tr>
              <tr>
                <td>
                  Negative render order (sky), or 1 000 000 and up (overlays)
                </td>
                <td>Its own order, around the bands</td>
              </tr>
              <tr>
                <td>
                  <code>userData[ORDER_INDEPENDENT_KEY] = false</code>
                </td>
                <td>After the composite</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4">
            Outside the accumulation a wrapped material draws its ordinary
            colour with its own blend state, so one shared with an inventory
            scene, a portrait or a shadow pass is untouched. Wrapping a material
            changes its program, so it has to happen before the material first
            compiles: a warmup adopts everything it is about to compile, and
            anything first seen later is adopted before its first draw. A
            material wrapped after it compiled is counted and named, because it
            compiled twice.
          </p>
        </Section>

        <Section id="usage" title="Using it">
          <p>
            Turn it on, and render the world into a target with a depth texture:
          </p>
          <CodeBlock language="ts" title="Client Setup">
            {SETUP}
          </CodeBlock>
          <p>
            Call the prepare step once a frame, before the scene renders with
            that camera:
          </p>
          <CodeBlock language="ts" title="Frame Loop">
            {FRAME}
          </CodeBlock>
          <p>
            The example client does exactly this; see{" "}
            <code>examples/client/src/main.ts</code>, where{" "}
            <code>?transparency=sorted</code> switches back to the sorted
            pipeline for comparison.
          </p>
          <p>
            Adopt before a warmup compiles, so no blended program compiles on
            its first draw:
          </p>
          <CodeBlock language="ts" title="Shader Warmup">
            {WARMUP}
          </CodeBlock>
          <CodeBlock language="ts" title="Options">
            {OPTIONS}
          </CodeBlock>
          <CodeBlock language="ts" title="Checking It">
            {STATS}
          </CodeBlock>
          <p>
            Without the option (the default), a world keeps the sorted pipeline:
            per-face sorting, effects placed by their medium, and glass split at
            the water's depth per pixel. See the{" "}
            <Link to="/wiki/rendering/order-independent-transparency">
              wiki page
            </Link>{" "}
            for the short version.
          </p>
        </Section>

        <Section id="cost" title="What it costs">
          <p>
            Frame times from a host game, uncapped (vsync off), at the same
            pose, against the drawing order it shipped with:
          </p>
          <table className="oit-table">
            <thead>
              <tr>
                <th>Scene, 1280×720</th>
                <th>Sorted</th>
                <th>Order-independent</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Glass wall over a pool, chimney smoke</td>
                <td>3.96 ms</td>
                <td>3.08 ms</td>
              </tr>
              <tr>
                <td>Looking down at a glass tunnel under a pool</td>
                <td>3.37 ms</td>
                <td>2.55 ms</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4">
            It is cheaper because of what it removes: the water no longer copies
            the frame mid-render, glass is no longer re-sorted on the CPU as the
            camera moves, and double-sided blended materials draw in one pass
            instead of two. It adds two half-float attachments, a full-screen
            composite, the water's depth, and with water in view a second draw
            of the blended band, whose wrong-side fragments are dropped before
            any shading. Those scenes were bound by the CPU, not the GPU.
          </p>
        </Section>

        <Section id="limits" title="Limits">
          <ul>
            <li>
              Overlapping layers blend by weight, not exactly: the nearer one
              takes more of the colour, so a pool behind glass reads fainter
              than a perfect sort would draw it. The curve is{" "}
              <code>weights</code>.
            </li>
            <li>
              Additive light draws after the composite: a spark behind a pane is
              not tinted by it.
            </li>
            <li>
              The scene target has to be single-sampled with a depth texture,
              rendered at the top level; logarithmic and reversed depth buffers
              cannot be read by the weights. A render that cannot accumulate
              says why, once, and blends in list order.
            </li>
          </ul>
        </Section>

        <Section id="source" title="Where it lives">
          <table className="oit-table">
            <tbody>
              <tr>
                <td>
                  <code>core/world/order-independent-transparency.ts</code>
                </td>
                <td>
                  The pass: markers, bands, adoption, encoder, accumulation,
                  split, composite
                </td>
              </tr>
              <tr>
                <td>
                  <code>core/world/see-through-texels.ts</code>
                </td>
                <td>Texel classes, plans, the solid and translucent forks</td>
              </tr>
              <tr>
                <td>
                  <code>core/world/water-depth.ts</code>
                </td>
                <td>The water's depth before the frame</td>
              </tr>
              <tr>
                <td>
                  <code>core/world/textures.ts</code>
                </td>
                <td>Per-slot texel classes of the atlas, with animations</td>
              </tr>
              <tr>
                <td>
                  <code>core/world/index.ts</code>
                </td>
                <td>
                  <code>prepareTransparency</code>,{" "}
                  <code>adoptOrderIndependentMaterials</code>, the chunk and
                  display-copy wiring
                </td>
              </tr>
              <tr>
                <td>
                  <code>common.ts</code>
                </td>
                <td>
                  <code>TRANSPARENT_SORT</code>, which asks the world for each
                  item's band
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4">
            Paths are under <code>packages/core/src/</code>. Morgan McGuire and
            Louis Bavoil,{" "}
            <a href="https://jcgt.org/published/0002/02/09/">
              Weighted Blended Order-Independent Transparency
            </a>
            , Journal of Computer Graphics Techniques 2(2), 2013.
          </p>
        </Section>
      </main>
    </Layout>
  );
}
