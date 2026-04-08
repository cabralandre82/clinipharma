import Link from 'next/link'
import { type VariantProps } from 'class-variance-authority'
import { buttonVariants } from './button'
import { cn } from '@/lib/utils'

interface ButtonLinkProps extends VariantProps<typeof buttonVariants> {
  href: string
  className?: string
  children: React.ReactNode
  title?: string
}

export function ButtonLink({ href, variant, size, className, children, title }: ButtonLinkProps) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)} title={title}>
      {children}
    </Link>
  )
}
