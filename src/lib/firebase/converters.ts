import {
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

// TODO(phase-2): `fromFirestore` currently casts `snap.data()` to `T` without
// runtime validation. This is acceptable only while Phase 1 has a single debug
// writer. Before Phase 2 introduces real tournament / player / structure
// converters, wrap the cast with a runtime validator (zod schema per collection)
// so malformed Firestore documents fail loudly instead of producing undefined
// field access deep in the UI. See .claude/rules/firebase-patterns.md.
export function converter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data: T) => data,
    fromFirestore: (snap: QueryDocumentSnapshot) => snap.data() as T,
  };
}
