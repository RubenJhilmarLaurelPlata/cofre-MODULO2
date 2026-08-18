import type { Config } from 'tailwindcss';

// Sistema de diseño Cofre Express — identidad de marca: azul oscuro
// (navy, estructura/sidebar), naranja institucional (acciones,
// selección, alertas operativas) y blanco (superficie de contenido).
// Verde/ámbar/rojo quedan reservados exclusivamente para estados
// funcionales (pagado/por-pagar/error) — nunca decorativos. Paleta
// deliberadamente restringida, sin degradados.
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#FFF4EC',
          100: '#FFE6D5',
          200: '#FEC9A3',
          300: '#FDA76A',
          400: '#FB8332',
          500: '#F2660F', // naranja institucional — color primario de acción
          600: '#D9530A',
          700: '#B4420A',
          800: '#8F350D',
          900: '#742D0E',
        },
        ink: {
          DEFAULT: '#0F1115', // texto principal
          soft: '#4B5058',    // texto secundario
        },
        navy: {
          // Azul oscuro institucional — usado en el sidebar/navegación
          // para dar identidad estructural, independiente del toggle
          // claro/oscuro del contenido (igual que Linear/Vercel). Escala
          // retocada en Fase 4B para dar mas profundidad (varios tonos,
          // no un solo azul plano repetido).
          50: '#EEF1F7',
          100: '#D6DCEA',
          400: '#3C4A6B',
          600: '#22304D',
          700: '#182235',
          800: '#111A2A',
          900: '#0B1220',
          950: '#050914',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 17 21 / 0.04), 0 1px 3px 0 rgb(15 17 21 / 0.06)',
        popover: '0 4px 6px -1px rgb(15 17 21 / 0.08), 0 10px 20px -4px rgb(15 17 21 / 0.08)',
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
};

export default config;
