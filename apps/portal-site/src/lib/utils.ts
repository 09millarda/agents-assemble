import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function mergeClassNames(...parts: Array<string | false | null | undefined>): string {
  return cn(...parts);
}
