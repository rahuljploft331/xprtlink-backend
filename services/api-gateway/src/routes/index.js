import { Router } from "express";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { createGatewayProxies } from "../proxy.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";


const router = Router();

router.get("/", (_req, res) => {
  return ResponseFormatter.success(res, {
    message: getMessage("xprtlinkApiGateway"),
    data: { service: "api-gateway", version: "v1" },
  });
});

export function mountGatewayProxies(app) {
  for (const proxy of createGatewayProxies()) {
    app.use(proxy);
  }
}

export default router;
