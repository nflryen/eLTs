import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex min-h-11 items-center justify-center gap-3 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "rounded-[14px] bg-[#09090b] text-white shadow-[var(--shadow-btn)] hover:bg-[#27272a]",
        secondary:
          "rounded-[10000px] border border-[#3f3f46] bg-white text-[#3f3f46] hover:bg-[#fafafa]",
        outline:
          "rounded-[14px] border border-[#ececee] bg-transparent text-[#18181b] hover:bg-[#fafafa]",
        ghost: "rounded-[14px] hover:bg-[#fafafa]",
        light: "rounded-[14px] bg-white text-[#18181b] hover:bg-[#f4f4f5]",
      },
      size: { default: "h-12 px-6", sm: "h-10 px-5", icon: "size-11" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
export { Button, buttonVariants };
