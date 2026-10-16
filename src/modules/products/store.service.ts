import { clock } from "../../utils/clock.js";
import { notFound } from "../../utils/errors.js";
import { businessesRepository } from "../businesses/businesses.repository.js";
import { getOpeningStatus, parseOpeningHours } from "../businesses/opening-hours.js";
import { subscriptionsService } from "../subscriptions/subscriptions.service.js";
import { categoriesRepository } from "./categories.repository.js";
import { productsRepository } from "./products.repository.js";

const storeNotFound = () => notFound("Esta tienda no existe o ya no está disponible.", "STORE_NOT_FOUND");

/**
 * Tienda pública (sección 8 del documento): datos del negocio, horario y estado de atención,
 * y el catálogo agrupado por categorías. Solo incluye datos pensados para ser públicos.
 */
export const storeService = {
  /** Negocio activo para la página /tienda/:slug (etiquetas para compartir el enlace). */
  async findForPage(slug: string) {
    const business = await businessesRepository.findStoreBySlug(slug);
    return business?.status === "ACTIVE" ? business : null;
  },

  async getStore(slug: string, now = clock.now()) {
    const business = await businessesRepository.findStoreBySlug(slug);
    if (!business || business.status !== "ACTIVE" || !business.settings) throw storeNotFound();

    const [categories, products, subscription] = await Promise.all([
      categoriesRepository.listNames(business.id),
      productsRepository.listForStore(business.id),
      subscriptionsService.current(business.id),
    ]);
    // Si la suscripción venció, la tienda se sigue viendo pero no recibe pedidos en línea.
    const onlineOrdering = subscription.state.canReceiveOrders;

    const toItem = ({ categoryId: _categoryId, ...product }: (typeof products)[number]) => product;
    const sections: { id: string | null; name: string; products: ReturnType<typeof toItem>[] }[] = categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        products: products.filter((product) => product.categoryId === category.id).map(toItem),
      }))
      .filter((section) => section.products.length > 0);

    const uncategorized = products.filter((product) => product.categoryId === null).map(toItem);
    if (uncategorized.length > 0) {
      sections.push({ id: null, name: sections.length > 0 ? "Otros productos" : "Menú", products: uncategorized });
    }

    const { settings } = business;
    const openingHours = parseOpeningHours(settings.openingHours);
    const opening = getOpeningStatus(openingHours, settings.timezone, now);

    return {
      business: {
        name: business.name,
        slug: business.slug,
        description: business.description,
        city: business.city,
        address: business.address,
        phone: business.phone,
        logoUrl: business.logoUrl,
        bannerUrl: business.bannerUrl,
      },
      settings: {
        openingHours,
        timezone: settings.timezone,
        whatsappPhone: settings.whatsappPhone,
        deliveryEnabled: settings.deliveryEnabled,
        deliveryFee: settings.deliveryFee,
        deliveryArea: settings.deliveryArea,
        pickupEnabled: settings.pickupEnabled,
        minimumOrder: settings.minimumOrder,
        paymentMethods: settings.paymentMethods,
      },
      status: {
        ...opening,
        acceptingOrders: settings.acceptingOrders,
        onlineOrdering,
        /** Se puede pedir: abierto según el horario, sin pausa manual y con la tienda en línea habilitada. */
        canOrder: opening.isOpen && settings.acceptingOrders && onlineOrdering,
      },
      categories: sections,
    };
  },
};
