import type { DbClient } from "../../config/database.js";
import type { TenantContext } from "../../types/common.js";
import { notFound } from "../../utils/errors.js";
import { buildPage } from "../../utils/pagination.js";
import { customersRepository } from "./customers.repository.js";
import type { ListCustomersQuery } from "./customers.schemas.js";

const ACCEPTED = new Set(["CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"]);

export const customersService = {
  async list(tenant: TenantContext, query: ListCustomersQuery) {
    const { items, total } = await customersRepository.list(tenant.businessId, {
      search: query.search,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return buildPage(items, total, query);
  },

  async erase(tenant: TenantContext, id: string) {
    if (!(await customersRepository.erase(id, tenant.businessId))) throw notFound("No encontramos ese cliente.", "CUSTOMER_NOT_FOUND");
  },

  /** Información del cliente, sus direcciones y su historial de pedidos (sección 6). */
  async get(tenant: TenantContext, id: string) {
    const customer = await customersRepository.findDetail(id, tenant.businessId);
    if (!customer) throw notFound("No encontramos ese cliente.", "CUSTOMER_NOT_FOUND");
    const accepted = customer.orders.filter((order) => ACCEPTED.has(order.status));
    return {
      ...customer,
      stats: {
        orders: customer.orders.filter((order) => order.status !== "CANCELLED").length,
        cancelled: customer.orders.filter((order) => order.status === "CANCELLED").length,
        spent: accepted.reduce((sum, order) => sum + order.total, 0),
        lastOrderAt: customer.orders[0]?.createdAt ?? null,
      },
    };
  },

  /**
   * Registra (o actualiza) al cliente de un pedido y guarda su dirección de entrega
   * si es nueva. Se ejecuta dentro de la transacción del pedido.
   */
  async recordFromOrder(
    data: { businessId: string; name: string; phone: string; address: string | null; references: string | null },
    db: DbClient,
  ): Promise<string> {
    const customer = await customersRepository.upsertByPhone({ businessId: data.businessId, phone: data.phone, name: data.name }, db);

    if (data.address) {
      const existing = await customersRepository.findAddress(customer.id, data.address, db);
      if (!existing) {
        await customersRepository.createAddress({ customerId: customer.id, address: data.address, references: data.references }, db);
      } else if (data.references && data.references !== existing.references) {
        await customersRepository.updateAddressReferences(existing.id, data.references, db);
      }
    }
    return customer.id;
  },
};
