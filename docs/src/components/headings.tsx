import React from "react";

export const H1 = (props: JSX.IntrinsicElements["h1"]) => {
  return <h1 {...props} className="font-display font-black text-8xl mb-3" />;
};

export const H2 = (props: JSX.IntrinsicElements["h2"]) => {
  return <h2 {...props} className="font-display font-black text-6xl mb-3" />;
};

export const H3 = (props: JSX.IntrinsicElements["h3"]) => {
  return <h3 {...props} className="font-display font-black text-4xl mb-3" />;
};

export const H4 = (props: JSX.IntrinsicElements["h4"]) => {
  return <h4 {...props} className="font-display font-black text-3xl mb-3" />;
};

export const H5 = (props: JSX.IntrinsicElements["h5"]) => {
  return <h5 {...props} className="font-display font-black text-2xl mb-3" />;
};

export const H6 = (props: JSX.IntrinsicElements["h6"]) => {
  return <h6 {...props} className="font-display font-black text-xl mb-3" />;
};
