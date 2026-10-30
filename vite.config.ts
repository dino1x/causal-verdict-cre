import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handleApi } from "./server/api";

// /api/* is served by server/api.ts inside the dev server, so RYO_MCP_KEY stays in Node.
// Only VITE_-prefixed variables can reach client code; this project defines none.
export default defineConfig({
  plugins: [
    react(),
    {
      name: "causal-verdict-api",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!(await handleApi(req, res))) next();
        });
      },
    },
  ],
  server: { port: 5173 },
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
});
