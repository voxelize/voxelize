import React, { useEffect, useRef } from "react";

import * as VOXELIZE from "@voxelize/client";
import styled from "styled-components";
import * as THREE from "three";

const LogoCanvas = styled.canvas`
  width: 100%;
  height: 100%;
`;

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
    renderer.outputEncoding = THREE.sRGBEncoding;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000
    );

    const CAMERA_OFFSET_Y = 0.5;

    camera.position.set(0, CAMERA_OFFSET_Y, 2.5);
    camera.lookAt(0, 0, 0);

    const character = new VOXELIZE.Character();
    // character.position.y += character.eyeHeight;
    scene.add(character);

    const target = new THREE.Vector3();

    let mouseX = 0,
      mouseY = 0;

    function onDocumentMouseMove(event: MouseEvent) {
      mouseX = event.clientX - (canvas.offsetLeft + canvas.clientWidth / 2);
      mouseY = event.clientY - (canvas.offsetTop + canvas.clientHeight / 2);
    }

    document.addEventListener("mousemove", onDocumentMouseMove, false);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      // controls.update();
      renderer.render(scene, camera);

      target.x = mouseX * 0.02;
      target.y = -mouseY * 0.02;
      target.z = camera.position.z; // assuming the camera is located at ( 0, 0, z );

      character.set(
        [0, 0, 0],
        [target.x, target.y + CAMERA_OFFSET_Y, target.z]
      );
      character.update();
    };

    animate();

    return () => {
      document.removeEventListener("mousemove", onDocumentMouseMove, false);
    };
  }, [canvasRef]);

  return <LogoCanvas ref={canvasRef} />;
};
