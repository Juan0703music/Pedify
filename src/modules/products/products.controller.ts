import type { Request, Response } from "express";
import { getTenant } from "../../middlewares/authorize.js";
import { categoriesService } from "./categories.service.js";
import { productsService } from "./products.service.js";
import type {
  CategoryInput,
  CategoryParams,
  CreateProductInput,
  ListProductsQuery,
  ProductParams,
  ReorderCategoriesInput,
  ReorderProductsInput,
  UpdateProductInput,
} from "./products.schemas.js";

export const productsController = {
  async list(req: Request, res: Response) {
    const { status } = req.query as unknown as ListProductsQuery;
    res.json({ data: await productsService.list(getTenant(req), status) });
  },

  async summary(req: Request, res: Response) {
    res.json({ data: await productsService.summary(getTenant(req)) });
  },

  async get(req: Request, res: Response) {
    const { id } = req.params as ProductParams;
    res.json({ data: await productsService.get(getTenant(req), id) });
  },

  async create(req: Request, res: Response) {
    res.status(201).json({ data: await productsService.create(getTenant(req), req.body as CreateProductInput) });
  },

  async update(req: Request, res: Response) {
    const { id } = req.params as ProductParams;
    res.json({ data: await productsService.update(getTenant(req), id, req.body as UpdateProductInput) });
  },

  async remove(req: Request, res: Response) {
    const { id } = req.params as ProductParams;
    res.json({ data: await productsService.remove(getTenant(req), id) });
  },

  async restore(req: Request, res: Response) {
    const { id } = req.params as ProductParams;
    res.json({ data: await productsService.restore(getTenant(req), id) });
  },

  async reorder(req: Request, res: Response) {
    await productsService.reorder(getTenant(req), req.body as ReorderProductsInput);
    res.status(204).end();
  },

  async setImage(req: Request, res: Response) {
    const { id } = req.params as ProductParams;
    res.json({ data: await productsService.setImage(getTenant(req), id, req.body as Buffer) });
  },

  async removeImage(req: Request, res: Response) {
    const { id } = req.params as ProductParams;
    res.json({ data: await productsService.removeImage(getTenant(req), id) });
  },
};

export const categoriesController = {
  async list(req: Request, res: Response) {
    res.json({ data: await categoriesService.list(getTenant(req)) });
  },

  async create(req: Request, res: Response) {
    const { name } = req.body as CategoryInput;
    res.status(201).json({ data: await categoriesService.create(getTenant(req), name) });
  },

  async rename(req: Request, res: Response) {
    const { id } = req.params as CategoryParams;
    const { name } = req.body as CategoryInput;
    res.json({ data: await categoriesService.rename(getTenant(req), id, name) });
  },

  async remove(req: Request, res: Response) {
    const { id } = req.params as CategoryParams;
    res.json({ data: await categoriesService.remove(getTenant(req), id) });
  },

  async reorder(req: Request, res: Response) {
    const { categoryIds } = req.body as ReorderCategoriesInput;
    await categoriesService.reorder(getTenant(req), categoryIds);
    res.status(204).end();
  },
};
