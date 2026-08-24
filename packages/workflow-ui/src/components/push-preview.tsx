import { Camera, ChevronDown, Flashlight, Lock } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import iphoneFrameUrl from '../app/assets/devices/iphone-17-pro.png';
import pixelBackUrl from '../app/assets/devices/pixel-10-pro-back.webp';
import pixelMaskUrl from '../app/assets/devices/pixel-10-pro-mask.webp';

/**
 * Push-notification preview: the two platforms' lock screens, side by side.
 *
 * Emails render themselves — the preview is an iframe around real output. A
 * push has no document of its own: what the user sees is the OS's chrome
 * around two strings, so the preview must *draw* that chrome. Both platforms
 * are shown at once because their layouts genuinely differ (iOS stacks
 * notifications at the bottom of the lock screen, Android under the clock)
 * and the copy has to survive both.
 *
 * The hardware is the vendors' own artwork, not ours: Apple's iPhone 17 Pro
 * product bezel (developer.apple.com/design/resources, PNG with a transparent
 * screen cutout the content shows through — the Dynamic Island is part of the
 * bezel) and Google's Pixel 10 Pro device frame (AOSP's device-art-resources,
 * the artwork behind Android Studio's screenshot framing: a `back` body layer
 * under the content and a screen-sized `mask` overlay painting the corner
 * bezels and the punch-hole camera over it).
 *
 * The software is drawn to the platforms' own design kits, at true scale:
 * screen content renders at the device's logical resolution (402pt / 412dp)
 * and is scaled into the frame's window, so every measurement below is the
 * spec's own number. iOS notification metrics come from the iOS 26 Figma kit
 * and a real device's lock screen (card 386w r28, padding 14/12, centred icon
 * 38 r12, title SF 15/17 semibold −0.23,
 * body 15/18 regular, time 15/17 top-right); Android lock-screen metrics
 * follow Google's official Android UI Kit on Figma (leading 40dp app icon,
 * bold 14sp title with an inline "• now", 14sp content line, a circled
 * expander). Collapsed banners carry no rich image on either platform.
 */
export interface PushPreviewProps {
  /** App identity on the banner; falls back to the project title upstream. */
  appName: string;
  /** Shown verbatim, `{prop}` placeholders included — same rule as subjects. */
  title: string;
  body: string;
  scheme: 'light' | 'dark';
  zoom: number;
}

/** The keynote clock: every device mockup shows 9:41. */
const CLOCK = '9:41';
/** Rendered device width; the frames' aspect ratios set everything else. */
const DEVICE_W = 300;

/** One frame asset's geometry: canvas size and the screen window inside it. */
interface FrameGeometry {
  w: number;
  h: number;
  screen: { x: number; y: number; w: number; h: number };
  /**
   * Corner radius of the screen window, in the artwork's pixels. The content
   * must round itself off: the window's corner arcs pass inside its bounding
   * box, and past them the artwork is transparent (the outside of the device),
   * so square content corners would poke out of the hardware.
   */
  screenRadius: number;
  /** Logical width (pt / dp): screen content renders at this and scales down. */
  logicalW: number;
}

/** Measured from the bezel PNG (alpha scan of the transparent cutout). */
const IPHONE: FrameGeometry = {
  w: 1350,
  h: 2760,
  screen: { x: 72, y: 69, w: 1206, h: 2622 },
  screenRadius: 185,
  logicalW: 402,
};
/** From the frame's layout descriptor (display size/offset, corner_radius). */
const PIXEL: FrameGeometry = {
  w: 1410,
  h: 2968,
  screen: { x: 59, y: 60, w: 1280, h: 2856 },
  screenRadius: 99,
  logicalW: 412,
};

/**
 * Apple's continuous corner — a true squircle, not the studio's subtler 1.2.
 * Falls back to plain border-radius where `corner-shape` is unsupported.
 */
const squircle = { cornerShape: 'superellipse(2)' } as CSSProperties;

