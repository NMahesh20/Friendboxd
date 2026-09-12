import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        base: {
          950: '#0a0a0f',
          900: '#101018',
          850: '#14141f',
          800: '#1a1a28',
          700: '#242436',
          600: '#32324a',
        },
        accent: {
          DEFAULT: '#e50914',
          soft: '#ff5c5c',
        },
        gold: '#f5c518',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      backgroundImage: {
        'hero-glow':
          'radial-gradient(1200px 600px at 50% -10%, rgba(229,9,20,0.18), transparent 60%), radial-gradient(900px 500px at 85% 10%, rgba(245,197,24,0.08), transparent 55%)',
        'card-sheen':
          'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 40%)',
      },
      boxShadow: {
        card: '0 10px 30px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(229,9,20,0.35), 0 8px 40px -8px rgba(229,9,20,0.45)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.4)', opacity: '0' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.4s ease both',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-ring': 'pulse-ring 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;