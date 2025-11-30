import {
  Ellipsies,
  COMMON_API_SERVICE_ROUTES, // /api/v2/
  DEFAULT_SERVICE_PORT,
} from "@similie/ellipsies";

import * as models from "../models";
import * as controllers from "../controllers";
import { AuthMiddleware } from "../middleware";

export const startServer = async () => {
  const routePrefix =
    process.env.API_SERVICE_ROUTES || COMMON_API_SERVICE_ROUTES;
  const servicePort = process.env.SERVICE_PORT
    ? parseInt(process.env.SERVICE_PORT, 10)
    : DEFAULT_SERVICE_PORT;

  const ellipsies = new Ellipsies({
    controllers,
    models,
    port: servicePort + 1,
    prefix: routePrefix,
    middleware: [AuthMiddleware],
    cors: true,
  });

  await ellipsies.setDataSource(
    {
      database: process.env.DB_DATABASE || "hyphen_api",
      username: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      host: process.env.DB_HOST || "localhost",
      port: process.env.DB_PORT ? +process.env.DB_PORT : 5432,
    },
    { synchronize: process.env.NODE_ENV !== "production" },
  );

  console.log(
    `🚀 CommandCenter API running on http://localhost:${servicePort}${routePrefix}`,
  );

  await ellipsies.start();
};
