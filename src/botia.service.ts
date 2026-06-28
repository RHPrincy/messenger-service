type BotiaPart = { type: "text"; text: string };
type BotiaMessage = {
  id: string;
  role: "user" | "assistant";
  parts: BotiaPart[];
};

// Nombre maximum de messages conservés par conversation (évite une
// croissance infinie de la mémoire). On garde les N derniers messages.
const MAX_HISTORY = 30;

// Durée de vie d'une conversation inactive. Au-delà, l'historique est
// purgé : cela évite une fuite mémoire due aux utilisateurs qui ne
// reviennent jamais (le Map grossirait indéfiniment sinon).
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// Message d'accueil de l'assistant, injecté au début de chaque nouvelle
// conversation. C'est ce que fait le chat web : la salutation est déjà
// présente, donc l'agent ne se re-présente pas (« Bonjour, je suis... »)
// à chaque réponse.
const GREETING =
  "Bonjour!";

export class BotiaService {
  // Historique de conversation par utilisateur Messenger (senderId).
  // C'est ce qui permet à l'agent de garder le contexte entre les
  // messages, exactement comme le chat web qui renvoie tout l'historique.
  // `updatedAt` sert au nettoyage des conversations inactives.
  private histories = new Map<
    string,
    { messages: BotiaMessage[]; updatedAt: number }
  >();

  async ask(senderId: string, message: string): Promise<string> {
    // Purge des conversations inactives avant tout traitement.
    this.purgeExpired();

    // Nouvelle conversation : on amorce avec la salutation de l'assistant.
    const history =
      this.histories.get(senderId)?.messages ??
      [
        {
          id: `${Date.now()}-${senderId}-greeting`,
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: GREETING }],
        },
      ];

    history.push({
      id: `${Date.now()}-${senderId}-u`,
      role: "user",
      parts: [{ type: "text", text: message }],
    });

    const reply = await this.callBotia(history, `messenger-${senderId}`);

    // On mémorise la réponse de l'assistant pour les prochains messages.
    history.push({
      id: `${Date.now()}-${senderId}-a`,
      role: "assistant",
      parts: [{ type: "text", text: reply }],
    });

    // On ne garde que les derniers messages, avec l'heure de mise à jour.
    this.histories.set(senderId, {
      messages: history.slice(-MAX_HISTORY),
      updatedAt: Date.now(),
    });

    return reply;
  }

  // Supprime les conversations dont le dernier message dépasse le TTL.
  private purgeExpired() {
    const now = Date.now();
    for (const [senderId, entry] of this.histories) {
      if (now - entry.updatedAt > HISTORY_TTL_MS) {
        this.histories.delete(senderId);
      }
    }
  }

  // Appelle l'API Botia avec quelques tentatives (l'API a des timeouts
  // intermittents) et reconstitue la réponse à partir du flux SSE.
  private async callBotia(
    messages: BotiaMessage[],
    chatId: string,
    tries = 3
  ): Promise<string> {
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const res = await fetch("https://chat.botia.ai/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            database: process.env.BOTIA_DATABASE,
            id: Date.now().toString(),
            trigger: "submit-message",
            messages,
          }),
        });

        // Botia répond en flux SSE (text/event-stream) : on assemble les
        // morceaux "text-delta" pour reconstituer la réponse complète.
        const raw = await res.text();
        let reply = "";

        for (const line of raw.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]" || payload === "") continue;

          try {
            const event = JSON.parse(payload);
            if (event.type === "text-delta" && typeof event.delta === "string") {
              reply += event.delta;
            }
          } catch {
            // ligne non-JSON, on ignore
          }
        }

        return reply.trim() || "Pas de réponse";
      } catch (err) {
        if (attempt === tries) {
          console.error("Botia: échec après", tries, "tentatives", err);
          return "Désolé, je rencontre un problème technique. Merci de réessayer dans un instant.";
        }
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    return "Pas de réponse";
  }
}
