const path = require("path");

const CopyWebpackPlugin = require("copy-webpack-plugin");
const buildPath = "./build/";

module.exports = {
  entry: ["./example/src/index.js"],
  output: {
    path: path.join(__dirname, buildPath),
    filename: "index.js",
  },
  mode: "development",
  target: "web",
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.js$/,
        use: "babel-loader",
        exclude: path.resolve(__dirname, "./node_modules/"),
      },
      {
        test: /\.(jpe?g|png|gif|svg|tga|glb|babylon|mtl|pcb|pcd|prwm|obj|mat|mp3|ogg)$/i,
        use: "file-loader",
        exclude: path.resolve(__dirname, "./node_modules/"),
      },
    ],
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: ["example/src/index.html"],
    }),
  ],
  devServer: {
    port: 3000,
  },
};