/** App icon stand-in: initial on a gradient, sized by the caller. */
function AppIcon({
  name,
  size,
  radius,
  shape,
  className,
}: {
  name: string;
  size: number;
  radius: number;
  shape?: CSSProperties;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center font-semibold text-white ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: size * 0.48,
        background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 55%,#d946ef 100%)',
        ...shape,
      }}
    >
      {(name.trim().charAt(0) || 'A').toUpperCase()}
    </div>
  );
}

/**
 * One device: platform label above, then the frame artwork with the software
 * screen composited into its window. Children render at the device's logical
 * resolution and are scaled to fit, so their styles use real pt / dp values.
 */
function Device({
  label,
  dark,
  geometry,
  underlay,
  overlay,
  overlayPlacement = 'frame',
  screenShape,
  wallpaper,
  children,
}: {
  label: string;
  dark: boolean;
  geometry: FrameGeometry;
  underlay?: string;
  overlay: string;
  /** Whether the overlay artwork spans the whole frame or just the screen window. */
  overlayPlacement?: 'frame' | 'screen';
  /** Extra corner treatment for the screen content (the iPhone's squircle). */
  screenShape?: CSSProperties;
  wallpaper: string;
  children: ReactNode;
}) {
  const scale = DEVICE_W / geometry.w;
  const screenRect: CSSProperties = {
    position: 'absolute',
    left: geometry.screen.x * scale,
    top: geometry.screen.y * scale,
    width: geometry.screen.w * scale,
    height: geometry.screen.h * scale,
  };
  const frameRect: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
  };
  /* Logical canvas: spec-true units inside, one scale() to the frame window. */
  const logicalScale = (geometry.screen.w * scale) / geometry.logicalW;
  const logicalH = (geometry.screen.h / geometry.screen.w) * geometry.logicalW;
  return (
    <div className="shrink-0" style={{ width: DEVICE_W }}>
      <div
        className="mb-4 text-center text-[14px] font-semibold"
        style={{ color: dark ? 'var(--color-gray-400)' : 'var(--color-gray-500)' }}
      >
        {label}
      </div>
      <div
        className="relative"
        style={{
          width: DEVICE_W,
          height: Math.round(geometry.h * scale),
          filter: dark
            ? 'drop-shadow(0 20px 40px rgba(0,0,0,0.55))'
            : 'drop-shadow(0 20px 40px rgba(15,23,42,0.3))',
        }}
      >
        {underlay !== undefined && <img src={underlay} alt="" style={frameRect} />}
        <div
          className="overflow-hidden"
          style={{
            ...screenRect,
            borderRadius: geometry.screenRadius * scale,
            background: wallpaper,
            ...screenShape,
          }}
        >
          <div
            className="flex flex-col"
            style={{
              width: geometry.logicalW,
              height: logicalH,
              transform: `scale(${logicalScale})`,
              transformOrigin: 'top left',
            }}
          >
            {children}
          </div>
        </div>
        <img
          src={overlay}
          alt=""
          className="pointer-events-none"
          style={overlayPlacement === 'screen' ? screenRect : frameRect}
        />
      </div>
    </div>
  );
}

