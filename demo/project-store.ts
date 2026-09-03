export interface StoredProject {
  filename: string;
  text: string;
  updatedAt: number;
  kind?: "version";
}

const DB_NAME = "aegisub-web";
const STORE_NAME = "projects";
const LAST_KEY = "last";
const FALLBACK_KEY = "aegisub-web.last-project.v1";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is unavailable"));
  });
}

export async function saveLastProject(project: StoredProject): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.put(project, LAST_KEY);
      store.put(project, `recent:${project.filename}`);
      store.put({ ...project, kind: "version" }, `version:${project.filename}:${Math.floor(project.updatedAt / 60000)}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save project"));
    });
    db.close();
  } catch {
    // localStorage is intentionally only a fallback: IndexedDB handles large ASS files better.
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(project));
    } catch {
      // Private browsing/storage pressure may reject both. Editing must remain usable.
    }
  }
}

export async function loadLastProject(): Promise<StoredProject | null> {
  try {
    const db = await openDatabase();
    const result = await new Promise<StoredProject | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(LAST_KEY);
      request.onsuccess = () => resolve(request.result as StoredProject | undefined);
      request.onerror = () => reject(request.error ?? new Error("Could not load project"));
    });
    db.close();
    return result ?? null;
  } catch {
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      return raw ? JSON.parse(raw) as StoredProject : null;
    } catch {
      return null;
    }
  }
}

export async function listRecentProjects(limit = 12): Promise<StoredProject[]> {
  try {
    const db = await openDatabase();
    const values = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result ?? []) as StoredProject[]);
      request.onerror = () => reject(request.error ?? new Error("Could not load recent projects"));
    });
    db.close();
    const unique = new Map<string, StoredProject>();
    for (const project of values.filter((value) => value.kind !== "version")) {
      const previous = unique.get(project.filename);
      if (!previous || project.updatedAt > previous.updatedAt) unique.set(project.filename, project);
    }
    return [...unique.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  } catch {
    const last = await loadLastProject();
    return last ? [last] : [];
  }
}

export async function listAutosaveVersions(filename?: string, limit = 100): Promise<StoredProject[]> {
  try {
    const db = await openDatabase();
    const values = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result ?? []) as StoredProject[]);
      request.onerror = () => reject(request.error ?? new Error("Could not load autosave versions"));
    });
    db.close();
    return values.filter((value) => value.kind === "version" && (!filename || value.filename === filename)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  } catch {
    return [];
  }
}
