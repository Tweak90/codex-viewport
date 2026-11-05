import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";

const port = Number(process.env.GATEWAY_PORT || 4500);
const socket = process.env.CODEX_SOCKET || "/run/codex/app-server-control.sock";
const token = process.env.CODEX_API_TOKEN || "";
const server = http.createServer((req, res) => {
  res.writeHead(req.url === "/healthz" ? 200 : 404, {
    "Content-Type": "application/json",
  });
  res.end(JSON.stringify({ service: "codex-api-gateway" }));
});
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 32 * 1024 * 1024,
});
server.on("upgrade", (req, networkSocket, head) => {
  const received = Buffer.from(req.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (
    token &&
    (received.length !== expected.length ||
      !timingSafeEqual(received, expected))
  ) {
    networkSocket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }
  wss.handleUpgrade(req, networkSocket, head, (client) => {
    const upstream = new WebSocket(`ws+unix://${socket}:/`, {
      handshakeTimeout: 10000,
      maxPayload: 32 * 1024 * 1024,
    });
    const queued = [];
    let queueBytes = 0;
    client.on("message", (data) => {
      if (upstream.readyState === WebSocket.OPEN)
        upstream.send(data.toString());
      else if (upstream.readyState === WebSocket.CONNECTING) {
        queueBytes += data.length;
        if (queueBytes > 32 * 1024 * 1024) client.close(1009, "Queue limit");
        else queued.push(data.toString());
      }
    });
    upstream.on("open", () => {
      for (const data of queued) upstream.send(data);
      queued.length = 0;
    });
    upstream.on("message", (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data.toString());
    });
    upstream.on("error", (error) => {
      console.error("Codex socket:", error.message);
      client.close(1011, "Codex-Socket nicht erreichbar");
    });
    upstream.on("close", () => client.close(1011, "Codex-Verbindung beendet"));
    client.on("close", () => {
      if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
      else upstream.close();
    });
    client.on("error", () => upstream.terminate());
  });
});
server.listen(port, "0.0.0.0", () =>
  console.log(`Codex API gateway listening on :${port}`),
);
process.on("SIGTERM", () => {
  for (const client of wss.clients) client.terminate();
  server.close(() => process.exit(0));
});
