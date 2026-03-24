"use client";

const AVATARS = [
  // Animals
  "🐱", "🐶", "🐰", "🦊", "🐻", "🐼", "🐨", "🦁", "🐯", "🐸",
  "🐧", "🐦", "🦋", "🐝", "🐞", "🦄", "🐬", "🐳", "🦈", "🐙",
  "🦉", "🐿️", "🦩", "🦜", "🐹",
  // Flowers & Plants
  "🌸", "🌺", "🌻", "🌷", "🌹", "🍀", "🌿", "🌴", "🌵", "🎋",
  "🍁", "🌾", "🪻", "💐", "🌼",
  // Vehicles & Objects
  "🚗", "🚕", "🏎️", "🚀", "🛸", "⛵", "🎈", "🎪", "🎠", "🎡",
];

const COLORS = [
  ["#FFE0E6", "#D63864"], // pink
  ["#E0F0FF", "#2563EB"], // blue
  ["#E6FFE0", "#16A34A"], // green
  ["#FFF3E0", "#EA580C"], // orange
  ["#F3E8FF", "#9333EA"], // purple
  ["#FEF9C3", "#CA8A04"], // yellow
  ["#E0FFFE", "#0891B2"], // cyan
  ["#FFE4E6", "#E11D48"], // rose
  ["#ECFDF5", "#059669"], // emerald
  ["#FDF4FF", "#C026D3"], // fuchsia
];

function getAvatarForId(id: number) {
  const emoji = AVATARS[id % AVATARS.length];
  const color = COLORS[id % COLORS.length];
  return { emoji, bg: color[0], border: color[1] };
}

interface MemberAvatarProps {
  memberId: number;
  size?: number;
  className?: string;
}

export function MemberAvatar({ memberId, size = 40, className = "" }: MemberAvatarProps) {
  const { emoji, bg, border } = getAvatarForId(memberId);
  const fontSize = size * 0.5;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label="Avatar"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={size / 2 - 1}
        fill={bg}
        stroke={border}
        strokeWidth="1.5"
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={fontSize}
      >
        {emoji}
      </text>
    </svg>
  );
}

export function getMemberAvatarSvgString(memberId: number, size = 40): string {
  const { emoji, bg, border } = getAvatarForId(memberId);
  const fontSize = size * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${bg}" stroke="${border}" stroke-width="1.5"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}">${emoji}</text></svg>`;
}
