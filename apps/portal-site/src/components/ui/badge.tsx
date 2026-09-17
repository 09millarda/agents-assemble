import type { HTMLAttributes } from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        success: "border-transparent bg-[#d8f2e6] text-[#17603a]",
        warning: "border-transparent bg-[#fff0cf] text-[#8c5412]",
        destructive: "border-transparent bg-[#fde1e1] text-[#a32929]",
        outline: "border-border bg-card text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
