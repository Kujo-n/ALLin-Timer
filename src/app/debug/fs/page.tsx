"use client";

import { useState } from "react";
import { signInAnonymously } from "firebase/auth";
import {
  addDoc,
  collection,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { firebaseAuth, firestore } from "@/lib/firebase/client";
import { logger } from "@/lib/logger";

export default function DebugFsPage() {
  const [docs, setDocs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function handleWrite() {
    setError(null);
    try {
      if (!firebaseAuth.currentUser) {
        await signInAnonymously(firebaseAuth);
      }
      const uid = firebaseAuth.currentUser?.uid;
      if (!uid) {
        throw new AppError(
          "Anonymous sign-in did not yield a user",
          "auth/no-current-user",
        );
      }
      const ref = await addDoc(collection(firestore, "tournaments"), {
        ownerUid: uid,
        name: "debug",
        state: "setup",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      logger.info("debug write ok", { id: ref.id });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "書込失敗");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    }
  }

  async function handleList() {
    setError(null);
    try {
      const snap = await getDocs(collection(firestore, "tournaments"));
      setDocs(snap.docs.map((d) => `${d.id}: ${d.get("name") ?? "(no name)"}`));
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "一覧取得失敗");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-8">
      <h1 className="text-xl font-bold">Firestore 疎通確認</h1>
      <p className="text-sm text-muted-foreground">
        Phase 1 完了判定用の debug ルート（/debug/fs）。Phase 5 で削除予定。
      </p>
      <div className="flex gap-2">
        <Button onClick={handleWrite} variant="default">
          書込
        </Button>
        <Button onClick={handleList} variant="outline">
          一覧
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="list-disc space-y-1 pl-6 text-sm">
        {docs.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </main>
  );
}
