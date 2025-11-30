import jwt from "jsonwebtoken";
import { type ExpressResponse } from "@similie/ellipsies";

export const signToken = (payload: object, expiresIn: string = "1h") => {
  const JWT_SECRET = process.env.JWT_CLIENT_SECRET || "your_jwt_secret";
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
};

export const verifyToken = (token: string) => {
  try {
    const JWT_SECRET = process.env.JWT_CLIENT_SECRET || "your_jwt_secret";
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

export const decodeToken = (token: string) => {
  return jwt.decode(token);
};

export const verifyTokenValidity = (
  req: {
    headers: { authentication?: string };
    user?: any;
  },
  res: ExpressResponse,
) => {
  const token = req.headers.authentication?.split(" ")[1];
  if (!token) return false;
  const decoded = verifyToken(token);
  if (!decoded) return false;
  const { exp } = decoded as { exp?: number };
  if (!exp) return false;
  const valid = Date.now() < exp * 1000;
  if (valid) {
    res.locals.user = decoded;
    req.user = decoded && decoded.user ? decoded.user : undefined;
  }

  return valid;
};
