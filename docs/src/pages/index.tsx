import BrowserOnly from "@docusaurus/BrowserOnly";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import { TypeAnimation } from "react-type-animation";
import styled from "styled-components";

const HomepageHeader = () => {
  const { siteConfig } = useDocusaurusContext();

  return (
    <div className="flex flex-col-reverse justify-end items-center min-h-[100vh] lg:flex-row md:min-h-[80vh]">
      <div className="flex flex-col justify-start items-center lg:items-start">
        <div className="my-10 flex flex-col items-center lg:items-start">
          <h1 className="font-display font-black text-6xl mb-3 md:text-8xl">
            {siteConfig.title}
          </h1>
          <TypeAnimation
            sequence={[
              "A multiplayer voxel game engine",
              1000,
              "An immersive 3D web experience",
              1000,
              "A 3D web framework",
              1000,
              "A full-stack game framework",
              1000,
              "A 3D voxel editor",
              1000,
            ]}
            wrapper="div"
            cursor={false}
            speed={50}
            repeat={Infinity}
            className="font-body text-2xl text-center lg:text-start"
          />
        </div>

        <div className="flex gap-2">
          <a href="https://shaoruu.io" target="_blank">
            <button
              className="button button--primary button--lg"
              style={{ verticalAlign: "middle" }}
            >
              ⭐ Live Demo
            </button>
          </a>
          <Link to="/tutorials/intro/what-is-voxelize">
            <button
              className="button button--secondary button--lg"
              style={{ verticalAlign: "middle" }}
            >
              Get Started &rarr;
            </button>
          </Link>
        </div>
      </div>

      <div className="w-[400px] h-[400px] lg:h-[600px]">
        <BrowserOnly>
          {() => {
            const CharacterView =
              require("../components/character-view").CharacterView;
            return <CharacterView />;
          }}
        </BrowserOnly>
      </div>
    </div>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  width: 60%;
  margin: 0 auto;
  min-width: 300px;
`;

export default () => {
  return (
    <Layout
      title="Welcome"
      description="🍄 A well-optimized, highly extensible full-stack library to create immersive multiplayer voxel experiences."
    >
      <Wrapper>
        <HomepageHeader />
      </Wrapper>
    </Layout>
  );
};
