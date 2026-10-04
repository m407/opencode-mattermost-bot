import { config } from "../../config.js";
import { MattermostBot } from "../../mattermost/bot.js";
import { createCallbackServer } from "../../mattermost/http.js";
import { OpencodeAutoRestartService } from "../../opencode/auto-restart.js";
import { OpencodeReadyLifecycle } from "../../opencode/ready-lifecycle.js";
import { logger, flushLogger } from "../../utils/logger.js";

export async function startBotApp(): Promise<void> {
  const bot = new MattermostBot();
  const lifecycle = new OpencodeReadyLifecycle();
  lifecycle.onReady(() => bot.activity.reconcile());
  const restart = new OpencodeAutoRestartService(lifecycle);
  const server =
    bot.actions && config.mattermost.callbackUrl
      ? createCallbackServer({
          path: new URL(config.mattermost.callbackUrl).pathname.replace(/\/$/, ""),
          secret: config.mattermost.callbackSecret,
          commandToken: () => process.env.MATTERMOST_COMMAND_TOKEN ?? "",
          userId: config.mattermost.allowedUserId,
          channelId: config.mattermost.channelId,
          actions: bot.actions,
          onCommand: (request) => bot.acceptCommand(request.text, request.root_id),
        })
      : undefined;
  let closing = false;
  const stop = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    restart.stop();
    server?.close();
    await bot.stop();
    await flushLogger();
  };
  try {
    await bot.client.getMe();
    if (server)
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.mattermost.callbackPort, config.mattermost.callbackHost, resolve);
      });
    await bot.start();
    await restart.start();
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void stop().catch((error) => logger.error("Shutdown failed", error));
      });
    logger.info("Mattermost bot started");
  } catch (error) {
    await stop();
    throw error;
  }
}
