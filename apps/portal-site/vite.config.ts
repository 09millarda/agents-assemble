import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      routeFileIgnorePattern: "\\.test\\.tsx$",
    }),
    react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  server: { port: 3000 },
  preview: { port: 3000 },
});
