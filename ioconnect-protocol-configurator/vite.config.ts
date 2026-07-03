import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { readFileSync, existsSync } from "fs";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Explicitly load the .env file from the current directory
  const env = loadEnv(mode, process.cwd(), "");

  // Now we can accurately read the profile
  const profile = env.VITE_CONFIG_PROFILE || "opcua";
  const schemaPath = path.resolve(__dirname, `configs/${profile}/schema.json`);

  let schemaRaw = "{}";
  if (existsSync(schemaPath)) {
    schemaRaw = readFileSync(schemaPath, "utf-8");
  } else {
    console.warn(`[Vite] Schema not found at ${schemaPath}, using empty object.`);
  }

  const apiBase = env.VITE_API_BASE || "/api";
  const apiTarget = env.VITE_API_TARGET || "http://localhost:3001";
  const basePath = (env.VITE_BASE_PATH || "").replace(/\/$/, "");

  const proxyRules: Record<string, object> = {
    [apiBase]: { target: apiTarget, changeOrigin: true },
  };
  if (basePath) {
    proxyRules[`${basePath}${apiBase}`] = {
      target: apiTarget,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(`${basePath}${apiBase}`, apiBase),
    };
  }

  return {
    base: './',
    server: {
      host: "::",
      port: 6767,
      allowedHosts: [".iocompute.ai", "localhost", "127.0.0.1"],
      hmr: {
        overlay: false,
      },
      proxy: proxyRules,
    },
    define: {
      __PROTOCOL_SCHEMA__: schemaRaw,
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // @ts-ignore - Vitest types might not be in the main Vite config type
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
    },
  };
});
