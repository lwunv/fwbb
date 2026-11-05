"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Handshake } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

function LinkCard() {
  const t = useTranslations("exchange.mine");
  return (
    <Link href="/giao-luu/cua-toi" className="block">
      <Card className="bg-card/80 hover:bg-muted/60 backdrop-blur transition-colors">
        <CardContent className="flex min-h-14 items-center gap-3 p-4">
          <Handshake className="text-primary h-6 w-6 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold">{t("meLinkTitle")}</div>
            <p className="text-muted-foreground text-base">{t("meLinkBody")}</p>
          </div>
          <ChevronRight
            className="text-muted-foreground h-5 w-5 shrink-0"
            aria-hidden
          />
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * Lối vào khu Giao lưu từ trang cá nhân. `enabled` là cờ giao lưu do server
 * đọc một lần; tắt thì không render gì (trang /me y như trước G2).
 */
export function MeExchangeLink({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <LinkCard />;
}
