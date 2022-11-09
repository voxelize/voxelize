import React, { useEffect } from "react";

import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import { Canvas, useThree } from "@react-three/fiber";
import Layout from "@theme/Layout";
import * as VOXELIZE from "@voxelize/client";
import styled from "styled-components";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

import "./index.css";

const Banner = styled.header`
  padding: 4rem 0;
  text-align: center;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

const CameraController = () => {
  const { camera, gl } = useThree();

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);

    controls.minDistance = 3;
    controls.maxDistance = 20;

    return () => {
      controls.dispose();
    };
  }, [camera, gl]);

  return null;
};

const HomepageHeader = () => {
  const { siteConfig } = useDocusaurusContext();

  return (
    <Banner>
      <Canvas>
        <CameraController />
        <primitive object={new VOXELIZE.Character()} />
      </Canvas>
      <div className="container">
        <h1 className="hero__title">{siteConfig.title}</h1>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro/what-is-voxelize"
          >
            Voxelize Tutorial - 5min ⏱️
          </Link>
        </div>
      </div>
    </Banner>
  );
};

export default function Home() {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`Hello from ${siteConfig.title}`}
      description="Description will go into a meta tag in <head />"
    >
      <HomepageHeader />
    </Layout>
  );
}
