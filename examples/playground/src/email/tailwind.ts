import { type TailwindConfig, pixelBasedPreset } from '@react-email/components';

/**
 * The one Tailwind config every email renders with (through `Shell` in
 * layout.tsx). `pixelBasedPreset` turns Tailwind's rem scale into px — email
 * clients disagree about the root font size, px they all honour. The brand
 * colours live here, so templates say `text-ink`, never a hex value.
 */
export const tailwindConfig: TailwindConfig = {
  presets: [pixelBasedPreset],
  theme: {
    extend: {
      colors: {
        /** Headings, buttons, inline emphasis. */
        ink: '#0f172a',
        /** Body copy. */
        body: '#475569',
        /** Fine print. */
        muted: '#94a3b8',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
};
