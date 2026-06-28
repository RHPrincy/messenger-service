# messenger-botia

Bot **Facebook Messenger** servant de pont entre Messenger et l'agent IA conversationnel
**Botia** (`chat.botia.ai`). 

## Architecture

```
Client Messenger
      │  (message)
      ▼
Webhook Meta  ──POST /webhook──►  MessengerService
                                      │
                                      ▼
                                  BotiaService ──►  chat.botia.ai/api/ask  (flux SSE)
                                      │                     │
                                      │◄────── réponse ─────┘
                                      ▼
                        Graph API Facebook (me/messages)
                                      │
                                      ▼
                              Client Messenger (réponse)
```

## Fonctionnement

Le code source se trouve dans [`src/`](src/) :

| Fichier | Rôle |
|---|---|
| [`main.ts`](src/main.ts) | Serveur Express, expose le webhook sur le **port 3000**. |
| [`messenger.service.ts`](src/messenger.service.ts) | Vérifie le webhook, extrait le message, appelle Botia, renvoie la réponse via la Graph API Facebook. |
| [`botia.service.ts`](src/botia.service.ts) | Gère l'historique de conversation par utilisateur et l'appel à l'API Botia (flux SSE). |
| [`messenger.controller.ts`](src/messenger.controller.ts) | Version NestJS des routes webhook (alternative). |
| [`app.module.ts`](src/app.module.ts) | Module NestJS regroupant contrôleur et services. |

### Routes Webhook

- **`GET /webhook`** — vérification du webhook par Meta. Compare `hub.verify_token` reçu
  avec la variable `VERIFY_TOKEN` et renvoie le `hub.challenge` si la souscription est valide.
- **`POST /webhook`** — réception des messages entrants. Seuls les messages contenant
  du texte (`message.text`) sont traités.

### Gestion de la conversation (`BotiaService`)

- **Historique par utilisateur** : indexé par `senderId` Messenger, limité aux
  **30 derniers messages** (`MAX_HISTORY`) pour éviter une croissance infinie de la mémoire.
- **Message d'accueil** : chaque nouvelle conversation est amorcée avec une salutation
  de l'assistant, afin que l'agent ne se re-présente pas à chaque réponse.
- **Appel à Botia** : `POST https://chat.botia.ai/api/ask` avec **3 tentatives**
  (l'API a des timeouts intermittents). La réponse est un flux **SSE**
  (`text/event-stream`) : les fragments `text-delta` sont assemblés pour reconstituer
  la réponse complète.
- **Mémoire en RAM** : l'historique est conservé en mémoire (`Map`). Il est donc
  **perdu au redémarrage** du serveur.

## Configuration

Créer un fichier `.env` à la racine du projet :

```env
PAGE_ACCESS_TOKEN=<token de la page Facebook>
VERIFY_TOKEN=<jeton de vérification du webhook Meta>
BOTIA_DATABASE=<identifiant de la base de connaissances Botia>
APP_SECRET=<app secret Meta — vérification de signature des webhooks>
```

| Variable | Description |
|---|---|
| `PAGE_ACCESS_TOKEN` | Token d'accès de la page Facebook, utilisé pour envoyer les réponses via la Graph API. |
| `VERIFY_TOKEN` | Jeton de validation du webhook lors de la souscription Meta. |
| `BOTIA_DATABASE` | Identifiant de la base de connaissances Botia. |
| `APP_SECRET` | Secret de l'app Meta, utilisé pour vérifier la signature `X-Hub-Signature-256` des webhooks entrants. **Optionnel** : si absent, la vérification est désactivée (un avertissement est journalisé) — pratique en dev, à définir en production. |


## Installation et lancement

```bash
# Installer les dépendances
npm install

# Démarrer le serveur (port 3000)
npm start

# Vérifier les types sans compiler
npm run typecheck
```