import type { Request, Response } from "express";
import { getAuth } from "../../middlewares/authenticate.js";
import { authService } from "./auth.service.js";
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SwitchBusinessInput,
  UpdateProfileInput,
} from "./auth.schemas.js";
import { clearSessionCookie, setSessionCookie } from "./session-cookie.js";

const clientMeta = (req: Request) => ({ userAgent: req.get("user-agent") });

export const authController = {
  async register(req: Request, res: Response) {
    const { auth, session } = await authService.register(req.body as RegisterInput, clientMeta(req));
    setSessionCookie(res, session.token, session.expiresAt);
    res.status(201).json({ data: await authService.getProfile(auth) });
  },

  async login(req: Request, res: Response) {
    const { auth, session } = await authService.login(req.body as LoginInput, clientMeta(req));
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ data: await authService.getProfile(auth) });
  },

  async me(req: Request, res: Response) {
    res.json({ data: await authService.getProfile(getAuth(req)) });
  },

  async updateProfile(req: Request, res: Response) {
    const user = await authService.updateProfile(getAuth(req), req.body as UpdateProfileInput);
    res.json({ data: { user } });
  },

  async switchBusiness(req: Request, res: Response) {
    const auth = getAuth(req);
    const { businessId } = req.body as SwitchBusinessInput;
    await authService.switchBusiness(auth, businessId);
    res.json({ data: await authService.getProfile({ ...auth, activeBusinessId: businessId }) });
  },

  async changePassword(req: Request, res: Response) {
    await authService.changePassword(getAuth(req), req.body as ChangePasswordInput);
    res.json({ data: { ok: true } });
  },

  async logout(req: Request, res: Response) {
    await authService.logout(getAuth(req));
    clearSessionCookie(res);
    res.status(204).end();
  },

  async logoutAll(req: Request, res: Response) {
    await authService.logoutAll(getAuth(req));
    clearSessionCookie(res);
    res.status(204).end();
  },

  /** Siempre la misma respuesta, exista o no la cuenta. */
  async forgotPassword(req: Request, res: Response) {
    await authService.forgotPassword(req.body as ForgotPasswordInput);
    res.json({ data: { ok: true } });
  },

  async resetPassword(req: Request, res: Response) {
    await authService.resetPassword(req.body as ResetPasswordInput);
    res.json({ data: { ok: true } });
  },
};
