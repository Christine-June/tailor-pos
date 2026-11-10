/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type ProxyOptions } from "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")

  // The browser only ever talks to its own origin; Vite forwards /api to Flask.
  const apiProxy: Record<string, ProxyOptions> = {
    "/api": {
      target: env.VITE_PROXY_TARGET || "http://localhost:5000",
      changeOrigin: true,
      // When Flask is down, answer 502 Bad Gateway as nginx does in production, so the app sees
      // "server unreachable" (and saves sales offline) rather than a generic server error.
      configure: (proxy) => {
        proxy.on("error", (_err, _req, res) => {
          if ("writeHead" in res && !res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" })
            res.end(JSON.stringify({ error: { code: "bad_gateway", message: "The server can't be reached.", details: null } }))
          }
        })
      },
    },
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5173,
      // Docker on Windows (or a project under /mnt/c in WSL) doesn't pass file-change events
      // into the container, so poll instead. Set VITE_POLL=1 in docker-compose.yml.
      watch: env.VITE_POLL ? { usePolling: true, interval: 300 } : undefined,
      proxy: apiProxy,
    },
    // `npm run preview` serves the production build (with the offline service worker) on 4173.
    preview: { port: 4173, proxy: apiProxy },
    test: { environment: "node" },
  }
})
