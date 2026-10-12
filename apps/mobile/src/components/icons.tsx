/**
 * MoneyMart mobile — iconography (§2.5).
 * The custom gavel set plus UI glyphs, drawn with react-native-svg so they scale
 * crisply and inherit the brand palette.
 */
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

export interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

function base({ size = 20, color = '#F4F7FA', strokeWidth = 1.8 }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
}

export function GavelIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M13.4 3.6l7 7-2.3 2.3-7-7z" />
      <Path d="M11.1 5.9L5.3 11.7a1.6 1.6 0 000 2.3l2.6 2.6a1.6 1.6 0 002.3 0l5.8-5.8" />
      <Path d="M4 21h9" />
      <Path d="M8.5 17.5L6 20" />
    </Svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M3.5 10.6L12 3.6l8.5 7v9a1.4 1.4 0 01-1.4 1.4H4.9a1.4 1.4 0 01-1.4-1.4z" />
      <Path d="M9.4 21v-6.4h5.2V21" />
    </Svg>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Circle cx="12" cy="12" r="8.6" />
      <Path d="M15.4 8.6l-2 4.8-4.8 2 2-4.8z" />
    </Svg>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M3.8 9.4L5.4 4.6h13.2l1.6 4.8" />
      <Path d="M4.6 9.4v10a1 1 0 001 1h12.8a1 1 0 001-1v-10" />
      <Path d="M9.6 20.4v-5h4.8v5" />
    </Svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Circle cx="12" cy="8.4" r="3.8" />
      <Path d="M4.6 20.4c0-3.7 3.3-6.2 7.4-6.2s7.4 2.5 7.4 6.2" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Circle cx="11" cy="11" r="6.6" />
      <Path d="M16 16l4.4 4.4" />
    </Svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M18 15.4V10a6 6 0 10-12 0v5.4L4.4 18h15.2z" />
      <Path d="M10 20.6a2.2 2.2 0 004 0" />
    </Svg>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Rect x="3" y="6.4" width="18" height="12" rx="2.4" />
      <Path d="M3 10.4h18" />
      <Circle cx="16.6" cy="14.6" r="1.1" fill={props.color ?? '#F4F7FA'} stroke="none" />
    </Svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...base(props)} fill={props.color ?? '#0D1B2A'} stroke="none">
      <Path d="M7.6 5.2l11 6.8-11 6.8z" fill={props.color ?? '#0D1B2A'} />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M4.6 12.6l4.8 4.8L19.4 7" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M9.4 5.6l6.4 6.4-6.4 6.4" />
    </Svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M12 3.4l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9z" />
    </Svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M12 3.4l7 2.6v5.4c0 4.3-2.9 7.9-7 9.2-4.1-1.3-7-4.9-7-9.2V6z" />
      <Path d="M9 12.2l2.2 2.2 4-4.4" />
    </Svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Circle cx="9.4" cy="8.6" r="3.2" />
      <Path d="M3.4 19.6c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2" />
      <Path d="M16 6.2a3 3 0 010 5.6M17.6 19.6c0-2.2-.7-3.9-1.9-5" />
    </Svg>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M3.6 16.6l5.2-5.2 3.4 3.4 6.4-6.4" />
      <Path d="M14.4 8.4h4.2v4.2" />
    </Svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Circle cx="12" cy="12" r="8.6" />
      <Path d="M3.6 12h16.8" />
      <Path d="M12 3.4c2.4 2.4 3.6 5.4 3.6 8.6s-1.2 6.2-3.6 8.6c-2.4-2.4-3.6-5.4-3.6-8.6S9.6 5.8 12 3.4z" />
    </Svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M4.4 19.6V4.4" />
      <Path d="M4.4 19.6H20" />
      <Path d="M8 16.4v-4M12 16.4V8.4M16 16.4v-6.6" />
    </Svg>
  );
}

export function HeartIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...base(props)}>
      <Path
        d="M12 20s-7.4-4.4-7.4-9.4A4.3 4.3 0 0112 7.8a4.3 4.3 0 017.4 2.8c0 5-7.4 9.4-7.4 9.4z"
        fill={filled ? (props.color ?? '#F5A623') : 'none'}
      />
    </Svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M3.4 8.6h3.2l1.4-2.2h8l1.4 2.2h3.2v9.4H3.4z" />
      <Circle cx="12" cy="13" r="3.1" />
    </Svg>
  );
}

/** MoneyMart monogram — MM with the gavel crossbar and the green pulse line. */
export function MoneyMartMark({ size = 40 }: { size?: number }) {
  const height = size * 1.1;
  return (
    <Svg width={size} height={height} viewBox="0 0 44 48" fill="none">
      <Path d="M2 30V12l9 10 9-10v18" stroke="#F5A623" strokeWidth={4.4} strokeLinecap="square" fill="none" />
      <Path d="M22 30V12l9 10 9-10v18" stroke="#F5A623" strokeWidth={4.4} strokeLinecap="square" fill="none" />
      <Path d="M31 20.4h9.6" stroke="#00D4A1" strokeWidth={3} strokeLinecap="round" />
      <Path
        d="M2 39h8l3-5 3.4 10L20 39h6l2.4-3.4L31 39h11"
        stroke="#00D4A1"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Animated-ready pulsing live dot. */
export function LiveDot({ size = 8, color = '#00D4A1' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Circle cx="5" cy="5" r="5" fill={color} />
    </Svg>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Rect x="2.6" y="7" width="11.4" height="9" rx="1.4" />
      <Path d="M14 10h3.6l3.4 3.4V16H14z" />
      <Circle cx="7" cy="18" r="1.8" />
      <Circle cx="17.4" cy="18" r="1.8" />
    </Svg>
  );
}

export function MiniGavelIcon(props: IconProps) {
  return (
    <Svg {...base(props)}>
      <Path d="M12.8 4.2l6 6-1.9 1.9-6-6z" />
      <Path d="M10.9 6.1L6 11a1.4 1.4 0 000 2l2.1 2.1a1.4 1.4 0 002 0l4.9-4.9" />
      <Path d="M5 20h8" />
    </Svg>
  );
}
