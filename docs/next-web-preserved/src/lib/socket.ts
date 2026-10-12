/**
 * MoneyMart web — realtime layer (§9.2).
 * A single Socket.IO client shared by every screen. Reconnection uses
 * exponential backoff per the blueprint's WebSocket fallback policy.
 */
'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@moneymart/types';
import { API_URL } from './api';

export type MoneyMartSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: MoneyMartSocket | null = null;

export function getSocket(): MoneyMartSocket {
  if (!socket) {
    socket = io(API_URL, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      reconnectionAttempts: Infinity,
      timeout: 10_000,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
