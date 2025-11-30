import { startServer, RedisCache } from "./services";
import dotenv from "dotenv";
import { LeaderElector } from "./services/leader-lock";

dotenv.config();

(async () => {
  await startServer();
  // Initialize Certificate Manager. You can swap out AwsCertificateManager for another implementation if needed.
  await RedisCache.init();
  process.on("SIGTERM", async () => {
    try {
      await LeaderElector.get().shutdown();
    } catch {}
    process.exit(0);
  });
})();
