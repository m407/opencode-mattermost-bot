import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const user = "a".repeat(26),
  channel = "b".repeat(26),
  bot = "c".repeat(26),
  root = "r".repeat(26);
const home = await mkdtemp(path.join(os.tmpdir(), "mattermost-smoke-"));
const posts = [];
const streams = new Set();
let complete = false;
let prompt;
let child;
let output = "";
const send = (res, data, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};
const api = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  if (p.endsWith("/event")) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": connected\n\n");
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }
  if (p === "/global/health") return send(res, { healthy: true, version: "1.18.8" });
  if (p === "/project")
    return send(res, [{ id: "project", worktree: "/project", name: "Project" }]);
  if (p === "/path") return send(res, { directory: "/project", worktree: "/project" });
  if (p === "/session" && req.method === "POST")
    return send(res, { id: "session-1", title: "Smoke", directory: "/project" });
  if (p === "/session/status") return send(res, {});
  if (p === "/permission" || p === "/question") return send(res, []);
  if (p === "/session/session-1/message")
    return send(
      res,
      complete
        ? [
            {
              info: {
                id: "assistant-1",
                sessionID: "session-1",
                role: "assistant",
                time: { created: Date.now(), completed: Date.now() },
              },
              parts: [
                {
                  id: "part-1",
                  type: "text",
                  text: "Runtime smoke passed",
                  sessionID: "session-1",
                  messageID: "assistant-1",
                },
              ],
            },
          ]
        : [],
    );
  if (p === "/session/session-1/prompt_async") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    prompt = JSON.parse(Buffer.concat(chunks));
    complete = true;
    send(res, {}, 202);
    setTimeout(() => {
      const event = { type: "session.idle", properties: { sessionID: "session-1" } };
      for (const stream of streams)
        stream.write("data: " + JSON.stringify({ directory: "/project", payload: event }) + "\n\n");
    }, 80);
    return;
  }
  process.stderr.write(`Unexpected OpenCode route ${req.method} ${req.url}\n`);
  send(res, {}, 404);
});
const mm = http.createServer(async (req, res) => {
  if (req.url === "/api/v4/users/me") return send(res, { id: bot, username: "opencode" });
  if (req.url === "/api/v4/posts" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const post = { ...JSON.parse(Buffer.concat(chunks)), id: `out-${posts.length}` };
    posts.push(post);
    return send(res, post);
  }
  if (req.url.includes("/posts/")) return send(res, { id: "dashboard" });
  send(res, {}, 404);
});
const ws = new WebSocketServer({ server: mm });
let socket;
ws.on("connection", (s) => {
  socket = s;
  s.send(JSON.stringify({ event: "hello", data: { server_version: "10.0" } }));
});
await Promise.all([
  new Promise((r) => api.listen(0, "127.0.0.1", r)),
  new Promise((r) => mm.listen(0, "127.0.0.1", r)),
]);
const wait = async (fn, label) => {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Timeout ${label}\n${output}`);
};
let seq = 0;
const message = (text) => {
  seq++;
  socket.send(
    JSON.stringify({
      event: "posted",
      data: {
        post: JSON.stringify({
          id: `input-${seq}`,
          user_id: user,
          channel_id: channel,
          root_id: root,
          message: text,
          type: "",
          props: {},
          create_at: Date.now(),
          update_at: Date.now(),
          delete_at: 0,
        }),
      },
    }),
  );
};
try {
  child = spawn(process.execPath, ["dist/index.js"], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      OPENCODE_MATTERMOST_HOME: home,
      MATTERMOST_URL: `http://127.0.0.1:${mm.address().port}`,
      MATTERMOST_BOT_TOKEN: "smoke-token",
      MATTERMOST_ALLOWED_USER_ID: user,
      MATTERMOST_CHANNEL_ID: channel,
      OPENCODE_SERVER_VERSION: "v1",
      OPENCODE_API_URL: `http://127.0.0.1:${api.address().port}`,
      OPENCODE_MODEL_PROVIDER: "test",
      OPENCODE_MODEL_ID: "model",
      BOT_LOCALE: "en",
      LOG_LEVEL: "error",
      INITIAL_SETTINGS_PRESET: '{"pinnedDashboardEnabled":false,"showAssistantRunFooter":false}',
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (c) => (output += c));
  child.stderr.on("data", (c) => (output += c));
  await wait(() => socket, "WebSocket connection");
  message("!open /project");
  await wait(() => posts.some((p) => p.message.includes("Project:")), "project selection");
  message("!new");
  await wait(() => posts.some((p) => p.message.includes("Session created")), "session creation");
  await wait(() => streams.size > 0, "SSE subscription");
  message("Verify runtime");
  await wait(() => posts.some((p) => p.message === "Runtime smoke passed"), "assistant reply");
  if (prompt.parts[0].text !== "Verify runtime") throw new Error("Wrong SDK prompt");
  if (posts.find((p) => p.message === "Runtime smoke passed").root_id !== root)
    throw new Error("Wrong output thread");
  child.kill("SIGTERM");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Shutdown timeout")), 5000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Exit ${code}`));
    });
  });
  process.stdout.write(
    "PASS: compiled runtime, Mattermost REST/WebSocket, project/session selection, OpenCode prompt + SSE reply, thread routing and graceful shutdown\n",
  );
} finally {
  child?.kill("SIGKILL");
  for (const stream of streams) stream.end();
  for (const client of ws.clients) client.terminate();
  ws.close();
  api.closeAllConnections();
  mm.closeAllConnections();
  api.close();
  mm.close();
  await rm(home, { recursive: true, force: true });
}
