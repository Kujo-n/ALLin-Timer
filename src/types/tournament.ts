import type { Timestamp } from "firebase/firestore";

export type TournamentState = "setup" | "seating" | "running" | "paused" | "finished";

export interface Level {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  durationSec: number;
}

export interface Structure {
  id: string;
  ownerUid: string;
  name: string;
  initialStack: number;
  lateEntryDeadlineLevel: number;
  levels: Level[];
  createdAt: Timestamp;
}

export interface Tournament {
  id: string;
  ownerUid: string;
  name: string;
  structureSnapshot: Omit<Structure, "id" | "ownerUid" | "createdAt">;
  state: TournamentState;
  startedAt: Timestamp | null;
  currentLevel: number;
  lateEntryDeadlineLevel: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Player {
  id: string;
  displayName: string;
  uid: string | null;
  entryAt: Timestamp;
  isBusted: boolean;
  bustedAt: Timestamp | null;
}

export interface TableDoc {
  tableNumber: number;
  isBroken: boolean;
}

export interface Seat {
  seatNumber: number;
  playerId: string | null;
}

export type TournamentEventType =
  | "bust"
  | "move"
  | "level_up"
  | "late_entry"
  | "pause"
  | "resume"
  | "start"
  | "finish";

export interface TournamentEvent {
  id: string;
  type: TournamentEventType;
  payload: Record<string, unknown>;
  occurredAt: Timestamp;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string | null;
  createdAt: Timestamp;
}
