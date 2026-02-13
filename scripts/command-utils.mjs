export const isWindows = process.platform === "win32";

export const resolveCommand = (command) => {
  if (!isWindows) {
    return command;
  }

  if (command === "pnpm") {
    return "pnpm.cmd";
  }

  return `${command}.exe`;
};

export const resolvePnpmCommand = () => {
  return resolveCommand("pnpm");
};
