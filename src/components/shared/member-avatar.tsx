"use client";

import Image from "next/image";
import { getBrandPreset } from "@/lib/member-avatar-presets";
import {
  getEmojiAvatarByIndex,
  getEmojiAvatarForMemberId,
  parseEmojiAvatarKey,
} from "@/lib/member-avatar-emoji";

interface MemberAvatarProps {
  memberId: number;
  /** Brand key, `emoji:n`, hoặc null/undefined → emoji theo memberId */
  avatarKey?: string | null;
  /** URL ảnh đại diện từ Facebook — ưu tiên hiển thị khi có */
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export function MemberAvatar({
  memberId,
  avatarKey,
  avatarUrl,
  size = 40,
  className = "",
}: MemberAvatarProps) {
  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt="Avatar"
        width={size}
        height={size}
        unoptimized
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
      />
    );
  }

  const preset = avatarKey ? getBrandPreset(avatarKey) : null;
  if (preset) {
    const mono = preset.monogram;
    const fontSize = size * (mono.length > 1 ? 0.26 : 0.42);
    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={className}
        role="img"
        aria-label={preset.label}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={size / 2 - 1}
          fill={preset.bg}
          stroke={preset.border}
          strokeWidth="1.5"
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fill={preset.fg}
          fontSize={fontSize}
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          {mono}
        </text>
      </svg>
    );
  }

  const emojiIdx = avatarKey ? parseEmojiAvatarKey(avatarKey) : null;
  const { emoji, bg, border } =
    emojiIdx !== null
      ? getEmojiAvatarByIndex(emojiIdx)
      : getEmojiAvatarForMemberId(memberId);
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

export function getMemberAvatarSvgString(
  memberId: number,
  size = 40,
  avatarKey?: string | null,
): string {
  const preset = avatarKey ? getBrandPreset(avatarKey) : null;
  if (preset) {
    const mono = preset.monogram;
    const fontSize = size * (mono.length > 1 ? 0.26 : 0.42);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${preset.bg}" stroke="${preset.border}" stroke-width="1.5"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" fill="${preset.fg}" font-size="${fontSize}" font-weight="700" font-family="system-ui,sans-serif">${mono}</text></svg>`;
  }
  const emojiIdx = avatarKey ? parseEmojiAvatarKey(avatarKey) : null;
  const { emoji, bg, border } =
    emojiIdx !== null
      ? getEmojiAvatarByIndex(emojiIdx)
      : getEmojiAvatarForMemberId(memberId);
  const fontSize = size * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${bg}" stroke="${border}" stroke-width="1.5"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}">${emoji}</text></svg>`;
}
