import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import proxyRouter from "./routes/proxy";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);
app.use("/v1", proxyRouter);

// 全局 JSON 错误处理器：确保所有错误以 JSON 格式返回
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? err.statusCode ?? 500;
  const message = err.message ?? "Internal Server Error";
  logger.error({ err, url: req.url, method: req.method }, "Unhandled error");
  res.status(status).json({
    error: {
      message,
      type: "server_error",
      code: String(status),
    },
  });
});

export default app;
