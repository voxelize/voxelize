import React from "react";

import BrowserOnly from "@docusaurus/BrowserOnly";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import HomepageFeatures from "@site/src/components/HomepageFeatures";
import Layout from "@theme/Layout";
import styled from "styled-components";

import { H1 } from "../components/headings";

const HomepageHeader = () => {
  const { siteConfig } = useDocusaurusContext();

  return (
    <div className="flex flex-col justify-center min-h-[60vh]">
      <div className="flex flex-col justify-center items-center text-center">
        <div
          style={{ width: "400px", height: "400px" }}
          // className="flex justify-center items-center"
        >
          <BrowserOnly>
            {() => {
              const CharacterView =
                require("../components/character-view").CharacterView;
              return <CharacterView />;
            }}
          </BrowserOnly>
        </div>
        <div className="my-10">
          <H1>{siteConfig.title}</H1>
          <p className="text-2xl">{siteConfig.tagline}</p>
        </div>
        <Link to="/docs/intro/what-is-voxelize">
          <button
            className="button button--secondary button--lg"
            style={{ verticalAlign: "middle" }}
          >
            Get Started &rarr;
          </button>
        </Link>
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

        <main>
          <section>
            <h3>Get to know Voxelize</h3>
            <nav
              className="pagination-nav"
              style={{ gridTemplateColumns: "1fr 1fr 1fr", gridGap: "1rem" }}
            >
              <div className="pagination-nav__item">
                <Link
                  className="pagination-nav__link"
                  to="/docs/intro/what-is-voxelize"
                >
                  <div className="pagination-nav__sublabel">
                    What is Voxelize?
                  </div>
                  <div className="pagination-nav__label">
                    A quick introduction to Voxelize
                  </div>
                </Link>
              </div>
              <div className="pagination-nav__item pagination-nav__item--next">
                <Link
                  className="pagination-nav__link"
                  to="/docs/basics/create-the-server"
                >
                  <div className="pagination-nav__sublabel">
                    Create a Server
                  </div>
                  <div className="pagination-nav__label">
                    Make your first Voxelize server!
                  </div>
                </Link>
              </div>
            </nav>
          </section>

          <HomepageFeatures />
        </main>
      </Wrapper>
    </Layout>
  );
};
