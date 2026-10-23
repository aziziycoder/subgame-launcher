/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/renderer/index.html",
    "./src/renderer/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        game: {
          bg: '#0B0D12',
          surface: '#141821',
          card: '#1A1F2A',
          cardHover: '#222938',
          border: '#2A3245',
          borderLight: '#374151',
          text: '#F5F7FA',
          muted: '#9CA3AF',
          dim: '#6B7280',
          accent: {
            DEFAULT: '#A3E635',
            hover: '#84CC16',
            light: '#BEF264',
            dark: '#65A30D',
            glow: 'rgba(163, 230, 53, 0.15)',
          },
          cyan: '#38BDF8',
          purple: '#A855F7',
          amber: '#F59E0B',
          red: '#EF4444',
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        gaming: ['Orbitron', 'Plus Jakarta Sans', 'sans-serif'],
      },
      boxShadow: {
        'card-glow': '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(163, 230, 53, 0.05)',
        'accent-glow': '0 0 25px rgba(163, 230, 53, 0.35)',
        'modal': '0 25px 50px -12px rgba(0, 0, 0, 0.85)',
      }
    },
  },
  plugins: [],
}
