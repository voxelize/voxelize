import { useEffect, useRef } from "react";

const CharacterView = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    let animationId: number;
    let cleanup: (() => void) | undefined;

    (async () => {
      const THREE = await import("three");
      const VOXELIZE = await import("@voxelize/core");

      const canvas = canvasRef.current;
      if (!canvas) return;

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(canvas.clientWidth, canvas.clientHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(
        75,
        canvas.clientWidth / canvas.clientHeight,
        0.1,
        1000
      );

      const CAMERA_OFFSET_Y = 0.5;

      camera.position.set(0, CAMERA_OFFSET_Y, 2.5);
      camera.lookAt(0, -CAMERA_OFFSET_Y, 0);

      const character = new VOXELIZE.Character();
      scene.add(character);

      const target = new THREE.Vector3();

      let mouseX = 0,
        mouseY = 0;

      function onDocumentMouseMove(event: MouseEvent) {
        const rect = canvas.getBoundingClientRect();
        mouseX = event.clientX - (rect.x + canvas.clientWidth / 2);
        mouseY = event.clientY - (rect.y + canvas.clientHeight / 2);
      }

      document.addEventListener("mousemove", onDocumentMouseMove, false);

      const animate = () => {
        animationId = requestAnimationFrame(animate);

        target.x = mouseX * 0.02;
        target.y = -mouseY * 0.02;
        target.z = camera.position.z;

        character.set(
          [0, 0, 0],
          [target.x, target.y - CAMERA_OFFSET_Y * 2, target.z]
        );
        character.update();

        renderer.render(scene, camera);
      };

      animate();

      const parent = canvas.parentElement;

      const onResize = () => {
        if (!parent) return;
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        camera.aspect = parent.clientWidth / parent.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(parent.clientWidth, parent.clientHeight);
      };

      window.addEventListener("resize", onResize);

      cleanup = () => {
        document.removeEventListener("mousemove", onDocumentMouseMove, false);
        window.removeEventListener("resize", onResize);
        renderer.dispose();
      };
    })();

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      cleanup?.();
    };
  }, []);

  return <canvas className="w-full h-full" ref={canvasRef} />;
};

export default CharacterView;