function IosDevice({
  appName,
  title,
  body,
  dark,
}: Omit<PushPreviewProps, 'zoom' | 'scheme'> & { dark: boolean }) {
  const face: CSSProperties = {
    fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif",
  };
  const primary = dark ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.9)';
  const secondary = dark ? 'rgba(235,235,245,0.6)' : '#4D4D4D';
  return (
    <Device
      label="iOS"
      dark={dark}
      geometry={IPHONE}
      overlay={iphoneFrameUrl}
      screenShape={squircle}
      wallpaper={
        dark
          ? 'linear-gradient(170deg,#26355f 0%,#45296b 52%,#131625 100%)'
          : 'linear-gradient(170deg,#a9c4ff 0%,#d5b3f7 52%,#ffc0d3 100%)'
      }
    >
      <div className="relative flex min-h-0 flex-1 flex-col" style={face}>
        {/*
          Wallpaper glow, sitting behind the banner: frosted glass is invisible
          over a flat gradient — the blur needs detail to smear. Two soft light
          blobs give the backdrop-filter something to show.
        */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute rounded-full"
            style={{
              left: 20,
              top: 540,
              width: 240,
              height: 240,
              background: `radial-gradient(circle, ${
                dark ? 'rgba(125,110,255,0.4)' : 'rgba(255,255,255,0.75)'
              }, transparent 65%)`,
            }}
          />
          <div
            className="absolute rounded-full"
            style={{
              right: -40,
              top: 640,
              width: 280,
              height: 280,
              background: `radial-gradient(circle, ${
                dark ? 'rgba(70,150,255,0.32)' : 'rgba(255,170,205,0.7)'
              }, transparent 65%)`,
            }}
          />
        </div>
        {/*
          Lock-screen clock, at the kit's measured offsets (Examples/
          Notifications): the 22pt medium date sits at y76 (26 tall), the
          clock's glyphs at y119 with a 73pt cap height (a ~100pt face) — a
          17pt visual gap between them.
        */}
        <div
          className="mt-[76px] shrink-0 text-center"
          style={{ color: 'rgba(255,255,255,0.95)', textShadow: '0 1px 18px rgba(0,0,0,0.18)' }}
        >
          <div className="text-[22px] leading-[26px] font-medium">Monday, June 9</div>
          <div className="mt-[3px] text-[100px] leading-[100px] font-semibold tracking-[-2px]">
            {CLOCK}
          </div>
        </div>
        {/* Wallpaper breathes; notifications rise from the bottom on iOS. */}
        <div className="min-h-0 flex-1" />
        {/*
          The banner, to the iOS 26 kit: 8pt side margins (386 wide on a 402pt
          screen), padding 14/12, a 10pt gap after the 38pt icon, and the time
          top-right.
        */}
        <div
          className="relative mx-[8px] shrink-0 rounded-[40px] px-[14px] py-[12px]"
          style={{
            /* Liquid glass: brighter than the wallpaper, heavy blur, a specular rim. */
            background: dark ? 'rgba(110,115,135,0.34)' : 'rgba(250,250,252,0.5)',
            backdropFilter: 'blur(28px) saturate(180%)',
            WebkitBackdropFilter: 'blur(28px) saturate(180%)',
            boxShadow: dark
              ? '0 8px 32px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(255,255,255,0.16)'
              : '0 8px 32px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(255,255,255,0.55)',
            ...squircle,
          }}
        >
          <div className="flex gap-[10px]">
            <AppIcon
              name={appName}
              size={38}
              radius={12}
              shape={squircle}
              className="self-center"
            />
            <div className="min-w-0 flex-1 self-center">
              <div
                className="truncate text-[15px] leading-[17px] font-semibold tracking-[-0.23px]"
                style={{ color: primary }}
              >
                {title}
              </div>
              <div
                className="line-clamp-4 text-[15px] leading-[18px] tracking-[-0.23px]"
                style={{ color: primary }}
              >
                {body}
              </div>
            </div>
            <span
              className="shrink-0 self-start text-[15px] leading-[17px]"
              style={{ color: secondary }}
            >
              now
            </span>
          </div>
        </div>
        {/* Flashlight / camera (50pt), and the home indicator. */}
        <div className="mt-[24px] mb-[12px] flex shrink-0 items-center justify-between px-[52px]">
          {[Flashlight, Camera].map((Icon, index) => (
            <span
              key={index}
              className="flex size-[50px] items-center justify-center rounded-full backdrop-blur-md"
              style={{ background: 'rgba(20,20,24,0.34)', color: 'rgba(255,255,255,0.92)' }}
            >
              <Icon size={22} strokeWidth={2} aria-hidden />
            </span>
          ))}
        </div>
        <div
          className="mx-auto mb-[9px] h-[5px] w-[148px] shrink-0 rounded-full"
          style={{ background: 'rgba(255,255,255,0.9)' }}
        />
      </div>
    </Device>
  );
}

