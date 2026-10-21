import * as VOXELIZE from "@voxelize/core";

/// The example's instanced entity family: small box-bodied walkers the
/// server spawns as `critter` entities (`spawn-critter`), each carrying a
/// `variant` in its metadata. However many there are, each variant draws in
/// one call: bodies are skinned on the GPU, lit per instance from the voxel
/// light, shadowed, and flashed red by `markHit`.
///
/// Everything a family needs is in this one definition. The rest of the
/// wiring is three lines in main.ts: a roster, `critters.install(...)`, and
/// `roster.update(...)` each frame.

const COATS = {
  sand: { coat: "#c9a56b", belly: "#e8d3a8", feet: "#5a4128" },
  moss: { coat: "#5f7d3c", belly: "#a7b878", feet: "#33401f" },
  slate: { coat: "#69707a", belly: "#a9aeb5", feet: "#2e3136" },
} as const;

type CritterVariant = keyof typeof COATS;

/// A coat with a lighter belly band and two dark eyes on the head's front.
function headPainter(variant: CritterVariant): VOXELIZE.FacePainter {
  const { coat } = COATS[variant];
  return (ctx, face, width, height) => {
    ctx.fillStyle = coat;
    ctx.fillRect(0, 0, width, height);
    if (face !== 4) return; // +z is the face it looks out of
    const eye = Math.max(1, Math.round(width / 6));
    ctx.fillStyle = "#1b1b1b";
    ctx.fillRect(Math.round(width * 0.22), Math.round(height * 0.35), eye, eye);
    ctx.fillRect(
      Math.round(width * 0.78) - eye,
      Math.round(height * 0.35),
      eye,
      eye,
    );
  };
}

function bodyPainter(variant: CritterVariant): VOXELIZE.FacePainter {
  const { coat, belly } = COATS[variant];
  return (ctx, face, width, height) => {
    ctx.fillStyle = face === 3 ? belly : coat; // -y is the underside
    ctx.fillRect(0, 0, width, height);
  };
}

const LEG = { width: 0.12, height: 0.22 };
const HIP_Y = LEG.height;

export const critters = VOXELIZE.defineSkinnedFamily({
  type: "critter",
  variants: ["sand", "moss", "slate"],
  bones: ["body", "head", "tail", "legFL", "legFR", "legBL", "legBR"],
  parts: (variant) => {
    const { feet } = COATS[variant];
    const leg = (
      bone: "legFL" | "legFR" | "legBL" | "legBR",
      x: number,
      z: number,
    ) => ({
      bone,
      size: [LEG.width, LEG.height, LEG.width] as const,
      at: [x, LEG.height / 2, z] as const,
      // Legs swing about the hip, at the top of the leg.
      pivot: [x, HIP_Y, z] as const,
      paint: feet,
    });
    return [
      {
        bone: "body",
        size: [0.44, 0.3, 0.62],
        at: [0, HIP_Y + 0.15, 0],
        paint: bodyPainter(variant),
      },
      {
        bone: "head",
        size: [0.32, 0.28, 0.28],
        at: [0, HIP_Y + 0.32, 0.38],
        pivot: [0, HIP_Y + 0.24, 0.28],
        paint: headPainter(variant),
      },
      {
        bone: "tail",
        size: [0.08, 0.08, 0.22],
        at: [0, HIP_Y + 0.24, -0.4],
        pivot: [0, HIP_Y + 0.24, -0.3],
        paint: COATS[variant].coat,
      },
      leg("legFL", -0.14, 0.2),
      leg("legFR", 0.14, 0.2),
      leg("legBL", -0.14, -0.2),
      leg("legBR", 0.14, -0.2),
    ];
  },
  // Legs sweep this far at full stride; the stride clock paces them from it
  // and the measured leg length, so feet keep pace with the ground.
  legSwing: 0.7,
  animate: (pose) => {
    // Diagonal pairs swing together; the swing fades out at rest so an idle
    // critter stands square instead of freezing mid-stride.
    const stride = Math.sin(pose.stride) * 0.7 * pose.swing;
    pose.rotateBone("legFL", stride);
    pose.rotateBone("legBR", stride);
    pose.rotateBone("legFR", -stride);
    pose.rotateBone("legBL", -stride);
    // Calm idle: a slow head nod and a lazy tail sway.
    pose.rotateBone("head", Math.sin(pose.time * 1.3) * 0.06);
    pose.rotateBone("tail", 0.2, Math.sin(pose.time * 1.1) * 0.25);
  },
});
