// src/components/ui/badge.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
  {
    variants: {
      variant: {
        neutral: 'bg-gray-100 text-ink-soft dark:bg-gray-800 dark:text-gray-300',
        brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400',
        info: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
        success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
        warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
        danger: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
      },
    },
    defaultVariants: { variant: 'neutral' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
