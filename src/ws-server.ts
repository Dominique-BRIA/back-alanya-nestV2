/**
 * Serveur WebSocket temps réel Alanya — NestJS edition
 * Process séparé du serveur NestJS HTTP.
 *
 * Authentification via JWT (?token=<accessToken>).
 * Gère : messages, delivery receipts, typing, présence, appels (signaling WebRTC).
 *
 * Lancement : node dist/ws-server.js
 *            (ou ts-node src/ws-server.ts en dev)
 */

import 'reflect-metadata';
import { WebSocketServer, WebSocket } from 'ws';
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import { parse } from 'url';

const prisma = new PrismaClient();
const PORT = Number(process.env.WS_PORT ?? process.env.PORT ?? 3001);
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;

if (!ACCESS_SECRET) {
  console.error('[ws] JWT_ACCESS_SECRET manquant.');
  process.exit(1);
}

// userId → Set<WebSocket>
const clients = new Map<string, Set<WebSocket>>();

function addClient(userId: string, ws: WebSocket) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId)!.add(ws);
}

function removeClient(userId: string, ws: WebSocket) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) clients.delete(userId);
}

function sendTo(userId: string, payload: unknown): boolean {
  const set = clients.get(userId);
  if (!set) return false;
  const data = JSON.stringify(payload);
  let delivered = false;
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
      delivered = true;
    }
  }
  return delivered;
}

function isUserOnline(userId: string): boolean {
  const set = clients.get(userId);
  if (!set) return false;
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) return true;
  }
  return false;
}

// Buffer d'appels entrants non délivrés (reconnexion mobile)
const pendingCalls = new Map<string, Array<{ payload: unknown; expiresAt: number }>>();

function bufferPendingCall(userId: string, payload: unknown) {
  const list = pendingCalls.get(userId) ?? [];
  list.push({ payload, expiresAt: Date.now() + 60_000 });
  pendingCalls.set(userId, list);
}

async function flushPendingCalls(userId: string, ws: WebSocket) {
  const list = pendingCalls.get(userId);
  if (!list?.length) return;

  const validCalls: typeof list = [];
  for (const entry of list) {
    if (entry.expiresAt < Date.now()) continue;
    const callId = (entry.payload as any)?.callId;
    if (callId) {
      const call = await prisma.call.findUnique({ where: { id: callId } });
      if (call?.status === 'RINGING') {
        validCalls.push(entry);
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(entry.payload));
      }
    }
  }
  if (validCalls.length > 0) {
    pendingCalls.set(userId, validCalls);
  } else {
    pendingCalls.delete(userId);
  }
}

