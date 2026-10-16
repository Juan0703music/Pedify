import { z } from "zod";
import type { Paginated } from "../types/common.js";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Convierte página y tamaño en `skip`/`take` para Prisma. */
export function toPrismaPage({ page, pageSize }: PaginationQuery) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPage<T>(items: T[], total: number, { page, pageSize }: PaginationQuery): Paginated<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
