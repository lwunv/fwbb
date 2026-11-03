"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Handshake, LogOut } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Màn của tài khoản giao lưu (đăng ký để đi giao lưu, chưa vào nhóm) khi mở
 * trang của nhóm. Chỉ chỉ đường về vùng giao lưu và cho đăng xuất; không lộ
 * dữ liệu nhóm. Nút xin vào nhóm do Task 11 thêm.
 */
export function ExchangeAccountNotice({ memberName }: { memberName: string }) {
  const t = useTranslations("exchangeNotice");
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="w-full max-w-md"
    >
      <Card className="bg-card/80 backdrop-blur">
        <CardContent className="space-y-5 p-6 text-center">
          <div className="bg-primary/10 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <Handshake className="text-primary h-6 w-6" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-bold">
              {t("title", { name: memberName })}
            </h1>
            <p className="text-muted-foreground text-base">{t("body")}</p>
          </div>
          <Button
            className="min-h-11 w-full text-base"
            render={<Link href="/giao-luu" />}
          >
            {t("goExchange")}
          </Button>
          {/* Form POST thay vì server action: chạy cả khi JS chưa tải xong,
              route tự xoá cookie rồi đưa về trang chủ. */}
          <form action="/api/reset-identity" method="POST">
            <button
              type="submit"
              className="text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center justify-center gap-2 px-3 text-base"
            >
              <LogOut className="h-5 w-5" />
              {t("logout")}
            </button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
