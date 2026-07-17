import { defineConfig, loadEnv } from "vite";

// Vite dev server serves the frontend and proxies /api/* to the Express backend
// so the browser talks to one origin. In production, `npm run build` emits to
// dist/ and the Express server serves it directly (see server/server.mjs).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = env.PORT || "8088";
  const webPort = Number(env.WEB_PORT || 5173);

  return {
    root: ".",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      target: "esnext",
    },
    server: {
      port: webPort,
      proxy: {
        "/api": {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
  };
});
