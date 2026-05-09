"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SearchInputProps extends Omit<
  React.ComponentProps<"input">,
  "onChange" | "value"
> {
  value: string;
  onChange: (value: string) => void;
  containerClassName?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onChange, className, containerClassName, placeholder, ...props },
    ref,
  ) {
    return (
      <div className={cn("relative", containerClassName)}>
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 z-10 h-4 w-4 -translate-y-1/2" />
        <Input
          ref={ref}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn("pl-9", className)}
          {...props}
        />
      </div>
    );
  },
);
