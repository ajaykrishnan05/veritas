/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f1b33',
        primary: { DEFAULT: '#4338ca', hover: '#3730a3' },
        surface: '#f6f7fb',
      },
    },
  },
  plugins: [],
};
