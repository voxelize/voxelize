import { useEffect, useMemo, useRef, useState } from "react";

import BrowserOnly from "@docusaurus/BrowserOnly";
import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";

const IS_DEVELOPMENT = process.env.NODE_ENV === "development";

const DOCS_CARDS = [
  {
    title: "What is Voxelize?",
    description: "Learn about the voxel game engine and what you can build",
    href: "/tutorials/intro/what-is-voxelize",
  },
  {
    title: "Quick Start",
    description: "Get up and running with your first voxel world in minutes",
    href: "/tutorials/basics/create-the-server",
  },
  {
    title: "API Reference",
    description: "Explore the full API documentation for advanced usage",
    href: "/api/client/modules",
  },
];

const DocsCards = () => {
  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-12 md:py-16">
      <h2 className="text-center text-xl font-semibold text-neutral-900 dark:text-neutral-100 m-0 mb-8">
        Documentation
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {DOCS_CARDS.map((card) => (
          <Link
            key={card.href}
            to={card.href}
            className="group no-underline hover:no-underline block p-6 rounded-lg bg-white dark:bg-neutral-800 shadow-sm hover:shadow-md transition-shadow"
          >
            <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 m-0 mb-2 no-underline">
              {card.title}
            </h3>
            <p className="text-sm text-neutral-500 dark:text-neutral-400 m-0 leading-relaxed no-underline">
              {card.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
};

const IframeDemo = () => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const cacheBuster = useMemo(() => Math.random(), []);

  const coreUrl = useMemo(() => {
    const base = IS_DEVELOPMENT
      ? "http://localhost:3000"
      : "https://create.town";
    const splashTitle = encodeURIComponent("Voxelize");
    const splashSubtitle = encodeURIComponent(
      "Click to play, scroll to read docs"
    );
    return `${base}?cacheBuster=${cacheBuster}&splash_title=${splashTitle}&splash_subtitle=${splashSubtitle}`;
  }, [cacheBuster]);

  const handleExpandClick = () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    if (iframe.requestFullscreen) {
      iframe.requestFullscreen();
    } else if (
      (iframe as HTMLIFrameElement & { webkitRequestFullscreen?: () => void })
        .webkitRequestFullscreen
    ) {
      (
        iframe as HTMLIFrameElement & { webkitRequestFullscreen: () => void }
      ).webkitRequestFullscreen();
    } else if (
      (iframe as HTMLIFrameElement & { msRequestFullscreen?: () => void })
        .msRequestFullscreen
    ) {
      (
        iframe as HTMLIFrameElement & { msRequestFullscreen: () => void }
      ).msRequestFullscreen();
    }
  };

  return (
    <div className="w-full h-[calc(100vh-60px)] flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <iframe
          ref={iframeRef}
          src={coreUrl}
          frameBorder="0"
          allowFullScreen
          allow="fullscreen"
          className="w-full h-full absolute inset-0"
        />
        <div className="absolute bottom-3 right-3 opacity-50 hover:opacity-90 transition-opacity duration-200">
          <button
            onClick={handleExpandClick}
            className="bg-black/50 backdrop-blur-sm p-2 rounded-full text-white/90 hover:bg-black/70 transition-all border-none outline-none cursor-pointer flex items-center justify-center"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.5 9.5V4.5H9.5V6H7.06L10.53 9.47L9.47 10.53L6 7.06V9.5H4.5ZM14.5 4.5H19.5V9.5H18V7.06L14.53 10.53L13.47 9.47L16.94 6H14.5V4.5ZM10.53 14.53L7.06 18H9.5V19.5H4.5V14.5H6V16.94L9.47 13.47L10.53 14.53ZM13.47 14.53L14.53 13.47L18 16.94V14.5H19.5V19.5H14.5V18H16.94L13.47 14.53Z" />
            </svg>
          </button>
        </div>
      </div>
      <div className="h-10 flex items-center justify-between px-3 bg-neutral-50 dark:bg-neutral-900 border-y border-solid border-neutral-200 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/voxelize/voxelize"
            className="flex gap-1.5 items-center px-2 py-1 rounded bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 no-underline text-xs opacity-70 hover:opacity-100 transition-all"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            <span>GitHub</span>
          </a>
          <a
            href={coreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline text-xs opacity-50 hover:opacity-80 transition-opacity"
          >
            {IS_DEVELOPMENT ? "localhost:3000" : "create.town"}
          </a>
        </div>
        <Link
          to="/tutorials/intro/what-is-voxelize"
          className="text-xs opacity-60 hover:opacity-100 transition-opacity no-underline"
        >
          Get Started
        </Link>
      </div>
    </div>
  );
};

const MobileHero = () => {
  const cacheBuster = useMemo(() => Math.random(), []);

  const embeddedUrl = useMemo(() => {
    const base = IS_DEVELOPMENT
      ? "http://localhost:3000"
      : "https://create.town";
    const splashTitle = encodeURIComponent("Voxelize");
    const splashSubtitle = encodeURIComponent(
      "Click to play, scroll to read docs"
    );
    return `${base}?cacheBuster=${cacheBuster}&mode=spectator&embedded=true&splash_title=${splashTitle}&splash_subtitle=${splashSubtitle}`;
  }, [cacheBuster]);

  const fullscreenUrl = useMemo(() => {
    const base = IS_DEVELOPMENT
      ? "http://localhost:3000"
      : "https://create.town";
    return base;
  }, []);

  return (
    <div className="h-[calc(100vh-60px)] flex flex-col">
      <div className="flex-1 min-h-0">
        <iframe
          src={embeddedUrl}
          frameBorder="0"
          allowFullScreen
          allow="fullscreen"
          className="w-full h-full"
        />
      </div>

      <div className="flex gap-2 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-[var(--ifm-background-color)]">
        <a
          href={fullscreenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="no-underline block flex-1"
        >
          <button className="w-full h-11 text-sm font-semibold rounded-lg bg-[var(--ifm-color-primary)] text-[var(--ifm-background-color)] active:scale-[0.98] transition-transform duration-150 border-none cursor-pointer">
            Play Now
          </button>
        </a>
        <Link
          to="/tutorials/intro/what-is-voxelize"
          className="no-underline block flex-1"
        >
          <button className="w-full h-11 text-sm font-semibold rounded-lg bg-neutral-200 dark:bg-white/10 text-neutral-700 dark:text-neutral-300 active:scale-[0.98] transition-all duration-150 border-none cursor-pointer">
            Docs
          </button>
        </Link>
      </div>
    </div>
  );
};

const DesktopHero = () => {
  return <IframeDemo />;
};

const HomepageHeader = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor;
      const mobileRegex =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
      setIsMobile(mobileRegex.test(userAgent) || window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  return (
    <BrowserOnly>
      {() => (isMobile ? <MobileHero /> : <DesktopHero />)}
    </BrowserOnly>
  );
};

export default function Home() {
  return (
    <Layout>
      <main>
        <HomepageHeader />
        <DocsCards />
      </main>
    </Layout>
  );
}
