# Backend Alanya — NestJS

Migration complète du backend Next.js vers **NestJS 11**.

## Stack

| Couche | Tech |
|---|---|
| Framework | NestJS 11 (Express) |
| ORM | Prisma 6 + PostgreSQL |
| Auth | JWT (access 15 min + refresh 7 j) + bcryptjs |
| Email | Nodemailer (SMTP) |
| Media | Upload multipart local (dossier configurable) |
| IA | Google Gemini 2.5 Flash |
| Push | Firebase Admin SDK |
| WebSocket | Process Node standalone (ws-server.ts) |
| Docs API | Swagger (/api-docs) |

## Démarrage rapide

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev
# Autre terminal :
npm run ws-local
```

Swagger : http://localhost:3000/api-docs
WebSocket : ws://localhost:3001

## Structure

```
src/
├── main.ts
├── app.module.ts
├── prisma/           PrismaService global
├── common/           Guards, JWT, Mailer, Filtres
├── auth/             register/verify/setup/login/logout/refresh/forgot/reset
├── account/          /me + /account/profile
├── contacts/         CRUD contacts
├── conversations/    Messages paginés, edit, delete, forward, read
├── calls/            WebRTC signaling + ICE
├── media/            Upload multipart + serving
├── statuses/         Stories 24h
├── meetings/         Réunions
├── blocked/          Blocages
├── users/            search + match
├── pays/             Liste pays
├── ai/               Chat Gemini
├── push/             Tokens FCM
└── ws-server.ts      WebSocket temps réel (process séparé)
```

## Scripts

```bash
npm run start:dev        # Dev hot-reload
npm run build            # Compile TypeScript
npm run start:prod       # Production
npm run ws-local         # WebSocket dev
npm run prisma:migrate   # Migration DB
npm run prisma:studio    # Prisma Studio
```
