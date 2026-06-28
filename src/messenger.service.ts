import { ForbiddenException } from "@nestjs/common";
import { BotiaService } from "./botia.service";

// Limite de longueur d'un message texte côté Messenger (~2000 caractères).
// Au-delà, l'API rejette le message : on découpe donc en plusieurs bulles.
const MESSENGER_MAX_LEN = 1900;

// Nombre de `mid` (identifiants de message Meta) récemment traités que l'on
// garde en mémoire pour ignorer les doublons (Meta peut renvoyer le même
// événement plusieurs fois).
const SEEN_MIDS_MAX = 1000;

export class MessengerService {
  botia = new BotiaService();

  // Identifiants de messages déjà traités (déduplication / idempotence).
  private seenMids = new Set<string>();

  verify(query: any) {
    const mode = query["hub.mode"];
    const token = query["hub.verify_token"];
    const challenge = query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
      return challenge;
    }

    throw new ForbiddenException("Invalid verify token");
  }

  async handleMessage(body: any) {
    // On parcourt tous les événements (Meta peut en grouper plusieurs).
    for (const entry of body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        await this.handleEvent(event);
      }
    }
  }

  private async handleEvent(event: any) {
    const senderId = event?.sender?.id;
    if (!senderId || !event.message) return;

    // Idempotence : on ignore un message déjà traité (renvoi par Meta).
    const mid = event.message.mid;
    if (mid && this.seenMids.has(mid)) return;
    if (mid) this.rememberMid(mid);

    // On ignore les échos (messages envoyés par la page elle-même).
    if (event.message.is_echo) return;

    const text: string | undefined = event.message.text;

    // Message non textuel (image, sticker, localisation, audio…).
    if (!text) {
      await this.sendText(
        senderId,
        "Je ne peux traiter que des messages texte pour le moment. " +
          "Pouvez-vous reformuler votre demande par écrit ?"
      );
      return;
    }

    // Indicateur « en train d'écrire » pendant l'appel (potentiellement lent).
    await this.sendAction(senderId, "typing_on");
    try {
      const reply = await this.botia.ask(senderId, text);
      await this.sendText(senderId, reply);
    } finally {
      await this.sendAction(senderId, "typing_off");
    }
  }

  // Mémorise un `mid` traité, en bornant la taille du Set (FIFO simple).
  private rememberMid(mid: string) {
    this.seenMids.add(mid);
    if (this.seenMids.size > SEEN_MIDS_MAX) {
      const oldest = this.seenMids.values().next().value;
      if (oldest !== undefined) this.seenMids.delete(oldest);
    }
  }

  // Envoie une action (typing_on / typing_off / mark_seen) à Messenger.
  private async sendAction(senderId: string, action: string) {
    await this.callSendApi({
      recipient: { id: senderId },
      sender_action: action,
    });
  }

  // Envoie un texte, découpé en plusieurs bulles si nécessaire.
  private async sendText(senderId: string, text: string) {
    for (const chunk of splitMessage(text, MESSENGER_MAX_LEN)) {
      await this.callSendApi({
        recipient: { id: senderId },
        message: { text: chunk },
      });
    }
  }

  // Appel bas niveau à la Send API de Messenger.
  private async callSendApi(payload: any) {
    try {
      await fetch(
        `https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
    } catch (err) {
      console.error("Messenger Send API: échec d'envoi", err);
    }
  }
}

// Découpe un texte en morceaux <= maxLen, en évitant de couper au milieu
// d'un mot quand c'est possible.
export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf(" ", maxLen);
    if (cut <= 0) cut = maxLen; // mot trop long : coupe brute
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
