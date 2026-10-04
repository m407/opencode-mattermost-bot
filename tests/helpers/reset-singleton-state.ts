export async function resetSingletonState(): Promise<void> {
  const events = await import("../../src/opencode/events.js");
  events.stopEventListening();
  const modules = await Promise.all([
    import("../../src/app/services/session-cache-service.js"),
    import("../../src/opencode/server-health.js"),
    import("../../src/app/services/model-selection-service.js"),
    import("../../src/utils/logger.js"),
  ]);
  for (const module of modules)
    for (const [key, value] of Object.entries(module)) {
      if (key.startsWith("__reset") && key.endsWith("ForTests") && typeof value === "function")
        value();
    }
}