function AndroidDevice({
  appName,
  title,
  body,
  dark,
}: Omit<PushPreviewProps, 'zoom' | 'scheme'> & { dark: boolean }) {
  const face: CSSProperties = { fontFamily: "Roboto, 'Google Sans', system-ui, sans-serif" };
  const primary = dark ? 'rgba(255,255,255,0.95)' : 'rgba(27,27,31,0.95)';
  const secondary = dark ? 'rgba(255,255,255,0.65)' : 'rgba(68,71,78,0.8)';
  /* Material You: the clock picks up the wallpaper's tone, dark on light. */
  const clockColor = dark ? 'rgba(255,255,255,0.95)' : 'rgba(28,44,40,0.9)';
  return (
    <Device
      label="Android"
      dark={dark}
      geometry={PIXEL}
      underlay={pixelBackUrl}
      overlay={pixelMaskUrl}
      overlayPlacement="screen"
      wallpaper={
        dark
          ? 'linear-gradient(170deg,#1d2b33 0%,#262040 58%,#0f1317 100%)'
          : 'linear-gradient(170deg,#b6d2c8 0%,#a3c2b4 55%,#ddd3c0 100%)'
      }
    >
      <div className="flex min-h-0 flex-1 flex-col" style={face}>
        {/* Lock-screen clock: date over the clock, per the kit's templates. */}
        <div className="mt-[88px] shrink-0 text-center" style={{ color: clockColor }}>
          <div className="text-[16px] leading-[22px] font-medium">Mon, Jun 9</div>
          <div className="text-[64px] leading-[1.1] font-normal">{CLOCK}</div>
        </div>
        {/*
          Lock-screen notification, to Google's Android UI Kit: a full-width
          card with 12dp margins, a leading 40dp app icon, a bold 14sp title
          with the "• now" inline, a 14sp content line, then the circled
          expander. App name never appears — the icon is the identity,
          exactly as on the real lock screen.
        */}
        <div
          className="mx-[12px] mt-[28px] shrink-0 rounded-[16px] p-[12px] backdrop-blur-md"
          style={{
            /* A step lighter than the wallpaper's darkest stop, so the card reads at night. */
            background: dark ? 'rgba(64,68,76,0.78)' : 'rgba(255,255,255,0.92)',
            boxShadow: dark
              ? '0 4px 16px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.08)'
              : '0 4px 16px rgba(0,0,0,0.12)',
          }}
        >
          <div className="flex items-center gap-[12px]">
            <AppIcon name={appName} size={40} radius={12} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-[6px]">
                <span
                  className="min-w-0 truncate text-[14px] leading-[20px] font-bold"
                  style={{ color: primary }}
                >
                  {title}
                </span>
                <span className="shrink-0 text-[14px] leading-[20px]" style={{ color: secondary }}>
                  • now
                </span>
              </div>
              <div className="line-clamp-2 text-[14px] leading-[20px]" style={{ color: primary }}>
                {body}
              </div>
            </div>
            <span
              className="flex size-[28px] shrink-0 items-center justify-center rounded-full"
              style={{
                background: dark ? 'rgba(255,255,255,0.12)' : 'rgba(27,27,31,0.08)',
                color: secondary,
              }}
            >
              <ChevronDown size={16} strokeWidth={2.5} aria-hidden />
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1" />
        {/* The lock glyph above the gesture area. */}
        <div
          className="mb-[18px] flex shrink-0 justify-center"
          style={{ color: dark ? 'rgba(255,255,255,0.85)' : 'rgba(28,44,40,0.8)' }}
        >
          <Lock size={18} strokeWidth={2.5} aria-hidden />
        </div>
      </div>
    </Device>
  );
}

export function PushPreview({ appName, title, body, scheme, zoom }: PushPreviewProps) {
  const dark = scheme === 'dark';
  return (
    <div
      className="flex flex-wrap items-start justify-center gap-12 pt-2"
      style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
    >
      <IosDevice appName={appName} title={title} body={body} dark={dark} />
      <AndroidDevice appName={appName} title={title} body={body} dark={dark} />
    </div>
  );
}
