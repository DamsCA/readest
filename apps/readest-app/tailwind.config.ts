import type { Config } from 'tailwindcss';
import { getContrastHex, themes } from './src/styles/themes.ts';
import daisyui from 'daisyui';
import typography from '@tailwindcss/typography';
import plugin from 'tailwindcss/plugin';

// The app's rounded shapes: soft cards, pill buttons and chips.
const shapes = {
  '--rounded-box': '1.5rem',
  '--rounded-btn': '9999px',
  '--rounded-badge': '9999px',
  '--tab-radius': '9999px',
};

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  safelist: [
    { pattern: /bg-./ },
    { pattern: /text-./ },
    { pattern: /fill-./ },
    { pattern: /decoration-./ },
    { pattern: /tooltip-./ },
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans Variable', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // Titles, the wordmark and big numbers.
        display: [
          'Bricolage Grotesque Variable',
          'DM Sans Variable',
          'ui-sans-serif',
          'sans-serif',
        ],
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
      },
    },
  },
  plugins: [
    daisyui,
    typography,
    plugin(function ({ addVariant }) {
      addVariant('eink', 'html[data-eink="true"] &');
      addVariant('not-eink', 'html:not([data-eink="true"]) &');
    }),
  ],
  daisyui: {
    themes: themes.reduce(
      (acc, { name, colors }) => {
        // Text on a primary button: pure black or white, whichever contrasts
        // more — the same rule the runtime themes follow (applyCustomTheme).
        acc.push({
          [`${name}-light`]: {
            ...colors.light,
            'primary-content': getContrastHex(colors.light.primary),
            ...shapes,
          },
        });
        acc.push({
          [`${name}-dark`]: {
            ...colors.dark,
            'primary-content': getContrastHex(colors.dark.primary),
            ...shapes,
          },
        });
        return acc;
      },
      ['light', 'dark'] as (Record<string, unknown> | string)[],
    ),
  },
};
export default config;
