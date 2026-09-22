// Throwaway, loopback-only UI demo. No application API, credentials or persisted data.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

if (process.env.NODE_ENV === "production") throw new Error("Prototype is development-only.");
const files = new Map([
  ["/", ["index.html", "text/html"]],
  ["/prototype.css", ["prototype.css", "text/css"]],
  ["/prototype.js", ["prototype.js", "text/javascript"]],
]);
const port = Number(process.env.PROTOTYPE_PORT || 7416);
createServer(async (request, response) => {
  const file = files.get(new URL(request.url, "http://localhost").pathname);
  if (!file) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": `${file[1]}; charset=utf-8`,
    "Cache-Control": "no-store",
  });
  response.end(await readFile(new URL(file[0], import.meta.url)));
}).listen(port, "127.0.0.1", () =>
  console.log(`WAF-Loom prototypes: http://127.0.0.1:${port}/?variant=A`),
);
