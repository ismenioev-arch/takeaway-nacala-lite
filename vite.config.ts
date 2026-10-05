import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // In some preview environments, Vite env injection can be temporarily unavailable.
  // We provide safe fallbacks so the app never boots with missing backend config.
  const env = loadEnv(mode, process.cwd(), "");

  const FALLBACK_SUPABASE_URL = "https://xyiussjnfmomvlxzrqyy.supabase.co";
  const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5aXVzc2puZm1vbXZseHpycXl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1NzkwNDQsImV4cCI6MjA4NDE1NTA0NH0.lWmM1tkqsWjUqLORRFERr8e6Ar8rwSEVy4Lvh-3adz0";

  const supabaseUrl =
    env.VITE_SUPABASE_URL || env.SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const supabaseKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_PUBLISHABLE_KEY ||
    FALLBACK_SUPABASE_PUBLISHABLE_KEY;

  return {
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    define: {
      // Ensure these exist at runtime for the auto-generated client.
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabaseKey),
    },
    plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    test: {
      // O WIM vive em `wim/` e tem a sua própria suite, com base de dados e
      // ambiente Node. Sem esta restrição, `npm test` na raiz apanhava-a
      // também e falhava — não por haver um defeito, mas por estar a correr
      // testes de backend num ambiente de browser.
      include: ["src/**/*.{test,spec}.{ts,tsx}"],
      environment: "jsdom",
      globals: true,
    },
  };
});
