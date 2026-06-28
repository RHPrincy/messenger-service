import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";
import { MessengerService } from "./messenger.service";

dotenv.config();

const app = express();

// On conserve le corps brut de la requête pour pouvoir vérifier la
// signature HMAC envoyée par Meta (calculée sur les octets exacts reçus).
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

const service = new MessengerService();

/**
 * Vérifie la signature X-Hub-Signature-256 envoyée par Meta.
 * Si APP_SECRET n'est pas défini, la vérification est désactivée
 * (utile en développement) avec un avertissement.
 */
function isValidSignature(req: any): boolean {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) {
    console.warn(
      "APP_SECRET non défini : vérification de signature désactivée."
    );
    return true;
  }

  const signature = req.get("x-hub-signature-256");
  if (!signature || !req.rawBody) return false;

  const expected =
    "sha256=" +
    crypto
      .createHmac("sha256", appSecret)
      .update(req.rawBody)
      .digest("hex");

  // Comparaison à temps constant pour éviter les attaques temporelles.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * VERIFY WEBHOOK META
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === process.env.VERIFY_TOKEN
  ) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/**
 * RECEIVE MESSAGES
 */
app.post("/webhook", async (req, res) => {
  if (!isValidSignature(req)) {
    return res.sendStatus(403);
  }

  // On répond immédiatement à Meta (évite les renvois pour cause de
  // timeout) puis on traite le message en arrière-plan.
  res.sendStatus(200);
  service.handleMessage(req.body).catch((err) => {
    console.error("Erreur de traitement du message", err);
  });
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
