import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Em dev, /v1 vai para a API local: o navegador fala com uma única origem (sem CORS).
export default defineConfig({ plugins: [react()], server: { proxy: { "/v1": "http://localhost:3000" } } });
