import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { requireBusiness, requirePermission } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { customersController } from "./customers.controller.js";
import { customerParamsSchema, listCustomersQuerySchema } from "./customers.schemas.js";

// ─── /api/v1/customers — datos personales y compras de los clientes ───
// Consultar: el propietario y los empleados con permiso. Borrar los datos: solo el propietario.
export const customersRoutes = Router();
customersRoutes.use(authenticate);

const canView = [requireBusiness(), requirePermission("viewCustomers")];
customersRoutes.get("/", ...canView, validate({ query: listCustomersQuerySchema }), customersController.list);
customersRoutes.get("/:id", ...canView, validate({ params: customerParamsSchema }), customersController.get);
// Supresión de los datos personales del cliente (derecho de habeas data).
customersRoutes.delete("/:id", requireBusiness("OWNER"), validate({ params: customerParamsSchema }), customersController.erase);
