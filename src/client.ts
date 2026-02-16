import http from "node:http";
import { html } from "./client-html";

const PORT = 3001;

export async function client() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(PORT, () => {
    console.log(`grass client running at http://localhost:${PORT}`);
  });

  const shutdown = () => {
    console.log("\nShutting down client...");
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
