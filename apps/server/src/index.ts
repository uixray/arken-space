import { startServer } from "./server-runtime.js";
import { installGracefulShutdown } from "./graceful-shutdown.js";

const app = await startServer();
installGracefulShutdown(() => app.close(), app.log);
