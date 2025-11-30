import {
  Middleware,
  UnauthorizedError,
  Service,
  ExpressRequest,
  ExpressResponse,
  ExpressNext,
} from "@similie/ellipsies";
import { verifyTokenValidity } from "src/services";
@Service()
@Middleware({ type: "before" })
export class AuthMiddleware {
  use(req: ExpressRequest, res: ExpressResponse, next: ExpressNext): any {
    const decodedUrl = verifyTokenValidity(req, res);
    if (!decodedUrl) {
      console.warn("🚫 Unauthorized access attempt:", req.method, req.url);
      throw new UnauthorizedError("Invalid or missing token");
    }
    console.log("✅ Authorized request:", decodedUrl, req.method, req.url);
    next();
  }
}
