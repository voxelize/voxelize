const path = require("path");

const WorkerPlugin = require("worker-plugin");

const packageJson = require("./package.json");

module.exports = {
  entry: path.resolve("./src/index.ts"),
  devtool: "source-map",
  mode: process.env.NODE_ENV || "development",
  output: {
    path: path.resolve("./dist"),
    filename: packageJson.module,
  },
  module: {
    rules: [
      {
        test: /(\.tsx|\.ts)$/,
        use: [
          "babel-loader",
          {
            loader: "ts-loader",
            options: {
              configFile: path.resolve("./tsconfig.build.json"),
            },
          },
        ],
        exclude: /(node_modules)/,
      },
      {
        test: /(\.jsx|\.js)$/,
        use: "babel-loader",
        exclude: /(node_modules)/,
      },
    ],
  },
  resolve: {
    modules: [path.resolve("../../node_modules"), path.resolve("src")],
    extensions: [".json", ".js", ".jsx", ".ts", ".tsx"],
  },
  plugins: [new WorkerPlugin()],
  experiments: {
    outputModule: true,
  },
  externals: {
    three: "three",
  },
};
