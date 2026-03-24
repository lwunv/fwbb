"use client";

import Link from "next/link";
import { CircleDot } from "lucide-react";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <CircleDot className="h-6 w-6 text-primary" />
          <span className="font-bold text-lg">FWBB</span>
        </Link>
        <div className="flex items-center gap-2">
          {/* Theme toggle and language selector placeholders */}
        </div>
      </div>
    </header>
  );
}
