import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate.js";
import { loginLimiter, passwordResetLimiter, registerLimiter } from "../../middlewares/rateLimiter.js";
import { validate } from "../../middlewares/validate.js";
import { authController } from "./auth.controller.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  registerSchema,
  switchBusinessSchema,
  updateProfileSchema,
} from "./auth.schemas.js";

export const authRoutes = Router();

authRoutes.post("/register", registerLimiter, validate({ body: registerSchema }), authController.register);
authRoutes.post("/login", loginLimiter, validate({ body: loginSchema }), authController.login);
// Recuperación de contraseña (sin sesión).
authRoutes.post("/forgot-password", passwordResetLimiter, validate({ body: forgotPasswordSchema }), authController.forgotPassword);
authRoutes.post("/reset-password", passwordResetLimiter, validate({ body: resetPasswordSchema }), authController.resetPassword);

authRoutes.use(authenticate);

authRoutes.get("/me", authController.me);
authRoutes.patch("/me", validate({ body: updateProfileSchema }), authController.updateProfile);
authRoutes.post("/switch-business", validate({ body: switchBusinessSchema }), authController.switchBusiness);
authRoutes.patch("/password", validate({ body: changePasswordSchema }), authController.changePassword);
authRoutes.post("/logout", authController.logout);
authRoutes.post("/logout-all", authController.logoutAll);
