import { z } from "zod";
import { paginationQuerySchema } from "../../utils/pagination.js";

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
});

export const customerParamsSchema = z.object({
  id: z.uuid("Cliente inválido."),
});

export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type CustomerParams = z.infer<typeof customerParamsSchema>;
