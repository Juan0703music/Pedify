import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireBusiness } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { customersController } from "./customers.controller.js";
import { customerParamsSchema, listCustomersQuerySchema } from "./customers.schemas.js";

// ─── /api/v1/customers — solo el propietario (datos personales y compras de los clientes) ───
export const customersRoutes = Router();
customersRoutes.use(authenticate, requireBusiness("OWNER"));

customersRoutes.get("/", validate({ query: listCustomersQuerySchema }), customersController.list);
customersRoutes.get("/:id", validate({ params: customerParamsSchema }), customersController.get);
// Supresión de los datos personales del cliente (derecho de habeas data).
customersRoutes.delete("/:id", validate({ params: customerParamsSchema }), customersController.erase);