// ─── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', async (ws: WebSocket, req) => {
  const { query } = parse(req.url ?? '', true);
  const token = query.token as string | undefined;

  if (!token) {
    ws.close(4001, 'Token manquant');
    return;
  }

  let userId: string;
  try {
    const payload = jwt.verify(token, ACCESS_SECRET) as { sub: string; scope: string };
    if (payload.scope !== 'access') throw new Error('Scope invalide');
    userId = payload.sub;
  } catch {
    ws.close(4001, 'Token invalide');
    return;
  }

  addClient(userId, ws);
  console.log(`[ws] Connecté : ${userId} (total: ${wss.clients.size})`);

  // Marquer en ligne
  await prisma.user.update({ where: { id: userId }, data: { isOnline: 1, lastSeen: new Date() } });

  // Envoyer les appels en attente
  await flushPendingCalls(userId, ws);

  ws.on('message', async (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const type = msg.type as string;

    // ── Message chat ──────────────────────────────────────────────────────────
    if (type === 'message') {
      const { convId, content, messageType = 'TEXT', replyToId, mediaId } = msg as any;
      if (!convId || (!content && !mediaId)) return;

      const participant = await prisma.participant.findUnique({
        where: { convId_userId: { convId, userId } },
      });
      if (!participant) return;

      const message = await prisma.message.create({
        data: {
          convId, senderId: userId, content: content ?? null,
          type: messageType, status: 'SENT',
          replyToId: replyToId ?? null,
          ...(mediaId ? { media: { connect: { id: mediaId } } } : {}),
        },
        include: { media: true },
      });

      await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });

      const participants = await prisma.participant.findMany({ where: { convId }, select: { userId: true } });
      const payload = {
        type: 'new_message',
        message: {
          id: message.id, convId, senderId: userId, content: message.content,
          type: message.type, status: 'SENT', replyToId: message.replyToId,
          media: message.media.map((f) => ({ id: f.id, url: `/api/media/${f.id}`, mimeType: f.mimeType })),
          createdAt: message.createdAt,
        },
      };

      for (const { userId: uid } of participants) {
        if (uid !== userId) sendTo(uid, payload);
      }
      ws.send(JSON.stringify({ type: 'message_sent', id: message.id }));
    }

    // ── Typing indicator ──────────────────────────────────────────────────────
    else if (type === 'typing') {
      const { convId, isTyping } = msg as any;
      if (!convId) return;
      const parts = await prisma.participant.findMany({ where: { convId }, select: { userId: true } });
      for (const { userId: uid } of parts) {
        if (uid !== userId) sendTo(uid, { type: 'typing', convId, userId, isTyping });
      }
    }

    // ── Read receipt ──────────────────────────────────────────────────────────
    else if (type === 'read') {
      const { convId } = msg as any;
      if (!convId) return;
      await prisma.participant.update({
        where: { convId_userId: { convId, userId } },
        data: { lastReadAt: new Date() },
      });
      const parts = await prisma.participant.findMany({ where: { convId }, select: { userId: true } });
      for (const { userId: uid } of parts) {
        if (uid !== userId) sendTo(uid, { type: 'read_receipt', convId, userId });
      }
    }

    // ── WebRTC Signaling ──────────────────────────────────────────────────────
    else if (type === 'webrtc_signal') {
      const { callId, targetUserId, signal } = msg as any;
      if (!callId || !targetUserId || !signal) return;
      sendTo(targetUserId, { type: 'webrtc_signal', callId, fromUserId: userId, signal });
    }

    // ── ICE candidate ─────────────────────────────────────────────────────────
    else if (type === 'ice_candidate') {
      const { callId, targetUserId, candidate } = msg as any;
      if (!callId || !targetUserId) return;
      sendTo(targetUserId, { type: 'ice_candidate', callId, fromUserId: userId, candidate });
    }

    // ── Incoming call notification ────────────────────────────────────────────
    else if (type === 'call_notify') {
      const { callId, calleeId, callType, callerName } = msg as any;
      if (!callId || !calleeId) return;
      const payload = { type: 'incoming_call', callId, callType, callerName, callerId: userId };
      const delivered = sendTo(calleeId, payload);
      if (!delivered) bufferPendingCall(calleeId, payload);
    }

    // ── Ping / keepalive ──────────────────────────────────────────────────────
    else if (type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    }
  });

  ws.on('close', async () => {
    removeClient(userId, ws);
    console.log(`[ws] Déconnecté : ${userId}`);
    if (!isUserOnline(userId)) {
      await prisma.user.update({ where: { id: userId }, data: { isOnline: 0, lastSeen: new Date() } });
      // Diffuser le statut "hors ligne" aux contacts
      const contacts = await prisma.contact.findMany({ where: { contactId: userId }, select: { userId: true } });
      for (const { userId: uid } of contacts) {
        sendTo(uid, { type: 'presence', userId, isOnline: false });
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[ws] Erreur ${userId}:`, err.message);
  });
});

console.log(`🔌 WebSocket Alanya démarré sur ws://0.0.0.0:${PORT}`);

// Heartbeat — ferme les sockets zombies
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) ws.terminate();
  });
}, 30_000);

process.on('SIGTERM', async () => {
  clearInterval(heartbeat);
  wss.close();
  await prisma.$disconnect();
  process.exit(0);
});
