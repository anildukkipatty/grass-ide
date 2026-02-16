import http from "node:http";
import { networkInterfaces } from "node:os";
import { execFile } from "node:child_process";
import qrcode from "qrcode-terminal";
import { html } from "./client-html";

const PORT = 3001;

function getLocalIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

function getTailscaleIP(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("tailscale", ["ip", "-4"], { timeout: 2000 }, (err, stdout) => {
      if (err) return resolve(null);
      const ip = stdout.trim().split("\n")[0];
      resolve(ip || null);
    });
  });
}

export async function client() {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  server.listen(PORT, async () => {
    const ip = getLocalIP();
    const tsIP = await getTailscaleIP();

    const urls: { label: string; url: string }[] = [
      { label: "Local", url: `http://localhost:${PORT}` },
      { label: "Network", url: `http://${ip}:${PORT}` },
    ];
    if (tsIP) {
      urls.push({ label: "Tailscale", url: `http://${tsIP}:${PORT}` });
    }

    // Pre-generate all QR codes
    const qrCodes: string[] = await Promise.all(
      urls.map(
        (u) =>
          new Promise<string>((resolve) => {
            qrcode.generate(u.url, { small: true }, (code: string) => {
              resolve(code.trimEnd());
            });
          })
      )
    );

    // Print header
    const headerLines = [
      "",
      "  \x1b[1mgrass client\x1b[0m",
      "",
      ...urls.map((u) => `  ${u.label.padEnd(9)}  ${u.url}`),
      "",
    ];
    for (const line of headerLines) console.log(line);

    // QR cycling state
    let qrIdx = urls.length > 2 ? 2 : 1;
    let qrLineCount = 0;

    function renderQR() {
      const hint = urls.length > 1 ? " (\u2191\u2193 to switch)" : "";
      const label = `  QR: ${urls[qrIdx].label}${hint}`;
      const block = `${label}\n${qrCodes[qrIdx]}`;
      const lines = block.split("\n");

      // Move cursor up to overwrite previous QR block
      if (qrLineCount > 0) {
        process.stdout.write(`\x1b[${qrLineCount}A`);
      }
      for (const line of lines) {
        process.stdout.write(`\r${line}\x1b[K\n`);
      }
      // Clear leftover lines if previous block was taller
      for (let i = lines.length; i < qrLineCount; i++) {
        process.stdout.write(`\r\x1b[K\n`);
      }
      qrLineCount = Math.max(lines.length, qrLineCount);
    }

    renderQR();

    // Listen for arrow keys
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("data", (key: Buffer) => {
        const s = key.toString();
        if (s === "\x03") {
          shutdown();
          return;
        }
        if (s === "\x1b[A") {
          qrIdx = (qrIdx - 1 + urls.length) % urls.length;
          renderQR();
        } else if (s === "\x1b[B") {
          qrIdx = (qrIdx + 1) % urls.length;
          renderQR();
        }
      });
    }
  });

  const shutdown = () => {
    console.log("\nShutting down client...");
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
