/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 5173,
      // The browser only ever talks to its own origin; Vite forwards /api to Flask.
      proxy: {
        "/api": { target: env.VITE_PROXY_TARGET || "http://localhost:5000", changeOrigin: true },
      },
    },
    test: { environment: "node" },
  }
})
