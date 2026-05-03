/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        // Club Récré brand palette
        "vert-recre": "#1F3D2E",
        "cream-gouter": "#F5E9D3",
        "cream-clair": "#FBF4E5",
        "orange-sirop": "#E87A3C",
        "jaune-cassette": "#F0C14B",
        "vert-pelouse": "#5FA68B",
        "noir-reglisse": "#181818",
        "gris-cartable": "#7A7770",
      },
      fontFamily: {
        bagel: ["'Bagel Fat One'", "cursive"],
        fraunces: ["'Fraunces'", "serif"],
        sans: ["'DM Sans'", "system-ui", "sans-serif"],
      },
      borderRadius: {
        btn: "8px",
        card: "16px",
      },
      maxWidth: {
        prose: "720px",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
