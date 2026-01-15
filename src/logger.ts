import pino from "pino";

// Logger instance - configured after config is loaded
let loggerInstance: pino.Logger | null = null;

export function initLogger(level: string = "info"): pino.Logger {
  loggerInstance = pino({
    level,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
      },
    },
  });
  return loggerInstance;
}

export function getLogger(): pino.Logger {
  if (!loggerInstance) {
    // Default logger before config is loaded
    loggerInstance = pino({
      level: "info",
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
        },
      },
    });
  }
  return loggerInstance;
}
