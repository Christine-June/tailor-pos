/// <reference types="vitest/config" />
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from "vite"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }

/**
 * After a production build: list every built file in precache.json so the service worker can
 * store all pages for offline use (not just the ones opened so far), and stamp sw.js with a
 * build id so each release installs fresh and clears the previous release's files.
 */
function offlinePrecache(): Plugin {
  let outDir = "dist"
  return {
    name: "tailorpos-offline-precache",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir
    },
    writeBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith("assets/"))
        .sort()
        .map((f) => `/${f}`)
      const build = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12)
      writeFileSync(join(outDir, "precache.json"), JSON.stringify({ build, version: pkg.version, files }, null, 2))
      const swPath = join(outDir, "sw.js")
      const sw = readFileSync(swPath, "utf8")
      if (!sw.includes('const BUILD = "dev"')) throw new Error("sw.js must declare const BUILD = \"dev\" for the build stamp")
      writeFileSync(swPath, sw.replace('const BUILD = "dev"', `const BUILD = "${build}"`))
    },
  }
}

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
    plugins: [react(), tailwindcss(), offlinePrecache()],
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    build: {
      rollupOptions: {
        output: {
          // React and the router change rarely: a separate file stays cached across releases.
          manualChunks: { vendor: ["react", "react-dom", "react-dom/client", "react-router-dom", "react-redux", "@reduxjs/toolkit"] },
        },
      },
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
