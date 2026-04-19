import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vitest.dev/config/#configuration
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_PROXY || "http://127.0.0.1:5050";

  return {
    plugins: [react()],
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/setupTests.js",
      include: ["src/**/*.test.{js,jsx}"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
        reportsDirectory: "./coverage",
        include: ["src/**/*.{js,jsx}"],
        exclude: ["src/**/*.test.{js,jsx}", "src/setupTests.js", "src/main.jsx"],
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          configure(proxy) {
            proxy.on("error", () => {
              console.error(
                `[vite] API proxy: cannot connect to ${apiTarget}. Start the server (cd server && npm run dev) or set VITE_API_PROXY in client/.env`
              );
            });
          },
        },
      },
    },
  };
});
