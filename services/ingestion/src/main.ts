import { networkInterfaces } from "node:os";
import { createIngestionServer } from "./server.js";

const port = Number(process.env.PORT ?? 4477);
const dbPath = process.env.PP_DB ?? "potholeproof.sqlite";

const server = createIngestionServer({ dbPath });
server.listen(port, () => {
  console.log(`PotholeProof ingestion listening on port ${port}`);
  console.log(`Database: ${dbPath}`);
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        console.log(`Phone upload URL (same Wi-Fi): http://${a.address}:${port}`);
      }
    }
  }
});
