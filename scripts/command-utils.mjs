export const isWindows = process.platform === "win32";

export const resolveCommandForPlatform = (command, platform) => {
  if (platform !== "win32") {
    return command;
  }

  if (command === "pnpm") {
    return "pnpm.cmd";
  }

  return `${command}.exe`;
};

export const resolveCommand = (command) => {
  return resolveCommandForPlatform(command, process.platform);
};

export const resolvePnpmCommandForPlatform = (platform) => {
  return resolveCommandForPlatform("pnpm", platform);
};

export const resolvePnpmCommand = () => {
  return resolvePnpmCommandForPlatform(process.platform);
};
