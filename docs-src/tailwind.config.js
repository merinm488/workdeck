/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark theme colors (Black & White)
        dark: {
          bg: '#0A0A0A',
          card: '#1A1A1A',
          border: '#2A2A2A',
          text: '#E5E5E5',
          muted: '#737373'
        },
        // Light theme colors (White + Docs Blue)
        light: {
          bg: '#FAFAFA',
          card: '#FFFFFF',
          border: '#E5E5E5',
          text: '#1A1A1A',
          muted: '#737373',
          accent: '#4285F4', // Docs blue
          accentHover: '#3367D6', // Docs blue hover
          accentLight: '#D2E3FC', // Docs blue tint
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-in',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
