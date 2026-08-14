import { Mail, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";

interface VoteContactInfoProps {
  /** Đã chuẩn hoá ở registry (bỏ dấu cách/chấm/gạch ngang) — dùng thẳng làm href `tel:`. */
  hotline: string;
  email: string;
}

/**
 * Khối liên hệ nhỏ ở cuối màn vote. Rỗng cả hai → không render gì (không
 * phải card rỗng, không phải "chưa cấu hình") — đây là trạng thái mặc định
 * hôm nay nên màn vote phải giống hệt lúc chưa có hai setting này.
 */
export async function VoteContactInfo({
  hotline,
  email,
}: VoteContactInfoProps) {
  if (!hotline && !email) return null;

  const t = await getTranslations("sessions");

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="text-muted-foreground text-sm font-medium">
          {t("contactTitle")}
        </div>
        <div className="flex flex-col gap-2">
          {hotline && (
            <a
              href={`tel:${hotline}`}
              aria-label={t("contactCallAria")}
              className="border-input bg-card text-foreground flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-base transition-colors active:scale-[0.98]"
            >
              <Phone className="text-primary h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{hotline}</span>
            </a>
          )}
          {email && (
            <a
              href={`mailto:${email}`}
              aria-label={t("contactEmailAria")}
              className="border-input bg-card text-foreground flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-base transition-colors active:scale-[0.98]"
            >
              <Mail className="text-primary h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{email}</span>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
