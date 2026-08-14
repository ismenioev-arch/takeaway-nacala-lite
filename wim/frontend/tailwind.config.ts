import type { Config } from 'tailwindcss';

/**
 * As quatro prioridades da especificação (secção 4) são o vocabulário visual
 * de todo o painel. Ficam definidas aqui, num sítio só, para que o vermelho
 * de "urgente" seja o mesmo em todos os ecrãs.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        urgente: { DEFAULT: '#dc2626', soft: '#fef2f2', border: '#fecaca' },
        importante: { DEFAULT: '#ea580c', soft: '#fff7ed', border: '#fed7aa' },
        acompanhar: { DEFAULT: '#ca8a04', soft: '#fefce8', border: '#fef08a' },
        normal: { DEFAULT: '#16a34a', soft: '#f0fdf4', border: '#bbf7d0' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
