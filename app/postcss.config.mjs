// PostCSS disabled — we ship plain CSS via globals.css.
// Tailwind v4 + Turbopack on Windows ARM64 is currently unstable
// (oxide native binary issues + import processing not emitting output).
// We use plain CSS with custom properties + component classes instead.
const config = {
  plugins: {},
};

export default config;
