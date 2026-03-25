"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export type LocaleFlagCountry = "vn" | "gb" | "cn";

interface LocaleFlagProps {
  country: LocaleFlagCountry;
  className?: string;
  title?: string;
}

/** Cờ vector nhỏ — tránh emoji khu vực (VN/US/CN chữ) trên Windows */
export function LocaleFlag({ country, className, title }: LocaleFlagProps) {
  /** `useId()` có thể chứa `:` — không hợp lệ làm id SVG → clipPath GB không áp dụng */
  const gbClipId = `locale-flag-gb-${useId().replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const common = cn("block shrink-0 overflow-hidden rounded-[3px] shadow-sm", className);

  switch (country) {
    case "vn":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 30 20"
          className={common}
          aria-hidden={title ? undefined : true}
          role={title ? "img" : undefined}
        >
          {title ? <title>{title}</title> : null}
          <rect width="30" height="20" fill="#da251d" />
          <path
            fill="#ff0"
            d="m15 3.2 1.64 5.06h5.32l-4.3 3.13 1.64 5.06L15 13.4l-4.3 3.13 1.64-5.06-4.3-3.13h5.32z"
          />
        </svg>
      );
    case "gb":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 60 30"
          className={common}
          aria-hidden={title ? undefined : true}
          role={title ? "img" : undefined}
        >
          {title ? <title>{title}</title> : null}
          <clipPath id={gbClipId}>
            <rect width="60" height="30" />
          </clipPath>
          <g clipPath={`url(#${gbClipId})`}>
            <path fill="#012169" d="M0 0h60v30H0z" />
            <path stroke="#fff" strokeWidth="6" d="M0 0l60 30M60 0L0 30" />
            <path stroke="#c8102e" strokeWidth="4" d="M0 0l60 30M60 0L0 30" />
            <path stroke="#fff" strokeWidth="10" d="M30 0v30M0 15h60" />
            <path stroke="#c8102e" strokeWidth="6" d="M30 0v30M0 15h60" />
          </g>
        </svg>
      );
    case "cn":
      return (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 30 20"
          className={common}
          aria-hidden={title ? undefined : true}
          role={title ? "img" : undefined}
        >
          {title ? <title>{title}</title> : null}
          <rect width="30" height="20" fill="#de2910" />
          {/* 1 sao lớn + 4 sao nhỏ (bố cục gần đúng) */}
          <path
            fill="#ffde00"
            d="m5 5-.62 1.9 1.84.02-1.51 1.07.59 1.91L5 9l-1.3.99.59-1.91-1.51-1.07 1.84-.02z"
          />
          <path
            fill="#ffde00"
            d="m10.2 2.1.32.97 1.02 0-.81.63.31.98-.82-.61-.82.61.31-.98-.81-.63 1.02 0z"
          />
          <path
            fill="#ffde00"
            d="m12.1 4.1.32.97 1.02 0-.81.63.31.98-.82-.61-.82.61.31-.98-.81-.63 1.02 0z"
          />
          <path
            fill="#ffde00"
            d="m12.1 7.4.32.97 1.02 0-.81.63.31.98-.82-.61-.82.61.31-.98-.81-.63 1.02 0z"
          />
          <path
            fill="#ffde00"
            d="m10.2 9.4.32.97 1.02 0-.81.63.31.98-.82-.61-.82.61.31-.98-.81-.63 1.02 0z"
          />
        </svg>
      );
    default:
      return null;
  }
}
