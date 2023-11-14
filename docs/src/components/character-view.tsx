import { useEffect, useRef } from "react";

import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

export const CharacterView = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
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

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      target.x = mouseX * 0.02;
      target.y = -mouseY * 0.02;
      target.z = camera.position.z; // assuming the camera is located at ( 0, 0, z );

      character.set(
        [0, 0, 0],
        [target.x, target.y - CAMERA_OFFSET_Y * 2, target.z]
      );
      character.update();

      renderer.render(scene, camera);
    };

    animate();

    const parent = canvas.parentElement;

    window.addEventListener("resize", () => {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      camera.aspect = parent.clientWidth / parent.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(parent.clientWidth, parent.clientHeight);
    });

    return () => {
      document.removeEventListener("mousemove", onDocumentMouseMove, false);
    };
  }, [canvasRef]);

  return <canvas className="w-full h-full" ref={canvasRef} />;
};
