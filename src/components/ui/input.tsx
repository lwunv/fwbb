import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  function Input({ className, type, ...props }, ref) {
    return (
      <InputPrimitive
        ref={ref}
        type={type}
        data-slot="input"
        className={cn(
          // bg-card (trắng đục mọi theme) thay vì bg-transparent — tránh ăn theo
          // page bg pink/dark khiến text mờ. Border-input + shadow-sm để contrast
          // rõ trên nền nhạt; placeholder dùng muted-foreground.
          "border-input bg-card text-foreground file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/40 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 h-[42px] w-full min-w-0 rounded-xl border px-4 py-2 text-base shadow-sm transition-colors outline-none file:inline-flex file:h-8 file:border-0 file:bg-transparent file:text-base file:font-medium focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3",
          className,
        )}
        {...props}
      />
    );
  },
);

export { Input };
