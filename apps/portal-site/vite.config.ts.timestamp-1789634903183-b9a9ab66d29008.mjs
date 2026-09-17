// vite.config.ts
import { defineConfig } from "file:///home/amillard98/Documents/git/agents-assemble/node_modules/.pnpm/vite@5.4.21_@types+node@26.5.1_lightningcss@1.32.0/node_modules/vite/dist/node/index.js";
import react from "file:///home/amillard98/Documents/git/agents-assemble/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@26.5.1_lightningcss@1.32.0_/node_modules/@vitejs/plugin-react/dist/index.js";
import tailwindcss from "file:///home/amillard98/Documents/git/agents-assemble/node_modules/.pnpm/@tailwindcss+vite@4.3.3_vite@5.4.21_@types+node@26.5.1_lightningcss@1.32.0_/node_modules/@tailwindcss/vite/dist/index.mjs";
import { TanStackRouterVite } from "file:///home/amillard98/Documents/git/agents-assemble/node_modules/.pnpm/@tanstack+router-vite-plugin@1.167.38_@tanstack+react-router@1.170.36_react-dom@19.3.0_react@_k5s7bqvdl6criwpvmubnmqgxx4/node_modules/@tanstack/router-vite-plugin/dist/esm/index.js";
var __vite_injected_original_import_meta_url = "file:///home/amillard98/Documents/git/agents-assemble/apps/portal-site/vite.config.ts";
var vite_config_default = defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      routeFileIgnorePattern: "\\.test\\.tsx$"
    }),
    react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } }),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@": new URL("./src", __vite_injected_original_import_meta_url).pathname
    }
  },
  server: { port: 3e3 },
  preview: { port: 3e3 }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9hbWlsbGFyZDk4L0RvY3VtZW50cy9naXQvYWdlbnRzLWFzc2VtYmxlL2FwcHMvcG9ydGFsLXNpdGVcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9ob21lL2FtaWxsYXJkOTgvRG9jdW1lbnRzL2dpdC9hZ2VudHMtYXNzZW1ibGUvYXBwcy9wb3J0YWwtc2l0ZS92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vaG9tZS9hbWlsbGFyZDk4L0RvY3VtZW50cy9naXQvYWdlbnRzLWFzc2VtYmxlL2FwcHMvcG9ydGFsLXNpdGUvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdFwiO1xuaW1wb3J0IHRhaWx3aW5kY3NzIGZyb20gXCJAdGFpbHdpbmRjc3Mvdml0ZVwiO1xuaW1wb3J0IHsgVGFuU3RhY2tSb3V0ZXJWaXRlIH0gZnJvbSBcIkB0YW5zdGFjay9yb3V0ZXItdml0ZS1wbHVnaW5cIjtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIFRhblN0YWNrUm91dGVyVml0ZSh7XG4gICAgICByb3V0ZXNEaXJlY3Rvcnk6IFwiLi9zcmMvcm91dGVzXCIsXG4gICAgICBnZW5lcmF0ZWRSb3V0ZVRyZWU6IFwiLi9zcmMvcm91dGVUcmVlLmdlbi50c1wiLFxuICAgICAgcm91dGVGaWxlSWdub3JlUGF0dGVybjogXCJcXFxcLnRlc3RcXFxcLnRzeCRcIixcbiAgICB9KSxcbiAgICByZWFjdCh7IGJhYmVsOiB7IHBsdWdpbnM6IFtbXCJiYWJlbC1wbHVnaW4tcmVhY3QtY29tcGlsZXJcIiwge31dXSB9IH0pLFxuICAgIHRhaWx3aW5kY3NzKCksXG4gIF0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgXCJAXCI6IG5ldyBVUkwoXCIuL3NyY1wiLCBpbXBvcnQubWV0YS51cmwpLnBhdGhuYW1lLFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjogeyBwb3J0OiAzMDAwIH0sXG4gIHByZXZpZXc6IHsgcG9ydDogMzAwMCB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQStXLFNBQVMsb0JBQW9CO0FBQzVZLE9BQU8sV0FBVztBQUNsQixPQUFPLGlCQUFpQjtBQUN4QixTQUFTLDBCQUEwQjtBQUhtTSxJQUFNLDJDQUEyQztBQUt2UixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTO0FBQUEsSUFDUCxtQkFBbUI7QUFBQSxNQUNqQixpQkFBaUI7QUFBQSxNQUNqQixvQkFBb0I7QUFBQSxNQUNwQix3QkFBd0I7QUFBQSxJQUMxQixDQUFDO0FBQUEsSUFDRCxNQUFNLEVBQUUsT0FBTyxFQUFFLFNBQVMsQ0FBQyxDQUFDLCtCQUErQixDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQztBQUFBLElBQ25FLFlBQVk7QUFBQSxFQUNkO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLElBQUksSUFBSSxTQUFTLHdDQUFlLEVBQUU7QUFBQSxJQUN6QztBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVEsRUFBRSxNQUFNLElBQUs7QUFBQSxFQUNyQixTQUFTLEVBQUUsTUFBTSxJQUFLO0FBQ3hCLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
