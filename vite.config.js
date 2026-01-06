import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Dev server should be "/", GH pages is "/gsr-app/"
  base: command === "serve" ? "/" : "/gsr-app/",
}));
