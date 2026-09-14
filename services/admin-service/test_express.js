import express from "express";
const app = express();
const router = express.Router();

router.patch("/:id", (req, res) => res.send("id"));
router.patch("/:id/suspend", (req, res) => res.send("suspend"));

app.use("/customers", router);

app.use((req, res) => res.status(404).send("NOT FOUND"));

const server = app.listen(3001, async () => {
  const res = await fetch("http://localhost:3001/customers/123/suspend", { method: "PATCH" });
  console.log(await res.text());
  server.close();
});
