"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link2, Check } from "lucide-react";

interface CopyLinkButtonProps {
  sessionId: number;
}

export function CopyLinkButton({ sessionId }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const t = useTranslations("sessions");

  async function handleCopy() {
    const url = `${window.location.origin}/vote/${sessionId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that don't support clipboard API
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <Button
      variant="default"
      size="default"
      onClick={handleCopy}
      className="gap-1.5 font-semibold shadow-sm hover:shadow-md"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" />
          {t("linkCopied")}
        </>
      ) : (
        <>
          <Link2 className="h-4 w-4" />
          {t("copyLink")}
        </>
      )}
    </Button>
  );
}
